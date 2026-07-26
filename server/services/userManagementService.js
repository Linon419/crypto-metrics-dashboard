const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const {
  normalizeEmail,
  normalizeUsername,
  validatePassword,
} = require('../utils/authSecurity');

const USER_ROLES = new Set(['user', 'admin']);
const USER_STATUSES = new Set(['active', 'banned', 'inactive']);

function createStatusError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function toPlain(row) {
  return typeof row?.get === 'function' ? row.get({ plain: true }) : row;
}

function parseDetails(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function serializeManagedUser(row) {
  const user = toPlain(row) || {};
  return {
    id: user.id,
    username: user.username,
    email: user.email || null,
    role: user.role,
    status: user.status,
    lastLogin: user.lastLogin || null,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
  };
}

function serializeAuditLog(row) {
  const log = toPlain(row) || {};
  return {
    id: log.id,
    actorUserId: log.actor_user_id || null,
    actorUsername: log.actor_username || null,
    targetUserId: log.target_user_id || null,
    targetUsername: log.target_username || null,
    action: log.action,
    details: parseDetails(log.details),
    ipAddress: log.ip_address || null,
    createdAt: log.createdAt || null,
  };
}

function normalizeRole(value, fallback = 'user') {
  const role = value === undefined ? fallback : String(value).trim().toLowerCase();
  if (!USER_ROLES.has(role)) throw createStatusError('用户角色无效', 400);
  return role;
}

function normalizeStatus(value, fallback = 'active') {
  const status = value === undefined ? fallback : String(value).trim().toLowerCase();
  if (!USER_STATUSES.has(status)) throw createStatusError('用户状态无效', 400);
  return status;
}

function normalizeUserId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw createStatusError('用户ID无效', 400);
  return id;
}

async function withTransaction(SequelizeInstance, callback) {
  if (SequelizeInstance?.transaction) return SequelizeInstance.transaction(callback);
  return callback(null);
}

async function writeUserAuditLog({ UserAuditLogModel }, {
  actor = null,
  target = null,
  action,
  details = null,
  ip = null,
  transaction = null,
}) {
  if (!UserAuditLogModel?.create) return null;
  return UserAuditLogModel.create({
    actor_user_id: actor?.id || null,
    actor_username: actor?.username || null,
    target_user_id: target?.id || null,
    target_username: target?.username || null,
    action,
    details: details ? JSON.stringify(details) : null,
    ip_address: ip ? String(ip).slice(0, 64) : null,
  }, { transaction });
}

async function assertAdminContinuity(UserModel, target, nextValues, transaction) {
  const removesActiveAdmin = target.role === 'admin'
    && target.status === 'active'
    && (nextValues.role !== 'admin' || nextValues.status !== 'active');
  if (!removesActiveAdmin) return;

  const activeAdminCount = await UserModel.count({
    where: { role: 'admin', status: 'active' },
    transaction,
  });
  if (activeAdminCount <= 1) {
    throw createStatusError('系统必须保留至少一个正常管理员', 409);
  }
}

async function assertUniqueUser(UserModel, { username, email, excludeId = null }, transaction) {
  if (username) {
    const where = { username };
    if (excludeId) where.id = { [Op.ne]: excludeId };
    if (await UserModel.findOne({ where, transaction })) {
      throw createStatusError('用户名已存在', 409);
    }
  }
  if (email) {
    const where = { email };
    if (excludeId) where.id = { [Op.ne]: excludeId };
    if (await UserModel.findOne({ where, transaction })) {
      throw createStatusError('邮箱已存在', 409);
    }
  }
}

async function listManagedUsers({ UserModel }) {
  const users = await UserModel.findAll({
    attributes: { exclude: ['password'] },
    order: [['createdAt', 'DESC']],
  });
  return { users: users.map(serializeManagedUser) };
}

async function createManagedUser(models, actor, payload = {}, request = {}) {
  const { UserModel, SequelizeInstance } = models;
  const username = normalizeUsername(payload.username);
  const email = normalizeEmail(payload.email, { required: true });
  const password = validatePassword(payload.password);
  const role = normalizeRole(payload.role);
  const status = normalizeStatus(payload.status);

  return withTransaction(SequelizeInstance, async transaction => {
    await assertUniqueUser(UserModel, { username, email }, transaction);
    const user = await UserModel.create({
      username,
      email,
      password: await bcrypt.hash(password, 10),
      role,
      status,
    }, { transaction });
    await writeUserAuditLog(models, {
      actor,
      target: user,
      action: 'user.create',
      details: { email, role, status },
      ip: request.ip,
      transaction,
    });
    return { user: serializeManagedUser(user) };
  });
}

async function updateManagedUser(models, actor, userId, payload = {}, request = {}) {
  const { UserModel, SequelizeInstance } = models;
  const id = normalizeUserId(userId);

  return withTransaction(SequelizeInstance, async transaction => {
    const user = await UserModel.findByPk(id, { transaction });
    if (!user) throw createStatusError('用户不存在', 404);

    const nextValues = {
      username: payload.username === undefined ? user.username : normalizeUsername(payload.username),
      email: payload.email === undefined ? user.email : normalizeEmail(payload.email, { required: true }),
      role: normalizeRole(payload.role, user.role),
      status: normalizeStatus(payload.status, user.status),
    };
    if (id === Number(actor.id) && (nextValues.role !== user.role || nextValues.status !== user.status)) {
      throw createStatusError('管理员不能修改自己的角色或状态', 400);
    }
    await assertAdminContinuity(UserModel, user, nextValues, transaction);
    await assertUniqueUser(UserModel, {
      username: nextValues.username !== user.username ? nextValues.username : null,
      email: nextValues.email !== user.email ? nextValues.email : null,
      excludeId: id,
    }, transaction);

    const before = serializeManagedUser(user);
    await user.update(nextValues, { transaction });
    await writeUserAuditLog(models, {
      actor,
      target: user,
      action: 'user.update',
      details: { before, after: serializeManagedUser(user) },
      ip: request.ip,
      transaction,
    });
    return { user: serializeManagedUser(user) };
  });
}

async function deleteManagedUser(models, actor, userId, request = {}) {
  const { UserModel, SequelizeInstance } = models;
  const id = normalizeUserId(userId);
  if (id === Number(actor.id)) throw createStatusError('管理员不能删除自己的账户', 400);

  return withTransaction(SequelizeInstance, async transaction => {
    const user = await UserModel.findByPk(id, { transaction });
    if (!user) throw createStatusError('用户不存在', 404);
    await assertAdminContinuity(UserModel, user, { role: user.role, status: 'deleted' }, transaction);
    const target = serializeManagedUser(user);
    await user.destroy({ transaction });
    await writeUserAuditLog(models, {
      actor,
      target,
      action: 'user.delete',
      details: { role: target.role, status: target.status },
      ip: request.ip,
      transaction,
    });
    return { deleted: true };
  });
}

async function setManagedUserStatus(models, actor, userId, status, request = {}) {
  const { UserModel, SequelizeInstance } = models;
  const id = normalizeUserId(userId);
  const nextStatus = normalizeStatus(status);
  if (!['active', 'banned'].includes(nextStatus)) throw createStatusError('状态操作无效', 400);
  if (id === Number(actor.id) && nextStatus !== 'active') {
    throw createStatusError('管理员不能封禁自己的账户', 400);
  }

  return withTransaction(SequelizeInstance, async transaction => {
    const user = await UserModel.findByPk(id, { transaction });
    if (!user) throw createStatusError('用户不存在', 404);
    await assertAdminContinuity(UserModel, user, { role: user.role, status: nextStatus }, transaction);
    await user.update({ status: nextStatus }, { transaction });
    await writeUserAuditLog(models, {
      actor,
      target: user,
      action: nextStatus === 'banned' ? 'user.ban' : 'user.unban',
      details: { status: nextStatus },
      ip: request.ip,
      transaction,
    });
    return { user: serializeManagedUser(user) };
  });
}

async function listUserAuditLogs({ UserAuditLogModel }, { limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 200);
  const logs = await UserAuditLogModel.findAll({
    order: [['createdAt', 'DESC']],
    limit: safeLimit,
  });
  return { auditLogs: logs.map(serializeAuditLog) };
}

module.exports = {
  USER_ROLES,
  USER_STATUSES,
  createManagedUser,
  deleteManagedUser,
  listManagedUsers,
  listUserAuditLogs,
  serializeManagedUser,
  setManagedUserStatus,
  updateManagedUser,
  writeUserAuditLog,
};
