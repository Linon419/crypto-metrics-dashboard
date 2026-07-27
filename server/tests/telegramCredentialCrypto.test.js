/**
 * 回归用例：Telegram 凭据加解密必须在 Node >= 22 上可用，并能读旧密文。
 *
 * 背景：user-auth.js 原先使用 crypto.createCipher / createDecipher，
 * 这两个 API 在 Node 22 已被移除，于是：
 *   - 所有已绑定用户的 getUserCredentials 都抛错 -> 被判为未认证；
 *   - /auth 重新绑定时 encrypt 同样抛错 -> 永远绑不上。
 * 表现是 /latest 等命令一律回复"获取数据时出现错误，请稍后重试"。
 *
 * 这里同时锁住三件事：
 *   1. 新格式 encrypt/decrypt round-trip 正常；
 *   2. 旧格式（EVP_BytesToKey + MD5 + 无 salt）仍能解开，老用户无需重新绑定；
 *   3. 代码里不再出现已被移除的 createCipher / createDecipher。
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 让 user-auth.js 使用一个确定的密钥，避免落到仓库里的 data/encryption.key
const TEST_KEY = 'unit-test-encryption-key-do-not-use';
process.env.ENCRYPTION_KEY = TEST_KEY;

const UserAuth = require('../../telegram-bot/user-auth');

// 用 EVP_BytesToKey(MD5, 无 salt) 复刻 createCipher 的输出，模拟历史数据
function makeLegacyCiphertext(plaintext, password) {
  const passwordBuffer = Buffer.from(password, 'utf8');
  let derived = Buffer.alloc(0);
  let block = Buffer.alloc(0);
  while (derived.length < 48) {
    block = crypto.createHash('md5').update(Buffer.concat([block, passwordBuffer])).digest();
    derived = Buffer.concat([derived, block]);
  }
  const key = derived.subarray(0, 32);
  const iv = derived.subarray(32, 48);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = cipher.update(plaintext, 'utf8', 'hex') + cipher.final('hex');
  // 旧实现会在前面拼一段没有实际参与运算的随机 IV
  return crypto.randomBytes(16).toString('hex') + ':' + encrypted;
}

function run() {
  // 1. 新格式 round-trip
  const secret = 'p@ssw0rd-中文-🙂';
  const encrypted = UserAuth.encrypt(secret);
  assert.ok(
    encrypted.startsWith('enc:v1:'),
    `新密文应带 enc:v1 前缀，实际为 ${encrypted.slice(0, 16)}`
  );
  assert.strictEqual(UserAuth.decrypt(encrypted), secret, '新格式 round-trip 失败');

  // 相同明文两次加密必须不同（IV 真正参与运算）
  assert.notStrictEqual(
    UserAuth.encrypt(secret),
    UserAuth.encrypt(secret),
    '两次加密结果相同，说明 IV 未生效'
  );

  // 2. 旧密文仍可解开
  const legacyPlain = 'legacy-dashboard-password';
  const legacyCipher = makeLegacyCiphertext(legacyPlain, TEST_KEY);
  assert.ok(UserAuth.isLegacyCiphertext(legacyCipher), '应识别出旧格式密文');
  assert.strictEqual(
    UserAuth.decrypt(legacyCipher),
    legacyPlain,
    '旧格式密文解密失败，会导致已绑定用户全部掉线且无法重新绑定'
  );
  assert.ok(!UserAuth.isLegacyCiphertext(encrypted), '新密文不应被判为旧格式');

  // 3. 源码里不得再出现已被移除的 API
  const source = fs.readFileSync(
    path.join(__dirname, '../../telegram-bot/user-auth.js'),
    'utf8'
  );
  assert.ok(
    !/crypto\.createCipher\s*\(/.test(source),
    'crypto.createCipher 在 Node 22 已被移除，不得再使用'
  );
  assert.ok(
    !/crypto\.createDecipher\s*\(/.test(source),
    'crypto.createDecipher 在 Node 22 已被移除，不得再使用'
  );

  console.log('telegramCredentialCrypto.test.js passed');
}

run();
