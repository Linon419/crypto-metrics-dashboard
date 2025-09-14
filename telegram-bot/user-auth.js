const axios = require('axios');
const crypto = require('crypto');
const { db } = require('./bot');
require('dotenv').config();

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001/api';

// 用于加密密码的密钥（在生产环境中应该使用更安全的方法）
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32);
const IV_LENGTH = 16;

class UserAuth {
    // 加密密码
    static encrypt(text) {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipher('aes-256-cbc', ENCRYPTION_KEY);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return iv.toString('hex') + ':' + encrypted;
    }

    // 解密密码
    static decrypt(text) {
        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = textParts.join(':');
        const decipher = crypto.createDecipher('aes-256-cbc', ENCRYPTION_KEY);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }

    // 存储用户凭据
    static saveUserCredentials(chatId, username, password) {
        return new Promise((resolve, reject) => {
            const passwordHash = this.encrypt(password);
            
            db.run(`INSERT OR REPLACE INTO user_credentials 
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
            db.get(`SELECT dashboard_username, dashboard_password_hash, jwt_token, token_expires_at 
                    FROM user_credentials WHERE chat_id = ?`,
                [chatId],
                (err, row) => {
                    if (err) reject(err);
                    else if (!row) resolve(null);
                    else {
                        try {
                            const decryptedPassword = this.decrypt(row.dashboard_password_hash);
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
            db.run(`UPDATE user_credentials 
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
            db.run(`DELETE FROM user_credentials WHERE chat_id = ?`,
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
            });

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
                error: error.response?.data?.error || 'Login failed'
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
            headers: {
                'Authorization': `Bearer ${tokenResult.token}`,
                'Content-Type': 'application/json'
            }
        });
    }

    // 用户API调用包装器
    static async makeUserAuthenticatedRequest(chatId, method, endpoint, data = null) {
        try {
            const axiosInstance = await this.getUserAuthenticatedAxios(chatId);
            
            let response;
            switch (method.toLowerCase()) {
                case 'get':
                    response = await axiosInstance.get(endpoint);
                    break;
                case 'post':
                    response = await axiosInstance.post(endpoint, data);
                    break;
                case 'put':
                    response = await axiosInstance.put(endpoint, data);
                    break;
                case 'delete':
                    response = await axiosInstance.delete(endpoint);
                    break;
                default:
                    throw new Error(`Unsupported HTTP method: ${method}`);
            }
            
            return response.data;
        } catch (error) {
            // 如果是401错误，清除存储的token并要求重新认证
            if (error.response?.status === 401) {
                console.log(`Authentication failed for user ${chatId}, clearing credentials...`);
                await this.clearUserCredentials(chatId);
            }
            
            console.error(`User API request failed for ${chatId} (${method} ${endpoint}):`, 
                         error.response?.data || error.message);
            throw error;
        }
    }
}

module.exports = UserAuth;