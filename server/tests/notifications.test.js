const assert = require('assert');

const notificationsRouter = require('../routes/notifications');

const {
  countUnreadNotifications,
  createUserNotification,
  listUserNotifications,
  markAllUserNotificationsRead,
  markUserNotificationRead,
} = notificationsRouter.__test;

function createNotificationModel() {
  const rows = [];
  let nextId = 1;

  // 支持 Sequelize 的 Op.lt 条件（分页游标、过期清理）
  const { Op } = require('sequelize');
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && Op.lt in value) return row[key] < value[Op.lt];
    return value === null ? row[key] === null : row[key] === value;
  });

  return {
    rows,
    async findOrCreate({ where, defaults }) {
      const existing = rows.find(row => matches(row, where));
      if (existing) return [existing, false];

      const now = new Date();
      const row = {
        id: nextId,
        ...defaults,
        read_at: null,
        createdAt: now,
        updatedAt: now,
        async update(values) {
          Object.assign(this, values, { updatedAt: new Date().toISOString() });
          return this;
        },
        get() {
          return this;
        },
      };
      nextId += 1;
      rows.push(row);
      return [row, true];
    },
    async findAll({ where, limit }) {
      return rows
        .filter(row => matches(row, where))
        .sort((a, b) => b.id - a.id)
        .slice(0, limit);
    },
    async count({ where }) {
      return rows.filter(row => matches(row, where)).length;
    },
    async destroy({ where }) {
      const doomed = rows.filter(row => matches(row, where));
      doomed.forEach(row => rows.splice(rows.indexOf(row), 1));
      return doomed.length;
    },
    async findOne({ where }) {
      return rows.find(row => matches(row, where)) || null;
    },
    async update(values, { where }) {
      const targets = rows.filter(row => matches(row, where));
      targets.forEach(row => Object.assign(row, values));
      return [targets.length];
    },
  };
}

async function run() {
  const NotificationModel = createNotificationModel();
  const payload = {
    externalId: 'tg:btc-quality-20260726',
    title: '高质量进场期初期',
    content: 'BTC · Bitcoin\n场外：1080\n质量：高质量进场',
    category: 'quality',
    priority: 'high',
    coinSymbol: 'BTC',
    notificationDate: '2026-07-26',
    source: 'telegram',
  };

  const created = await createUserNotification(NotificationModel, 1, payload);
  assert.strictEqual(created.created, true);
  assert.strictEqual(created.notification.title, payload.title);
  assert.strictEqual(created.notification.readAt, null);

  const duplicate = await createUserNotification(NotificationModel, 1, payload);
  assert.strictEqual(duplicate.created, false);
  assert.strictEqual(NotificationModel.rows.length, 1, 'same user and external id should be idempotent');

  const secondUser = await createUserNotification(NotificationModel, 2, payload);
  assert.strictEqual(secondUser.created, true);
  assert.strictEqual(NotificationModel.rows.length, 2, 'notifications should be isolated per user');

  await assert.rejects(
    () => markUserNotificationRead(NotificationModel, 2, created.notification.id),
    error => error.statusCode === 404,
    'a user should not update another user notification'
  );

  const list = await listUserNotifications(NotificationModel, 1, { limit: 20 });
  assert.strictEqual(list.notifications.length, 1);
  assert.strictEqual(list.unreadCount, 1);

  const notificationId = list.notifications[0].id;
  const read = await markUserNotificationRead(NotificationModel, 1, notificationId);
  assert.ok(read.readAt);

  const unreadOnly = await listUserNotifications(NotificationModel, 1, { unreadOnly: true });
  assert.strictEqual(unreadOnly.notifications.length, 0);
  assert.strictEqual(unreadOnly.unreadCount, 0);

  await createUserNotification(NotificationModel, 1, {
    ...payload,
    externalId: 'tg:eth-exit-20260726',
    coinSymbol: 'ETH',
  });
  const updatedCount = await markAllUserNotificationsRead(NotificationModel, 1);
  assert.strictEqual(updatedCount, 1);

  // 未读数单独查询：抽屉关着时前端只轮询这个
  await createUserNotification(NotificationModel, 1, { ...payload, externalId: 'tg:unread-1' });
  assert.strictEqual(await countUnreadNotifications(NotificationModel, 1), 1);
  assert.strictEqual(await countUnreadNotifications(NotificationModel, 2), 1);

  // 游标分页：beforeId 之前的更早通知
  for (let index = 0; index < 5; index += 1) {
    await createUserNotification(NotificationModel, 3, { ...payload, externalId: `tg:page-${index}` });
  }
  const firstPage = await listUserNotifications(NotificationModel, 3, { limit: 2 });
  assert.strictEqual(firstPage.notifications.length, 2);
  assert.strictEqual(firstPage.hasMore, true);
  const secondPage = await listUserNotifications(NotificationModel, 3, {
    limit: 2,
    beforeId: firstPage.notifications[1].id,
  });
  assert.ok(secondPage.notifications.every(item => item.id < firstPage.notifications[1].id));
  const lastPage = await listUserNotifications(NotificationModel, 3, {
    limit: 2,
    beforeId: secondPage.notifications[1].id,
  });
  assert.strictEqual(lastPage.notifications.length, 1);
  assert.strictEqual(lastPage.hasMore, false);

  // 列表不回传整段 TG 原文，只保留结构化元数据
  const withHtml = await createUserNotification(NotificationModel, 4, {
    ...payload,
    externalId: 'tg:with-html',
    metadata: { telegramHtml: '<b>long</b>'.repeat(500), coins: ['BTC', 'ETH'] },
  });
  assert.deepStrictEqual(withHtml.notification.metadata, { coins: ['BTC', 'ETH'] });

  // 新写入时顺手清掉该用户 180 天前的通知
  const staleRow = NotificationModel.rows.find(row => row.external_id === 'tg:with-html');
  staleRow.createdAt = new Date(Date.now() - 181 * 24 * 60 * 60 * 1000);
  const freshRow = await createUserNotification(NotificationModel, 4, { ...payload, externalId: 'tg:fresh' });
  assert.strictEqual(freshRow.created, true);
  assert.strictEqual(
    NotificationModel.rows.some(row => row.external_id === 'tg:with-html'),
    false,
    'notifications older than 180 days should be pruned'
  );
  assert.strictEqual(NotificationModel.rows.filter(row => row.user_id === 1).length > 0, true, 'other users untouched');

  console.log('notifications.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
