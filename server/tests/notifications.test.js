const assert = require('assert');

const notificationsRouter = require('../routes/notifications');

const {
  createUserNotification,
  listUserNotifications,
  markAllUserNotificationsRead,
  markUserNotificationRead,
} = notificationsRouter.__test;

function createNotificationModel() {
  const rows = [];
  let nextId = 1;

  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => (
    value === null ? row[key] === null : row[key] === value
  ));

  return {
    rows,
    async findOrCreate({ where, defaults }) {
      const existing = rows.find(row => matches(row, where));
      if (existing) return [existing, false];

      const now = new Date().toISOString();
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

  console.log('notifications.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
