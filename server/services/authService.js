const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { getJwtSecret } = require('../utils/authConfig');
const {
  normalizeEmail,
  normalizeUsername,
  passwordMeetsPolicy,
  serializeAuthUser,
  signAuthToken,
  validatePassword,
} = require('../utils/authSecurity');

const DUMMY_PASSWORD_HASH = bcrypt.hashSync('dummy authentication comparison value', 10);

function createStatusError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function registerUser({
  UserModel,
  bcryptImpl = bcrypt,
  jwtSecret = getJwtSecret(),
} = {}, payload = {}) {
  const username = normalizeUsername(payload.username);
  const email = normalizeEmail(payload.email);
  const password = validatePassword(payload.password);
  const existingUser = await UserModel.findOne({
    where: {
      [Op.or]: [
        { username },
        ...(email ? [{ email }] : []),
      ],
    },
  });
  if (existingUser) throw createStatusError('Username or email already exists', 409);

  const user = await UserModel.create({
    username,
    email,
    password: await bcryptImpl.hash(password, 10),
    role: 'user',
    status: 'active',
  });
  return {
    token: signAuthToken(user, { jwtSecret }),
    user: serializeAuthUser(user),
  };
}

async function authenticateUser({
  UserModel,
  bcryptImpl = bcrypt,
  limiter = null,
  jwtSecret = getJwtSecret(),
  now = () => new Date(),
} = {}, { username: rawUsername, password, ip } = {}) {
  const limiterUsername = typeof rawUsername === 'string'
    ? rawUsername.trim().slice(0, 64)
    : 'invalid-username';

  const limitState = limiter?.check({ username: limiterUsername, ip });
  if (limitState && !limitState.allowed) {
    const error = createStatusError('Too many login attempts. Please try again later.', 429);
    error.retryAfterSeconds = limitState.retryAfterSeconds;
    throw error;
  }

  let username;
  try {
    username = normalizeUsername(rawUsername);
  } catch {
    limiter?.recordFailure({ username: limiterUsername, ip });
    throw createStatusError('Invalid credentials', 401);
  }
  if (typeof password !== 'string' || !password) {
    limiter?.recordFailure({ username, ip });
    throw createStatusError('Invalid credentials', 401);
  }

  const user = await UserModel.findOne({ where: { username } });
  const passwordMatches = await bcryptImpl.compare(
    password,
    user?.password || DUMMY_PASSWORD_HASH
  );
  if (!user || !passwordMatches || user.status !== 'active') {
    limiter?.recordFailure({ username, ip });
    throw createStatusError('Invalid credentials', 401);
  }

  limiter?.recordSuccess({ username, ip });
  const lastLogin = now();
  await user.update({ lastLogin });
  const passwordChangeRecommended = !passwordMeetsPolicy(password);
  return {
    token: signAuthToken(user, { jwtSecret, passwordChangeRecommended }),
    user: { ...serializeAuthUser(user), passwordChangeRecommended },
  };
}

async function changeOwnPassword({
  UserModel,
  bcryptImpl = bcrypt,
} = {}, userId, payload = {}) {
  const currentPassword = payload.currentPassword;
  const newPassword = validatePassword(payload.newPassword);
  if (typeof currentPassword !== 'string' || !currentPassword) {
    throw createStatusError('当前密码和新密码都是必填项', 400);
  }

  const user = await UserModel.findByPk(userId);
  if (!user || user.status !== 'active') throw createStatusError('用户不可用', 401);
  const currentMatches = await bcryptImpl.compare(currentPassword, user.password);
  if (!currentMatches) throw createStatusError('当前密码不正确', 400);
  const reusesCurrentPassword = await bcryptImpl.compare(newPassword, user.password);
  if (reusesCurrentPassword) throw createStatusError('新密码需要与当前密码不同', 400);

  await user.update({ password: await bcryptImpl.hash(newPassword, 10) });
  return { reauthenticationRequired: true };
}

module.exports = {
  authenticateUser,
  changeOwnPassword,
  registerUser,
};
