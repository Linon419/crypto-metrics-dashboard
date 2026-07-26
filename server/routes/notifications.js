const express = require('express');
const { Notification } = require('../models');

const ALLOWED_CATEGORIES = new Set(['market', 'quality', 'strategy', 'momentum', 'favorite', 'system']);
const ALLOWED_PRIORITIES = new Set(['normal', 'high', 'critical']);

function getUserId(req) {
  const userId = Number(req.user?.id);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

function normalizeText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function parseMetadata(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function serializeNotification(row) {
  const value = typeof row?.get === 'function' ? row.get({ plain: true }) : row;
  return {
    id: value.id,
    source: value.source,
    title: value.title,
    content: value.content,
    category: value.category,
    priority: value.priority,
    coinSymbol: value.coin_symbol || null,
    notificationDate: value.notification_date || null,
    readAt: value.read_at || null,
    metadata: parseMetadata(value.metadata),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function validateCreatePayload(body = {}) {
  const externalId = normalizeText(body.externalId, 128);
  const title = normalizeText(body.title, 160);
  const content = normalizeText(body.content, 12000);

  if (!externalId || !title || !content) {
    const error = new Error('externalId, title and content are required');
    error.statusCode = 400;
    throw error;
  }

  const category = ALLOWED_CATEGORIES.has(body.category) ? body.category : 'market';
  const priority = ALLOWED_PRIORITIES.has(body.priority) ? body.priority : 'normal';
  const metadata = body.metadata && typeof body.metadata === 'object'
    ? JSON.stringify(body.metadata)
    : null;

  return {
    external_id: externalId,
    source: normalizeText(body.source, 32) || 'telegram',
    title,
    content,
    category,
    priority,
    coin_symbol: normalizeText(body.coinSymbol, 32).toUpperCase() || null,
    notification_date: /^\d{4}-\d{2}-\d{2}$/.test(body.notificationDate || '')
      ? body.notificationDate
      : null,
    metadata,
  };
}

async function listUserNotifications(NotificationModel, userId, { limit = 30, unreadOnly = false } = {}) {
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 30, 1), 100);
  const where = { user_id: userId, ...(unreadOnly ? { read_at: null } : {}) };
  const [notifications, unreadCount] = await Promise.all([
    NotificationModel.findAll({ where, limit: safeLimit, order: [['createdAt', 'DESC']] }),
    NotificationModel.count({ where: { user_id: userId, read_at: null } }),
  ]);

  return {
    notifications: notifications.map(serializeNotification),
    unreadCount,
  };
}

async function createUserNotification(NotificationModel, userId, body) {
  const values = validateCreatePayload(body);
  const [notification, created] = await NotificationModel.findOrCreate({
    where: { user_id: userId, external_id: values.external_id },
    defaults: { user_id: userId, ...values },
  });

  return { created, notification: serializeNotification(notification) };
}

async function markUserNotificationRead(NotificationModel, userId, notificationId) {
  const notification = await NotificationModel.findOne({
    where: { id: Number(notificationId), user_id: userId },
  });
  if (!notification) {
    const error = new Error('Notification not found');
    error.statusCode = 404;
    throw error;
  }

  if (!notification.read_at) {
    await notification.update({ read_at: new Date() });
  }
  return serializeNotification(notification);
}

async function markAllUserNotificationsRead(NotificationModel, userId) {
  const [updatedCount] = await NotificationModel.update(
    { read_at: new Date() },
    { where: { user_id: userId, read_at: null } }
  );
  return updatedCount;
}

function createNotificationsRouter({ NotificationModel = Notification } = {}) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    try {
      const result = await listUserNotifications(NotificationModel, userId, {
        limit: req.query.limit,
        unreadOnly: req.query.unreadOnly === 'true',
      });
      return res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error('Failed to list notifications:', error);
      return res.status(500).json({ error: 'Failed to list notifications' });
    }
  });

  router.post('/', async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    try {
      const result = await createUserNotification(NotificationModel, userId, req.body);
      return res.status(result.created ? 201 : 200).json({
        success: true,
        ...result,
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      if (statusCode === 500) console.error('Failed to create notification:', error);
      return res.status(statusCode).json({ error: error.message || 'Failed to create notification' });
    }
  });

  router.post('/read-all', async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    try {
      const updatedCount = await markAllUserNotificationsRead(NotificationModel, userId);
      return res.json({ success: true, updatedCount });
    } catch (error) {
      console.error('Failed to mark all notifications as read:', error);
      return res.status(500).json({ error: 'Failed to update notifications' });
    }
  });

  router.patch('/:id/read', async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    try {
      const notification = await markUserNotificationRead(
        NotificationModel,
        userId,
        req.params.id
      );
      return res.json({ success: true, notification });
    } catch (error) {
      if (error.statusCode === 404) return res.status(404).json({ error: error.message });
      console.error('Failed to mark notification as read:', error);
      return res.status(500).json({ error: 'Failed to update notification' });
    }
  });

  return router;
}

const router = createNotificationsRouter();
router.createNotificationsRouter = createNotificationsRouter;
router.__test = {
  createUserNotification,
  listUserNotifications,
  markAllUserNotificationsRead,
  markUserNotificationRead,
  serializeNotification,
  validateCreatePayload,
};

module.exports = router;
