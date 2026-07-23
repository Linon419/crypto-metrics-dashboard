const crypto = require('crypto');
const { getJwtSecret } = require('./authConfig');

const ENCRYPTED_VALUE_PREFIX = 'enc:v1';

function getEncryptionKey() {
  const secret = process.env.AI_SETTINGS_ENCRYPTION_KEY || getJwtSecret();
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptSettingSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    ENCRYPTED_VALUE_PREFIX,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

function decryptSettingSecret(storedValue) {
  if (!storedValue || !storedValue.startsWith(`${ENCRYPTED_VALUE_PREFIX}:`)) {
    return storedValue || null;
  }

  const [, , ivValue, authTagValue, encryptedValue] = storedValue.split(':');
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      getEncryptionKey(),
      Buffer.from(ivValue, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(authTagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    throw new Error('无法解密数据库中的 AI API Key，请检查 AI_SETTINGS_ENCRYPTION_KEY 或 JWT_SECRET');
  }
}

module.exports = {
  decryptSettingSecret,
  encryptSettingSecret,
};
