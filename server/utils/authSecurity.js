const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('./authConfig');

const MIN_PASSWORD_LENGTH = 15;
const MAX_PASSWORD_BYTES = 72;
const MAX_USERNAME_LENGTH = 64;
const MAX_EMAIL_LENGTH = 254;
const COMMON_PASSWORDS = new Set([
  '123456789012345',
  'adminadminadmin',
  'passwordpassword',
  'qwertyqwertyqwerty',
]);

function createValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normalizeUsername(value) {
  if (typeof value !== 'string') {
    throw createValidationError('用户名为必填项');
  }
  const username = value.trim();
  if (username.length < 3 || username.length > MAX_USERNAME_LENGTH) {
    throw createValidationError(`用户名长度必须为3-${MAX_USERNAME_LENGTH}个字符`);
  }
  if (!/^[\p{L}\p{N}_.-]+$/u.test(username)) {
    throw createValidationError('用户名只能包含文字、数字、点、下划线和连字符');
  }
  return username;
}

function normalizeEmail(value, { required = false } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (required) throw createValidationError('邮箱为必填项');
    return null;
  }

  const email = String(value).trim().toLowerCase();
  if (email.length > MAX_EMAIL_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createValidationError('邮箱格式无效');
  }
  return email;
}

function validatePassword(value) {
  if (typeof value !== 'string') {
    throw createValidationError('密码为必填项');
  }
  if ([...value].length < MIN_PASSWORD_LENGTH) {
    throw createValidationError(`密码长度必须至少为${MIN_PASSWORD_LENGTH}个字符`);
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_PASSWORD_BYTES) {
    throw createValidationError(`密码最多允许${MAX_PASSWORD_BYTES}个UTF-8字节`);
  }
  if (COMMON_PASSWORDS.has(value.toLowerCase())) {
    throw createValidationError('密码过于常见，请使用更长的独立口令');
  }
  return value;
}

function passwordMeetsPolicy(value) {
  try {
    validatePassword(value);
    return true;
  } catch {
    return false;
  }
}

function getPlainUser(user) {
  return typeof user?.get === 'function' ? user.get({ plain: true }) : user;
}

function createAuthVersion(user, jwtSecret = getJwtSecret()) {
  const plain = getPlainUser(user) || {};
  return crypto
    .createHmac('sha256', jwtSecret)
    .update(`${plain.id || ''}\n${plain.password || ''}\n${plain.role || ''}\n${plain.status || ''}`)
    .digest('hex');
}

function authVersionsMatch(tokenVersion, currentVersion) {
  if (typeof tokenVersion !== 'string' || typeof currentVersion !== 'string') return false;
  const tokenBuffer = Buffer.from(tokenVersion);
  const currentBuffer = Buffer.from(currentVersion);
  return tokenBuffer.length === currentBuffer.length
    && crypto.timingSafeEqual(tokenBuffer, currentBuffer);
}

function serializeAuthUser(user) {
  const plain = getPlainUser(user) || {};
  return {
    id: plain.id,
    username: plain.username,
    email: plain.email || null,
    role: plain.role,
    status: plain.status,
    lastLogin: plain.lastLogin || null,
  };
}

function signAuthToken(user, {
  jwtSecret = getJwtSecret(),
  expiresIn = '7d',
  passwordChangeRecommended = false,
} = {}) {
  const safeUser = serializeAuthUser(user);
  return jwt.sign({
    id: safeUser.id,
    username: safeUser.username,
    role: safeUser.role,
    authVersion: createAuthVersion(user, jwtSecret),
    passwordChangeRecommended: passwordChangeRecommended === true,
  }, jwtSecret, { expiresIn });
}

module.exports = {
  MAX_PASSWORD_BYTES,
  MAX_USERNAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  authVersionsMatch,
  createAuthVersion,
  normalizeEmail,
  normalizeUsername,
  passwordMeetsPolicy,
  serializeAuthUser,
  signAuthToken,
  validatePassword,
};
