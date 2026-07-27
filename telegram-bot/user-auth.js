const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001/api';
const REQUEST_TIMEOUT_MS = Number(process.env.BOT_API_TIMEOUT_MS) || 20000;

function resolveEncryptionKey() {
    if (process.env.ENCRYPTION_KEY) {
        return process.env.ENCRYPTION_KEY;
    }

    const dataDir = process.env.DB_PATH
        ? path.dirname(process.env.DB_PATH)
        : path.join(__dirname, 'data');
    const keyPath = process.env.ENCRYPTION_KEY_PATH || path.join(dataDir, 'encryption.key');

    try {
        if (fs.existsSync(keyPath)) {
            const storedKey = fs.readFileSync(keyPath, 'utf8').trim();
            if (storedKey) {
                return storedKey;
            }
        }

        fs.mkdirSync(path.dirname(keyPath), { recursive: true });
        const generatedKey = crypto.randomBytes(32).toString('hex');
        fs.writeFileSync(keyPath, generatedKey, 'utf8');
        return generatedKey;
    } catch (error) {
        console.warn('Failed to load or persist ENCRYPTION_KEY, using a temporary key:', error.message);
        return crypto.randomBytes(32).toString('hex');
    }
}

// Persist the key to avoid invalidating stored credentials on restart.
const ENCRYPTION_KEY = resolveEncryptionKey();
const IV_LENGTH = 16;
const GCM_IV_LENGTH = 12;
// 与服务端 settingSecretEncryption.js 保持同一套格式约定
const ENCRYPTED_VALUE_PREFIX = 'enc:v1';

function getEncryptionKeyBuffer() {
    return crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
}

/**
 * 复刻 OpenSSL 的 EVP_BytesToKey(MD5, 无 salt)。
 *
 * 历史凭据是用 crypto.createCipher 写的，而该 API 在 Node 22 已被移除，
 * 直接调用会抛 TypeError，导致所有已绑定用户既无法使用也无法重新绑定。
 * 这里手工还原它的密钥派生方式，使旧密文仍可解开并就地迁移到新格式。
 * 已对照 `openssl enc -aes-256-cbc -md md5 -nosalt` 验证过 key/iv 完全一致。
 */
function legacyEvpBytesToKey(password, keyLength, ivLength) {
    const passwordBuffer = Buffer.from(password, 'utf8');
    let derived = Buffer.alloc(0);
    let block = Buffer.alloc(0);
    while (derived.length < keyLength + ivLength) {
        block = crypto.createHash('md5').update(Buffer.concat([block, passwordBuffer])).digest();
        derived = Buffer.concat([derived, block]);
    }
    return {
        key: derived.subarray(0, keyLength),
        iv: derived.subarray(keyLength, keyLength + ivLength),
    };
}

/**
 * 旧格式为 `<随机IV十六进制>:<密文十六进制>`。
 * 其中那段随机 IV 是摆设——createCipher 并不接受外部 IV，
 * key 与 iv 都由它自己从口令派生，所以解密时直接丢弃前缀即可。
 */
function decryptLegacyValue(storedValue) {
    const parts = String(storedValue).split(':');
    if (parts.length < 2) {
        throw new Error('Malformed legacy credential');
    }
    parts.shift();
    const encryptedHex = parts.join(':');
    const { key, iv } = legacyEvpBytesToKey(ENCRYPTION_KEY, 32, IV_LENGTH);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    return decipher.update(encryptedHex, 'hex', 'utf8') + decipher.final('utf8');
}

class UserAuth {
    // 设置数据库连接
    static setDatabase(database) {
        this.db = database;
    }

    // 加密密码（AES-256-GCM，带认证标签，IV 每次随机且真正参与运算）
    static encrypt(text) {
        const iv = crypto.randomBytes(GCM_IV_LENGTH);
        const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKeyBuffer(), iv);
        const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
        return [
            ENCRYPTED_VALUE_PREFIX,
            iv.toString('base64url'),
            cipher.getAuthTag().toString('base64url'),
            encrypted.toString('base64url'),
        ].join(':');
    }

    // 判断是否为需要迁移的旧格式密文
    static isLegacyCiphertext(text) {
        return typeof text === 'string' && !text.startsWith(`${ENCRYPTED_VALUE_PREFIX}:`);
    }

    // 解密密码，兼容 createCipher 时代的旧密文
    static decrypt(text) {
        if (this.isLegacyCiphertext(text)) {
            return decryptLegacyValue(text);
        }
        const [, , ivValue, authTagValue, encryptedValue] = String(text).split(':');
        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            getEncryptionKeyBuffer(),
            Buffer.from(ivValue, 'base64url')
        );
        decipher.setAuthTag(Buffer.from(authTagValue, 'base64url'));
        return Buffer.concat([
            decipher.update(Buffer.from(encryptedValue, 'base64url')),
            decipher.final(),
        ]).toString('utf8');
    }

    // 存储用户凭据
    static saveUserCredentials(chatId, username, password) {
        return new Promise((resolve, reject) => {
            const passwordHash = this.encrypt(password);
            
            this.db.run(`INSERT OR REPLACE INTO user_credentials 
                    (chat_id, dashboard_username, dashboard_password_hash, updated_at) 
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
                [chatId, username, passwordHash],
                function(err) {
                    if (err) reject(err);
                    else resolve(true);
                }
            );
        });
    }

    // 获取用户凭据
    static getUserCredentials(chatId) {
        return new Promise((resolve, reject) => {
            this.db.get(`SELECT dashboard_username, dashboard_password_hash, jwt_token, token_expires_at 
                    FROM user_credentials WHERE chat_id = ?`,
                [chatId],
                (err, row) => {
                    if (err) reject(err);
                    else if (!row) resolve(null);
                    else {
                        try {
                            const decryptedPassword = this.decrypt(row.dashboard_password_hash);
                            // 旧密文解开后立即升级为新格式，避免长期依赖已被移除的算法
                            if (this.isLegacyCiphertext(row.dashboard_password_hash)) {
                                this.saveUserCredentials(chatId, row.dashboard_username, decryptedPassword)
                                    .then(() => console.log(`Migrated stored credentials for user ${chatId} to ${ENCRYPTED_VALUE_PREFIX}`))
                                    .catch(migrateError => console.error(
                                        `Failed to migrate credentials for user ${chatId}:`, migrateError.message
                                    ));
                            }
                            resolve({
                                username: row.dashboard_username,
                                password: decryptedPassword,
                                token: row.jwt_token,
                                tokenExpiresAt: row.token_expires_at
                            });
                        } catch (decryptError) {
                            reject(new Error('Failed to decrypt user credentials'));
                        }
                    }
                }
            );
        });
    }

    // 更新JWT token
    static updateUserToken(chatId, token, expiresAt) {
        return new Promise((resolve, reject) => {
            this.db.run(`UPDATE user_credentials 
                    SET jwt_token = ?, token_expires_at = ?, updated_at = CURRENT_TIMESTAMP 
                    WHERE chat_id = ?`,
                [token, expiresAt, chatId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes > 0);
                }
            );
        });
    }

    // 清除用户凭据
    static clearUserCredentials(chatId) {
        return new Promise((resolve, reject) => {
            this.db.run(`DELETE FROM user_credentials WHERE chat_id = ?`,
                [chatId],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.changes > 0);
                }
            );
        });
    }

    // 检查token是否过期
    static isTokenExpired(tokenExpiresAt) {
        if (!tokenExpiresAt) return true;
        return new Date(tokenExpiresAt) <= new Date();
    }

    // 使用用户凭据登录并获取token
    static async loginUser(chatId, username, password) {
        try {
            const response = await axios.post(`${API_BASE_URL}/auth/login`, {
                username: username,
                password: password
            }, { timeout: REQUEST_TIMEOUT_MS });

            const token = response.data.token;
            const expiresAt = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000); // 6天后过期
            
            // 更新数据库中的token
            await this.updateUserToken(chatId, token, expiresAt.toISOString());
            
            return {
                success: true,
                token: token,
                user: response.data.user
            };
        } catch (error) {
            console.error(`Login failed for user ${chatId}:`, error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.error || 'Login failed',
                status: error.response?.status || null
            };
        }
    }

    // 获取用户的有效token
    static async getValidToken(chatId) {
        try {
            const credentials = await this.getUserCredentials(chatId);
            
            if (!credentials) {
                return { success: false, error: 'No credentials stored' };
            }

            // 检查token是否过期
            if (!credentials.token || this.isTokenExpired(credentials.tokenExpiresAt)) {
                console.log(`Token expired for user ${chatId}, attempting to refresh...`);
                return await this.loginUser(chatId, credentials.username, credentials.password);
            }

            return {
                success: true,
                token: credentials.token,
                username: credentials.username
            };
        } catch (error) {
            console.error(`Error getting valid token for user ${chatId}:`, error);
            return { success: false, error: error.message };
        }
    }

    // 为用户创建认证的axios实例
    static async getUserAuthenticatedAxios(chatId) {
        const tokenResult = await this.getValidToken(chatId);
        
        if (!tokenResult.success) {
            throw new Error(tokenResult.error);
        }

        return axios.create({
            baseURL: API_BASE_URL,
            // 不设超时会让单次卡住的请求永远悬着，定时任务随后不断叠加新执行
            timeout: REQUEST_TIMEOUT_MS,
            headers: {
                'Authorization': `Bearer ${tokenResult.token}`,
                'Content-Type': 'application/json'
            }
        });
    }

    static async executeAuthenticatedRequest(axiosInstance, method, endpoint, data = null) {
        switch (method.toLowerCase()) {
            case 'get':
                return axiosInstance.get(endpoint);
            case 'post':
                return axiosInstance.post(endpoint, data);
            case 'put':
                return axiosInstance.put(endpoint, data);
            case 'delete':
                return axiosInstance.delete(endpoint);
            default:
                throw new Error(`Unsupported HTTP method: ${method}`);
        }
    }

    static async refreshUserLogin(chatId) {
        const credentials = await this.getUserCredentials(chatId);
        if (!credentials) return { success: false, error: 'No credentials stored' };
        return this.loginUser(chatId, credentials.username, credentials.password);
    }

    // 由 bot.js 注册的用户通知回调（chatId, message) => Promise
    static setUserNotifier(notifier) {
        this.userNotifier = typeof notifier === 'function' ? notifier : null;
    }

    /**
     * 服务端明确拒绝且用户可自行解决的错误码 → 直接告知用户怎么做，
     * 否则 bot 只会在日志里报错，用户看到的是静默失败。
     * 同一 chatId 同一错误码 6 小时内只提醒一次，避免定时任务刷屏。
     */
    static async notifyActionableError(chatId, error) {
        const code = error.response?.data?.code;
        const messages = {
            PASSWORD_CHANGE_REQUIRED:
                '⚠️ 当前账号仍在使用初始密码，服务端已锁定业务功能。\n'
                + '请先在浏览器登录仪表盘完成密码修改（至少6个字符且非常见弱密码），'
                + '然后使用 /auth 重新绑定新密码。',
            DEMO_ACCOUNT_READ_ONLY:
                'ℹ️ 当前绑定的是演示账号，仅支持浏览类操作。',
        };
        const message = messages[code];
        if (!message || !this.userNotifier) return;

        this.notifiedActionableErrors = this.notifiedActionableErrors || new Map();
        const dedupeKey = `${chatId}:${code}`;
        const lastNotifiedAt = this.notifiedActionableErrors.get(dedupeKey) || 0;
        if (Date.now() - lastNotifiedAt < 6 * 60 * 60 * 1000) return;
        this.notifiedActionableErrors.set(dedupeKey, Date.now());

        try {
            await this.userNotifier(chatId, message);
        } catch (notifyError) {
            console.error(`Failed to notify user ${chatId}:`, notifyError.message);
        }
    }

    // 用户API调用包装器
    static async makeUserAuthenticatedRequest(chatId, method, endpoint, data = null) {
        try {
            const axiosInstance = await this.getUserAuthenticatedAxios(chatId);
            const response = await this.executeAuthenticatedRequest(axiosInstance, method, endpoint, data);
            return response.data;
        } catch (error) {
            if (error.response?.status === 403) {
                await this.notifyActionableError(chatId, error);
            }
            if (error.response?.status === 401) {
                console.log(`Authentication expired for user ${chatId}, refreshing token...`);
                const loginResult = await this.refreshUserLogin(chatId);
                if (loginResult.success) {
                    const retryInstance = await this.getUserAuthenticatedAxios(chatId);
                    const retryResponse = await this.executeAuthenticatedRequest(
                        retryInstance,
                        method,
                        endpoint,
                        data
                    );
                    return retryResponse.data;
                }
                if ([401, 403].includes(loginResult.status)) {
                    await this.clearUserCredentials(chatId);
                }
            }

            console.error(`User API request failed for ${chatId} (${method} ${endpoint}):`, 
                         error.response?.data || error.message);
            throw error;
        }
    }
}

module.exports = UserAuth;
