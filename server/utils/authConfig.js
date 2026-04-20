const DEFAULT_JWT_SECRET = 'fallback-dev-secret-key-change-in-production';

function getJwtSecret() {
  return process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
}

module.exports = {
  DEFAULT_JWT_SECRET,
  getJwtSecret,
};
