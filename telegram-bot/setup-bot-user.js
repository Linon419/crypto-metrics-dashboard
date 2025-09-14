#!/usr/bin/env node
/**
 * 为 Telegram 机器人创建专用的 API 用户账户
 * 运行此脚本来设置机器人的认证凭据
 */

const axios = require('axios');
const readline = require('readline');
require('dotenv').config();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function setupBotUser() {
    console.log('🤖 Telegram 机器人 API 用户设置\n');

    try {
        // 获取配置信息
        const apiUrl = process.env.API_BASE_URL || await question('请输入 API 基础 URL (默认: http://localhost:3001/api): ') || 'http://localhost:3001/api';
        
        console.log(`\n使用 API URL: ${apiUrl}`);
        
        const username = process.env.BOT_API_USERNAME || await question('请输入机器人用户名 (默认: telegram_bot): ') || 'telegram_bot';
        const password = process.env.BOT_API_PASSWORD || await question('请输入机器人密码: ');
        
        if (!password) {
            throw new Error('密码不能为空');
        }

        // 尝试注册用户
        console.log('\n📝 正在创建机器人用户...');
        
        try {
            const response = await axios.post(`${apiUrl}/auth/register`, {
                username: username,
                password: password,
                email: `${username}@telegram-bot.local` // 可选的邮箱
            });
            
            console.log('✅ 机器人用户创建成功!');
            console.log(`用户名: ${username}`);
            console.log(`用户ID: ${response.data.user.id}`);
            console.log(`角色: ${response.data.user.role}`);
            
        } catch (registerError) {
            if (registerError.response?.status === 400 && registerError.response?.data?.error?.includes('already exists')) {
                console.log('ℹ️  用户已存在，尝试登录验证...');
                
                // 尝试登录验证凭据
                try {
                    const loginResponse = await axios.post(`${apiUrl}/auth/login`, {
                        username: username,
                        password: password
                    });
                    
                    console.log('✅ 用户凭据验证成功!');
                    console.log(`用户名: ${loginResponse.data.user.username}`);
                    console.log(`用户ID: ${loginResponse.data.user.id}`);
                    console.log(`角色: ${loginResponse.data.user.role}`);
                    
                } catch (loginError) {
                    console.error('❌ 用户存在但密码不正确');
                    console.error('请检查密码或使用不同的用户名');
                    throw loginError;
                }
            } else {
                throw registerError;
            }
        }

        // 测试 API 访问
        console.log('\n🧪 测试 API 访问...');
        
        const loginResponse = await axios.post(`${apiUrl}/auth/login`, {
            username: username,
            password: password
        });
        
        const token = loginResponse.data.token;
        
        // 测试获取数据
        const testResponse = await axios.get(`${apiUrl}/data/latest`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        console.log('✅ API 访问测试成功!');
        console.log(`获取到 ${testResponse.data.metrics?.length || 0} 条币种数据`);
        
        // 输出环境变量配置
        console.log('\n📋 请将以下配置添加到 .env 文件:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`BOT_API_USERNAME=${username}`);
        console.log(`BOT_API_PASSWORD=${password}`);
        console.log(`API_BASE_URL=${apiUrl}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        console.log('\n🎉 设置完成! 现在可以启动 Telegram 机器人了。');
        
    } catch (error) {
        console.error('\n❌ 设置失败:');
        console.error(error.response?.data || error.message);
        
        if (error.code === 'ECONNREFUSED') {
            console.error('\n💡 提示: 请确保 crypto-metrics-dashboard 服务正在运行');
            console.error('   启动命令: npm run server');
        }
    } finally {
        rl.close();
    }
}

// 如果直接运行此脚本
if (require.main === module) {
    setupBotUser().catch(error => {
        console.error('Setup failed:', error);
        process.exit(1);
    });
}

module.exports = { setupBotUser };