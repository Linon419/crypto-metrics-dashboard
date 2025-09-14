const axios = require('axios');
require('dotenv').config();

class ApiAuth {
    constructor() {
        this.baseURL = process.env.API_BASE_URL || 'http://localhost:3001/api';
        this.token = null;
        this.tokenExpiry = null;
        this.botUsername = process.env.BOT_API_USERNAME;
        this.botPassword = process.env.BOT_API_PASSWORD;
    }

    // 检查token是否已过期
    isTokenExpired() {
        if (!this.token || !this.tokenExpiry) {
            return true;
        }
        return Date.now() >= this.tokenExpiry;
    }

    // 登录获取JWT token
    async login() {
        try {
            console.log('Attempting to login for API access...');
            
            if (!this.botUsername || !this.botPassword) {
                throw new Error('BOT_API_USERNAME and BOT_API_PASSWORD must be set in environment variables');
            }

            const response = await axios.post(`${this.baseURL}/auth/login`, {
                username: this.botUsername,
                password: this.botPassword
            });

            this.token = response.data.token;
            // JWT通常有7天有效期，我们提前1小时刷新
            this.tokenExpiry = Date.now() + (6 * 24 * 60 * 60 * 1000); // 6天
            
            console.log('API authentication successful');
            return this.token;
        } catch (error) {
            console.error('API login failed:', error.response?.data || error.message);
            throw new Error('Failed to authenticate with API');
        }
    }

    // 获取有效的token
    async getValidToken() {
        if (this.isTokenExpired()) {
            await this.login();
        }
        return this.token;
    }

    // 创建带认证头的axios实例
    async getAuthenticatedAxios() {
        const token = await this.getValidToken();
        return axios.create({
            baseURL: this.baseURL,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
    }

    // API调用包装器
    async makeAuthenticatedRequest(method, endpoint, data = null) {
        try {
            const axiosInstance = await this.getAuthenticatedAxios();
            
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
            // 如果是401错误，token可能过期了，尝试重新登录
            if (error.response?.status === 401) {
                console.log('Token expired, attempting to refresh...');
                this.token = null; // 强制重新登录
                
                try {
                    const axiosInstance = await this.getAuthenticatedAxios();
                    const response = await axiosInstance[method.toLowerCase()](endpoint, data);
                    return response.data;
                } catch (retryError) {
                    console.error('Retry after token refresh failed:', retryError.response?.data || retryError.message);
                    throw retryError;
                }
            }
            
            console.error(`API request failed (${method} ${endpoint}):`, error.response?.data || error.message);
            throw error;
        }
    }
}

// 创建单例实例
const apiAuth = new ApiAuth();

module.exports = apiAuth;