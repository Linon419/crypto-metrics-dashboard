const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cron = require('node-cron');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

// 配置
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001/api';

if (!BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN is required in environment variables');
    process.exit(1);
}

// 初始化机器人
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// 初始化数据库
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'bot_data.db');
const db = new sqlite3.Database(dbPath);

// 确保数据目录存在
const fs = require('fs');
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// 创建数据库表
db.serialize(() => {
    // 用户表
    db.run(`CREATE TABLE IF NOT EXISTS users (
        chat_id INTEGER PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        is_subscribed BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 用户收藏的币种表
    db.run(`CREATE TABLE IF NOT EXISTS user_favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER,
        coin_symbol TEXT,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(chat_id, coin_symbol),
        FOREIGN KEY (chat_id) REFERENCES users (chat_id)
    )`);

    // 用户API凭据表（加密存储）
    db.run(`CREATE TABLE IF NOT EXISTS user_credentials (
        chat_id INTEGER PRIMARY KEY,
        dashboard_username TEXT NOT NULL,
        dashboard_password_hash TEXT NOT NULL,
        jwt_token TEXT,
        token_expires_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (chat_id) REFERENCES users (chat_id)
    )`);

    // 通知历史表（用于跟踪已发送的通知）
    db.run(`CREATE TABLE IF NOT EXISTS notification_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER,
        coin_symbol TEXT,
        notification_type TEXT, -- 'quality_entry', 'explosion_alert', 'exit_alert'
        notification_date DATE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(chat_id, coin_symbol, notification_type, notification_date)
    )`);
});

// 设置机器人菜单
async function setupBotMenu() {
    try {
        await bot.setMyCommands([
            { command: 'start', description: '🏠 启动机器人' },
            { command: 'help', description: '❓ 查看帮助' },
            { command: 'auth', description: '🔑 设置账户认证' },
            { command: 'latest', description: '📊 市场概览 (支持按钮分页)' },
            { command: 'check', description: '🔍 查询币种 (例: /check BTC)' },
            { command: 'favorite', description: '⭐ 添加收藏 (例: /favorite ETH)' },
            { command: 'unfavorite', description: '❌ 取消收藏 (例: /unfavorite BTC)' },
            { command: 'myfavorites', description: '📋 我的收藏' },
            { command: 'subscribe', description: '🔔 订阅通知' },
            { command: 'unsubscribe', description: '🔕 取消通知' },
            { command: 'status', description: '📈 查看状态' }
        ]);
        console.log('Bot menu set successfully!');
    } catch (error) {
        console.error('Error setting bot menu:', error);
    }
}

console.log('Crypto Metrics Telegram Bot started successfully!');
setupBotMenu();

// 导入用户认证模块
const UserAuth = require('./user-auth');

// 初始化用户认证模块的数据库连接
UserAuth.setDatabase(db);

// 初始化定时任务
const { initializeDependencies, initializeScheduler, runImmediateCheck } = require('./scheduler');
initializeDependencies(bot, db);
initializeScheduler();

// 获取用户的API数据的辅助函数
async function getUserLatestData(chatId) {
    try {
        const data = await UserAuth.makeUserAuthenticatedRequest(chatId, 'get', '/data/latest');
        return data;
    } catch (error) {
        console.error(`Error fetching latest data for user ${chatId}:`, error.message);
        return null;
    }
}

async function getUserFavoriteCoins(chatId) {
    try {
        const data = await UserAuth.makeUserAuthenticatedRequest(chatId, 'get', '/favorites');
        return data.favorites || [];
    } catch (error) {
        console.error(`Error fetching favorite coins for user ${chatId}:`, error.message);
        return [];
    }
}

// 数据库辅助函数
function addUser(chatId, userInfo) {
    return new Promise((resolve, reject) => {
        // 使用INSERT OR IGNORE先尝试插入，如果已存在则更新非关键字段
        db.run(`INSERT OR IGNORE INTO users (chat_id, username, first_name, last_name, created_at, updated_at) 
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [chatId, userInfo.username, userInfo.first_name, userInfo.last_name],
            function(err) {
                if (err) {
                    reject(err);
                    return;
                }
                
                // 如果记录已存在，只更新用户信息，不影响订阅状态
                db.run(`UPDATE users SET username = ?, first_name = ?, last_name = ?, updated_at = CURRENT_TIMESTAMP 
                        WHERE chat_id = ?`,
                    [userInfo.username, userInfo.first_name, userInfo.last_name, chatId],
                    function(updateErr) {
                        if (updateErr) reject(updateErr);
                        else resolve(this.lastID || chatId);
                    }
                );
            }
        );
    });
}

// 本地收藏功能已移除，现在直接使用Dashboard API

function hasNotificationSent(chatId, coinSymbol, notificationType, date) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT id FROM notification_history 
                WHERE chat_id = ? AND coin_symbol = ? AND notification_type = ? AND notification_date = ?`,
            [chatId, coinSymbol, notificationType, date], (err, row) => {
                if (err) reject(err);
                else resolve(!!row);
            });
    });
}

function recordNotification(chatId, coinSymbol, notificationType, date) {
    return new Promise((resolve, reject) => {
        db.run(`INSERT OR IGNORE INTO notification_history 
                (chat_id, coin_symbol, notification_type, notification_date) VALUES (?, ?, ?, ?)`,
            [chatId, coinSymbol, notificationType, date], function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
    });
}

function getAllSubscribedUsers() {
    return new Promise((resolve, reject) => {
        db.all(`SELECT chat_id FROM users WHERE is_subscribed = 1`, [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows.map(row => row.chat_id));
        });
    });
}

function setUserSubscription(chatId, isSubscribed) {
    return new Promise((resolve, reject) => {
        db.run(`UPDATE users SET is_subscribed = ?, updated_at = CURRENT_TIMESTAMP WHERE chat_id = ?`,
            [isSubscribed ? 1 : 0, chatId], function(err) {
                if (err) reject(err);
                else resolve(this.changes > 0);
            });
    });
}

// 用户状态管理（用于多步骤交互）
const userStates = new Map();

// 设置用户状态
function setUserState(chatId, state, data = {}) {
    userStates.set(chatId, { state, data, timestamp: Date.now() });
}

// 获取用户状态
function getUserState(chatId) {
    const userState = userStates.get(chatId);
    // 清理超过10分钟的状态
    if (userState && Date.now() - userState.timestamp > 10 * 60 * 1000) {
        userStates.delete(chatId);
        return null;
    }
    return userState;
}

// 清除用户状态
function clearUserState(chatId) {
    userStates.delete(chatId);
}

// 检查用户是否已认证
async function isUserAuthenticated(chatId) {
    try {
        const credentials = await UserAuth.getUserCredentials(chatId);
        return credentials !== null;
    } catch (error) {
        return false;
    }
}

// 要求用户进行认证
async function requireAuthentication(chatId, commandName = '') {
    const message = `
🔐 *需要认证*

要使用${commandName ? `${commandName}功能` : '机器人'}，请先连接您的 Crypto Dashboard 账户。

请发送您的用户名：
    `;
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    setUserState(chatId, 'waiting_username');
    return false;
}

// 命令处理器
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const user = msg.from;

    try {
        await addUser(chatId, user);
        
        const isAuthenticated = await isUserAuthenticated(chatId);
        
        let welcomeMessage = `
🎉 欢迎使用加密货币指标监控机器人！

🔸 *主要功能：*
• 查询币种的优质进场期状态
• 优质进场期连续3天提醒
• 收藏币种爆破指数破200提醒  
• 退场期开始重点提醒

🔸 *常用命令：*
/help - 查看帮助
/auth - 设置Dashboard账户认证
/check <币种> - 查询单个币种状态
/latest - 获取最新数据概览（支持按钮分页）
/favorite <币种> - 添加到Dashboard收藏
/unfavorite <币种> - 从Dashboard收藏移除
/myfavorites - 查看Dashboard收藏
/subscribe - 订阅自动通知
/unsubscribe - 取消自动通知
        `;

        if (!isAuthenticated) {
            welcomeMessage += `

🔐 *首次使用需要认证*
请发送 /auth 连接您的 Crypto Dashboard 账户才能使用完整功能。
            `;
        } else {
            welcomeMessage += `

✅ 您的账户已认证，可以开始使用所有功能！
            `;
        }

        await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Error in /start command:', error);
        await bot.sendMessage(chatId, '抱歉，启动时出现错误，请稍后重试。');
    }
});

bot.onText(/\/help/, async (msg) => {
    const helpMessage = `
📖 *帮助文档*

🔹 *基础命令：*
/start - 启动机器人
/help - 显示此帮助信息

🔹 *查询命令：*
/check <币种符号> - 查询指定币种详细信息
例：/check BTC

/latest - 获取最新市场概览
/status - 查看当前订阅状态

🔹 *收藏管理：*
/favorite <币种符号> - 添加币种到收藏列表
例：/favorite ETH

/unfavorite <币种符号> - 从收藏列表移除
例：/unfavorite BTC

/myfavorites - 查看收藏列表

🔹 *通知设置：*
/subscribe - 开启自动通知
/unsubscribe - 关闭自动通知

🔔 *自动通知功能：*
• 优质进场期：连续3天提醒
• 爆破指数提醒：收藏币种破200时通知
• 退场期提醒：进入退场期时重点提醒

💡 提示：币种符号不区分大小写，如BTC、btc都可以
    `;

    await bot.sendMessage(msg.chat.id, helpMessage, { parse_mode: 'Markdown' });
});

// 认证命令
bot.onText(/\/auth/, async (msg) => {
    const chatId = msg.chat.id;

    try {
        await addUser(chatId, msg.from);
        
        const isAuthenticated = await isUserAuthenticated(chatId);
        
        if (isAuthenticated) {
            const credentials = await UserAuth.getUserCredentials(chatId);
            const message = `
✅ *您已认证*

当前连接的账户：${credentials.username}

使用以下命令管理认证：
/reauth - 重新认证
/logout - 注销登录
            `;
            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        } else {
            await requireAuthentication(chatId, '认证');
        }
    } catch (error) {
        console.error('Error in /auth command:', error);
        await bot.sendMessage(chatId, '❌ 认证检查时出现错误，请稍后重试。');
    }
});

// 重新认证命令
bot.onText(/\/reauth/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
        await addUser(chatId, msg.from);
        clearUserState(chatId); // 清除任何现有状态
        await requireAuthentication(chatId, '重新认证');
    } catch (error) {
        console.error('Error in /reauth command:', error);
        await bot.sendMessage(chatId, '❌ 重新认证时出现错误，请稍后重试。');
    }
});

// 注销命令
bot.onText(/\/logout/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
        await addUser(chatId, msg.from);
        const cleared = await UserAuth.clearUserCredentials(chatId);
        clearUserState(chatId);
        
        if (cleared) {
            await bot.sendMessage(chatId, '✅ 已成功注销。使用 /auth 可重新认证。');
        } else {
            await bot.sendMessage(chatId, '❌ 您还没有认证过。');
        }
    } catch (error) {
        console.error('Error in /logout command:', error);
        await bot.sendMessage(chatId, '❌ 注销时出现错误，请稍后重试。');
    }
});

// 消息处理器（处理认证流程）
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    // 跳过命令消息
    if (text?.startsWith('/')) {
        return;
    }
    
    const userState = getUserState(chatId);
    if (!userState) {
        return;
    }
    
    try {
        if (userState.state === 'waiting_username') {
            // 用户发送了用户名
            const username = text.trim();
            
            if (!username || username.length < 2) {
                await bot.sendMessage(chatId, '❌ 用户名太短，请重新输入：');
                return;
            }
            
            setUserState(chatId, 'waiting_password', { username });
            await bot.sendMessage(chatId, `
📝 用户名: ${username}

现在请发送您的密码：
⚠️ 为了安全，请确保在私聊中发送
            `);
            
        } else if (userState.state === 'waiting_password') {
            // 用户发送了密码
            const password = text;
            const username = userState.data.username;
            
            if (!password || password.length < 3) {
                await bot.sendMessage(chatId, '❌ 密码太短，请重新输入：');
                return;
            }
            
            // 显示验证中消息
            await bot.sendMessage(chatId, '🔄 正在验证您的凭据...');
            
            // 尝试登录
            const loginResult = await UserAuth.loginUser(chatId, username, password);
            
            if (loginResult.success) {
                // 保存凭据
                await UserAuth.saveUserCredentials(chatId, username, password);
                clearUserState(chatId);
                
                const successMessage = `
✅ *认证成功！*

欢迎，${loginResult.user.username}！

您现在可以使用所有机器人功能：
/check <币种> - 查询币种信息
/latest - 获取市场概览
/favorite <币种> - 管理收藏
/subscribe - 订阅通知

开始探索吧！
                `;
                
                await bot.sendMessage(chatId, successMessage, { parse_mode: 'Markdown' });
            } else {
                await bot.sendMessage(chatId, `❌ 认证失败: ${loginResult.error}\n\n请重新开始认证流程：/auth`);
                clearUserState(chatId);
            }
        }
    } catch (error) {
        console.error('Error in message handler:', error);
        await bot.sendMessage(chatId, '❌ 处理您的消息时出现错误，请重新开始：/auth');
        clearUserState(chatId);
    }
});

// 查询单个币种信息
bot.onText(/\/check (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const coinSymbol = match[1].trim().toUpperCase();

    try {
        await addUser(chatId, msg.from);
        
        // 检查用户是否已认证
        const isAuthenticated = await isUserAuthenticated(chatId);
        if (!isAuthenticated) {
            await requireAuthentication(chatId, '查询币种信息');
            return;
        }
        
        const data = await getUserLatestData(chatId);
        if (!data || !data.success) {
            await bot.sendMessage(chatId, '❌ 暂时无法获取数据，请稍后重试。\n如果问题持续，请尝试重新认证：/reauth');
            return;
        }

        const coinData = data.metrics.find(metric => 
            metric.coin.symbol.toUpperCase() === coinSymbol
        );

        if (!coinData) {
            await bot.sendMessage(chatId, `❌ 未找到币种 ${coinSymbol} 的数据。`);
            return;
        }

        const message = formatCoinInfo(coinData);
        
        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        
    } catch (error) {
        console.error('Error in /check command:', error);
        if (error.response?.status === 401) {
            await bot.sendMessage(chatId, '❌ 认证已过期，请重新认证：/reauth');
        } else {
            await bot.sendMessage(chatId, '❌ 查询时出现错误，请稍后重试。');
        }
    }
});

// 生成latest数据的可重用函数
async function generateLatestData(chatId, page = 1) {
    const pageSize = 8; // 每页显示8个币种
    
    const data = await getUserLatestData(chatId);
    if (!data || !data.success) {
        throw new Error('无法获取数据');
    }

    // 统计数据
    const metrics = data.metrics || [];
    const entryCoins = metrics.filter(m => m.entry_exit_type === 'entry');
    const exitCoins = metrics.filter(m => m.entry_exit_type === 'exit');
    const qualityEntryCoins = metrics.filter(m => 
        m.entry_exit_type === 'entry' && 
        (m.period_quality === '高质量进场' || m.period_quality?.includes('高质量'))
    );

    // 按场外指数排序（降序）
    const sortedQualityCoins = qualityEntryCoins.sort((a, b) => 
        (b.otc_index || 0) - (a.otc_index || 0)
    );

    // 分页计算
    const totalPages = Math.ceil(sortedQualityCoins.length / pageSize);
    const startIndex = (page - 1) * pageSize;
    const currentPageCoins = sortedQualityCoins.slice(startIndex, startIndex + pageSize);

    let message = `📊 *市场概览* (${data.date})\n\n`;
    message += `📈 进场期币种：${entryCoins.length} 个\n`;
    message += `📉 退场期币种：${exitCoins.length} 个\n`;
    message += `⭐ 优质进场期：${qualityEntryCoins.length} 个\n\n`;

    // 显示当前页的优质进场期币种
    if (currentPageCoins.length > 0) {
        message += `🌟 *优质进场期币种* (第${page}/${totalPages}页)：\n\n`;
        currentPageCoins.forEach((coin, index) => {
            const num = startIndex + index + 1;
            message += `${num}. **${coin.coin.name} (${coin.coin.symbol})**\n`;
            message += `   📊 场外指数：${coin.otc_index || 'N/A'}\n`;
            message += `   💥 爆破指数：${coin.explosion_index || 'N/A'}\n`;
            message += `   📈 ${getTypeDisplay(coin.entry_exit_type)}第${coin.entry_exit_day}天\n`;
            message += `   ⭐ ${coin.period_quality}\n\n`;
        });
    } else if (qualityEntryCoins.length > 0 && page > totalPages) {
        message += `❌ 页面不存在。总共${totalPages}页\n\n`;
    }

    // 显示爆破指数>200的币种（始终显示，不分页）
    const highExplosionCoins = metrics.filter(m => m.explosion_index > 200)
        .sort((a, b) => (b.explosion_index || 0) - (a.explosion_index || 0));
    
    if (highExplosionCoins.length > 0) {
        message += `🚀 *爆破指数>200* (按爆破指数排序)：\n`;
        highExplosionCoins.slice(0, 5).forEach(coin => {
            message += `• **${coin.coin.name} (${coin.coin.symbol})**: ${coin.explosion_index}\n`;
        });
        if (highExplosionCoins.length > 5) {
            message += `...和其他 ${highExplosionCoins.length - 5} 个币种\n`;
        }
        message += '\n';
    }

    message += '💡 使用 /check <币种> 查看详细信息';
    
    // 创建分页按钮
    const keyboard = [];
    if (qualityEntryCoins.length > 0 && totalPages > 1) {
        const row = [];
        if (page > 1) {
            row.push({ text: '⬅️ 上一页', callback_data: `latest_${page - 1}` });
        }
        row.push({ text: `${page}/${totalPages}`, callback_data: 'latest_current' });
        if (page < totalPages) {
            row.push({ text: '下一页 ➡️', callback_data: `latest_${page + 1}` });
        }
        keyboard.push(row);
    }
    
    return { message, keyboard };
}

// 获取最新数据概览 - 支持分页
bot.onText(/\/latest(?:\s+(\d+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const page = parseInt(match?.[1]) || 1; // 默认第1页

    try {
        await addUser(chatId, msg.from);
        
        // 检查用户是否已认证
        const isAuthenticated = await isUserAuthenticated(chatId);
        if (!isAuthenticated) {
            await requireAuthentication(chatId, '获取市场概览');
            return;
        }
        
        const { message, keyboard } = await generateLatestData(chatId, page);
        
        const options = { 
            parse_mode: 'Markdown',
            reply_markup: keyboard.length > 0 ? { inline_keyboard: keyboard } : undefined
        };
        
        await bot.sendMessage(chatId, message, options);
        
    } catch (error) {
        console.error('Error in /latest command:', error);
        if (error.response?.status === 401) {
            await bot.sendMessage(chatId, '❌ 认证已过期，请重新认证：/reauth');
        } else {
            await bot.sendMessage(chatId, '❌ 获取数据时出现错误，请稍后重试。');
        }
    }
});

// 收藏管理命令
bot.onText(/\/favorite (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const coinSymbol = match[1].trim().toUpperCase();

    try {
        await addUser(chatId, msg.from);
        
        // 检查用户是否已认证
        const isAuthenticated = await isUserAuthenticated(chatId);
        if (!isAuthenticated) {
            await requireAuthentication(chatId, '收藏币种');
            return;
        }
        
        // 验证币种存在
        const data = await getUserLatestData(chatId);
        if (!data || !data.success) {
            await bot.sendMessage(chatId, '❌ 暂时无法验证币种，请稍后重试。');
            return;
        }

        const coinExists = data.metrics.some(metric => 
            metric.coin.symbol.toUpperCase() === coinSymbol
        );

        if (!coinExists) {
            await bot.sendMessage(chatId, `❌ 币种 ${coinSymbol} 不存在或暂无数据。`);
            return;
        }

        // 调用Dashboard API添加收藏
        try {
            const response = await UserAuth.makeUserAuthenticatedRequest(chatId, 'post', '/favorites', {
                symbol: coinSymbol
            });
            
            if (response.message === 'Favorite added') {
                await bot.sendMessage(chatId, `✅ 已将 ${coinSymbol} 添加到Dashboard收藏列表！`);
            } else {
                await bot.sendMessage(chatId, `📌 ${coinSymbol} 已在您的Dashboard收藏列表中。`);
            }
        } catch (apiError) {
            console.error('Dashboard API error:', apiError);
            await bot.sendMessage(chatId, '❌ 添加收藏失败，请检查网络连接或稍后重试。');
        }
        
    } catch (error) {
        console.error('Error in /favorite command:', error);
        await bot.sendMessage(chatId, '❌ 添加收藏时出现错误，请稍后重试。');
    }
});

bot.onText(/\/unfavorite (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const coinSymbol = match[1].trim().toUpperCase();

    try {
        await addUser(chatId, msg.from);
        
        // 检查用户是否已认证
        const isAuthenticated = await isUserAuthenticated(chatId);
        if (!isAuthenticated) {
            await requireAuthentication(chatId, '取消收藏');
            return;
        }
        
        // 调用Dashboard API删除收藏
        try {
            await UserAuth.makeUserAuthenticatedRequest(chatId, 'delete', `/favorites/${coinSymbol}`);
            await bot.sendMessage(chatId, `✅ 已将 ${coinSymbol} 从Dashboard收藏列表移除。`);
        } catch (apiError) {
            if (apiError.response?.status === 404) {
                await bot.sendMessage(chatId, `❌ ${coinSymbol} 不在您的Dashboard收藏列表中。`);
            } else {
                console.error('Dashboard API error:', apiError);
                await bot.sendMessage(chatId, '❌ 移除收藏失败，请检查网络连接或稍后重试。');
            }
        }
        
    } catch (error) {
        console.error('Error in /unfavorite command:', error);
        await bot.sendMessage(chatId, '❌ 移除收藏时出现错误，请稍后重试。');
    }
});

bot.onText(/\/myfavorites/, async (msg) => {
    const chatId = msg.chat.id;

    try {
        await addUser(chatId, msg.from);
        
        // 检查用户是否已认证
        const isAuthenticated = await isUserAuthenticated(chatId);
        if (!isAuthenticated) {
            await requireAuthentication(chatId, '查看收藏列表');
            return;
        }
        
        // 获取Dashboard收藏列表
        let favorites;
        try {
            favorites = await UserAuth.makeUserAuthenticatedRequest(chatId, 'get', '/favorites');
        } catch (apiError) {
            console.error('Dashboard API error:', apiError);
            await bot.sendMessage(chatId, '❌ 获取收藏列表失败，请检查网络连接或稍后重试。');
            return;
        }
        
        if (!favorites || favorites.length === 0) {
            await bot.sendMessage(chatId, '📭 您的Dashboard收藏列表为空。\n\n使用 /favorite <币种> 添加收藏。');
            return;
        }

        let message = `📋 *您的Dashboard收藏列表* (${favorites.length} 个币种):\n\n`;
        
        // 获取最新数据以显示收藏币种的当前状态
        const data = await getUserLatestData(chatId);
        if (data && data.success) {
            favorites.forEach(symbol => {
                const coinData = data.metrics.find(m => m.coin.symbol === symbol);
                if (coinData) {
                    const status = getStatusEmoji(coinData);
                    message += `${status} ${symbol} - ${coinData.period_quality || '观望'}\n`;
                } else {
                    message += `📊 ${symbol} - 暂无数据\n`;
                }
            });
        } else {
            favorites.forEach(symbol => {
                message += `📊 ${symbol}\n`;
            });
        }
        
        message += '\n💡 使用 /check <币种> 查看详细信息\n';
        message += '🗑️ 使用 /unfavorite <币种> 移除收藏';
        
        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        
    } catch (error) {
        console.error('Error in /myfavorites command:', error);
        await bot.sendMessage(chatId, '❌ 获取收藏列表时出现错误，请稍后重试。');
    }
});

// 订阅管理
bot.onText(/\/subscribe/, async (msg) => {
    const chatId = msg.chat.id;

    try {
        await addUser(chatId, msg.from);
        await setUserSubscription(chatId, true);
        
        const message = `
✅ *订阅成功！*

您将收到以下类型的实时通知：
📊 *实时数据更新监控*（下午2:00-8:00悉尼时间，每30分钟检测）
┣━ 🌟 优质进场期机会发现
┣━ 🚀 爆破指数转正提醒
┣━ ⚠️ 收藏币种爆破指数破200
┣━ 📉 收藏币种退场期提醒
┣━ 🎯 收藏币种逼近期提醒
┗━ 📈 市场重要变化通知

💡 智能提醒特色：
• 实时监控：基于实际数据变化触发
• 综合通知：将多种变化合并为一条消息
• 去重机制：避免重复提醒同一事件
• 个性化：基于您的Dashboard收藏列表
• 使用 /unsubscribe 可随时取消订阅
        `;
        
        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        
    } catch (error) {
        console.error('Error in /subscribe command:', error);
        await bot.sendMessage(chatId, '❌ 订阅时出现错误，请稍后重试。');
    }
});

bot.onText(/\/unsubscribe/, async (msg) => {
    const chatId = msg.chat.id;

    try {
        await addUser(chatId, msg.from);
        await setUserSubscription(chatId, false);
        
        await bot.sendMessage(chatId, '✅ 已取消订阅。您将不再收到自动通知。\n\n使用 /subscribe 可重新订阅。');
        
    } catch (error) {
        console.error('Error in /unsubscribe command:', error);
        await bot.sendMessage(chatId, '❌ 取消订阅时出现错误，请稍后重试。');
    }
});

bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;

    try {
        await addUser(chatId, msg.from);
        
        // 检查用户是否已认证
        const isAuthenticated = await isUserAuthenticated(chatId);
        if (!isAuthenticated) {
            await requireAuthentication(chatId, '查看状态');
            return;
        }
        
        // 获取订阅状态和Dashboard收藏
        const subscribedUsers = await getAllSubscribedUsers();
        const isSubscribed = subscribedUsers.includes(chatId);
        
        let favorites = [];
        try {
            favorites = await UserAuth.makeUserAuthenticatedRequest(chatId, 'get', '/favorites');
        } catch (apiError) {
            console.error('Error fetching favorites for status:', apiError);
            // 如果获取收藏失败，继续显示其他信息
        }
        
        let message = `📊 *您的状态*\n\n`;
        message += `🔑 认证状态：✅ 已认证\n`;
        message += `🔔 通知订阅：${isSubscribed ? '✅ 已开启' : '❌ 已关闭'}\n`;
        message += `⭐ Dashboard收藏：${favorites.length || 0} 个\n`;
        
        if (favorites.length > 0) {
            message += `\n📋 收藏列表：\n`;
            favorites.forEach(symbol => {
                message += `• ${symbol}\n`;
            });
        }
        
        message += `\n💡 提示：\n`;
        message += `• 收藏数据来自您的Dashboard账户\n`;
        message += `• 监控提醒基于Dashboard收藏列表\n`;
        message += `• 使用 /subscribe 开启通知`;
        
        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        
    } catch (error) {
        console.error('Error in /status command:', error);
        await bot.sendMessage(chatId, '❌ 获取状态时出现错误，请稍后重试。');
    }
});

// 管理员命令 - 手动触发检查
bot.onText(/\/admin_check/, async (msg) => {
    const chatId = msg.chat.id;
    const adminChatIds = process.env.ADMIN_CHAT_IDS ? 
        process.env.ADMIN_CHAT_IDS.split(',').map(id => parseInt(id.trim())) : 
        [];

    if (adminChatIds.length === 0 || !adminChatIds.includes(chatId)) {
        await bot.sendMessage(chatId, '❌ 您没有管理员权限。');
        return;
    }

    try {
        await bot.sendMessage(chatId, '🔄 开始执行手动检查...');
        
        await runImmediateCheck();
        
        await bot.sendMessage(chatId, '✅ 手动检查执行完成！');
    } catch (error) {
        console.error('Error in admin check:', error);
        await bot.sendMessage(chatId, '❌ 执行检查时出现错误。');
    }
});

// 管理员统计命令
bot.onText(/\/admin_stats/, async (msg) => {
    const chatId = msg.chat.id;
    const adminChatIds = process.env.ADMIN_CHAT_IDS ? 
        process.env.ADMIN_CHAT_IDS.split(',').map(id => parseInt(id.trim())) : 
        [];

    if (adminChatIds.length === 0 || !adminChatIds.includes(chatId)) {
        await bot.sendMessage(chatId, '❌ 您没有管理员权限。');
        return;
    }

    try {
        const stats = await getBotStats();
        
        const message = `
📊 *机器人统计*

👥 总用户数：${stats.totalUsers}
🔔 订阅用户数：${stats.subscribedUsers}
⭐ 总收藏数：${stats.totalFavorites}
📨 今日通知数：${stats.todayNotifications}

💡 活跃用户比例：${(stats.subscribedUsers / stats.totalUsers * 100).toFixed(1)}%
        `;
        
        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Error in admin stats:', error);
        await bot.sendMessage(chatId, '❌ 获取统计信息时出现错误。');
    }
});

// 获取机器人统计信息
function getBotStats() {
    return new Promise((resolve, reject) => {
        const today = new Date().toISOString().split('T')[0];
        
        db.serialize(() => {
            let stats = {};
            
            // 总用户数
            db.get(`SELECT COUNT(*) as count FROM users`, [], (err, row) => {
                if (err) return reject(err);
                stats.totalUsers = row.count;
                
                // 订阅用户数
                db.get(`SELECT COUNT(*) as count FROM users WHERE is_subscribed = 1`, [], (err, row) => {
                    if (err) return reject(err);
                    stats.subscribedUsers = row.count;
                    
                    // 总收藏数
                    db.get(`SELECT COUNT(*) as count FROM user_favorites`, [], (err, row) => {
                        if (err) return reject(err);
                        stats.totalFavorites = row.count;
                        
                        // 今日通知数
                        db.get(`SELECT COUNT(*) as count FROM notification_history WHERE DATE(created_at) = ?`, 
                            [today], (err, row) => {
                                if (err) return reject(err);
                                stats.todayNotifications = row.count;
                                resolve(stats);
                            });
                    });
                });
            });
        });
    });
}

// 辅助函数
function formatCoinInfo(coinData) {
    const coin = coinData.coin;
    const status = getStatusEmoji(coinData);
    const priceDisplay = coin.current_price ? `$${coin.current_price}` : '暂无价格';
    
    let message = `${status} *${coin.symbol}* (${coin.name})\n\n`;
    message += `💰 当前价格：${priceDisplay}\n`;
    message += `📊 场外指数：${coinData.otc_index || 'N/A'}\n`;
    message += `💥 爆破指数：${coinData.explosion_index || 'N/A'}\n`;
    message += `🎯 谢林点：${coinData.schelling_point || 'N/A'}\n`;
    message += `📈 类型：${getTypeDisplay(coinData.entry_exit_type)}\n`;
    
    if (coinData.entry_exit_type !== 'neutral') {
        message += `📅 第${coinData.entry_exit_day}天\n`;
    }
    
    message += `⭐ 质量评估：${coinData.period_quality || '观望'}\n`;
    
    // 显示变化百分比
    if (coinData.otc_index_change_percent !== null) {
        const otcChange = coinData.otc_index_change_percent > 0 ? '+' : '';
        message += `📊 场外变化：${otcChange}${coinData.otc_index_change_percent.toFixed(2)}%\n`;
    }
    
    if (coinData.explosion_index_change_percent !== null) {
        const expChange = coinData.explosion_index_change_percent > 0 ? '+' : '';
        message += `💥 爆破变化：${expChange}${coinData.explosion_index_change_percent.toFixed(2)}%\n`;
    }
    
    if (coinData.near_threshold) {
        message += `\n⚠️ 接近阈值`;
    }
    
    return message;
}

function getStatusEmoji(coinData) {
    if (coinData.entry_exit_type === 'entry') {
        if (coinData.period_quality?.includes('高质量')) return '🌟';
        if (coinData.period_quality?.includes('低质量')) return '⚠️';
        return '📈';
    } else if (coinData.entry_exit_type === 'exit') {
        if (coinData.period_quality?.includes('高质量')) return '✅';
        if (coinData.period_quality?.includes('低质量')) return '🚨';
        return '📉';
    }
    return '📊';
}

function getTypeDisplay(type) {
    switch (type) {
        case 'entry': return '进场期';
        case 'exit': return '退场期';
        default: return '观望期';
    }
}

// 处理Inline Keyboard按钮点击
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;

    try {
        // 处理latest分页按钮
        if (data.startsWith('latest_')) {
            if (data === 'latest_current') {
                // 当前页按钮，只需要回答callback query
                await bot.answerCallbackQuery(callbackQuery.id, { text: '当前页面' });
                return;
            }

            const page = parseInt(data.replace('latest_', ''));
            if (isNaN(page)) {
                await bot.answerCallbackQuery(callbackQuery.id, { text: '无效页码' });
                return;
            }

            // 检查用户是否已认证
            const isAuthenticated = await isUserAuthenticated(chatId);
            if (!isAuthenticated) {
                await bot.answerCallbackQuery(callbackQuery.id, { text: '请先认证账户' });
                return;
            }

            // 生成新页面数据
            const { message, keyboard } = await generateLatestData(chatId, page);
            
            const options = { 
                parse_mode: 'Markdown',
                reply_markup: keyboard.length > 0 ? { inline_keyboard: keyboard } : undefined
            };

            // 编辑原消息
            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                ...options
            });

            // 回答callback query
            await bot.answerCallbackQuery(callbackQuery.id, { text: `已切换到第${page}页` });
        }
    } catch (error) {
        console.error('Error handling callback query:', error);
        await bot.answerCallbackQuery(callbackQuery.id, { text: '操作失败，请稍后重试' });
    }
});

module.exports = { bot, db };