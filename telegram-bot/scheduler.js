const cron = require('node-cron');
const axios = require('axios');
require('dotenv').config();

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001/api';

// 导入用户认证模块
const UserAuth = require('./user-auth');

// 全局变量存储引用
let bot = null;
let db = null;

// 初始化函数
function initializeDependencies(botInstance, dbInstance) {
    bot = botInstance;
    db = dbInstance;
    UserAuth.setDatabase(dbInstance);
}

// 获取用户数据的辅助函数
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

// 检查用户是否已认证
async function isUserAuthenticated(chatId) {
    try {
        const credentials = await UserAuth.getUserCredentials(chatId);
        return credentials !== null;
    } catch (error) {
        return false;
    }
}

// 数据库查询函数
function getAllSubscribedUsers() {
    return new Promise((resolve, reject) => {
        db.all(`SELECT chat_id FROM users WHERE is_subscribed = 1`, [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows.map(row => row.chat_id));
        });
    });
}

// 本地收藏功能已移除，现在使用Dashboard API

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

// 每2小时轮询所有币种，检查高质量进场期且在进场期初期的币种
async function checkAllCoinsQualityEntry() {
    console.log('Polling all coins for quality entry opportunities...');
    
    try {
        const subscribedUsers = await getAllSubscribedUsers();
        const now = new Date();
        const currentHour = now.toISOString().slice(0, 13); // YYYY-MM-DDTHH format
        
        console.log(`Checking quality entry for ${subscribedUsers.length} subscribed users`);

        for (const chatId of subscribedUsers) {
            // 检查用户是否已认证
            const isAuthenticated = await isUserAuthenticated(chatId);
            if (!isAuthenticated) {
                console.log(`User ${chatId} not authenticated, skipping polling`);
                continue;
            }

            try {
                const data = await getUserLatestData(chatId);
                if (!data || !data.success) {
                    console.log(`No data available for user ${chatId}`);
                    continue;
                }

                // 找到高质量进场期且在初期（1-7天）的币种
                const qualityEarlyEntryCoins = data.metrics.filter(metric => 
                    metric.entry_exit_type === 'entry' && 
                    (metric.period_quality === '高质量进场' || metric.period_quality?.includes('高质量')) &&
                    metric.entry_exit_day >= 1 && metric.entry_exit_day <= 7 // 进场期初期
                );

                console.log(`Found ${qualityEarlyEntryCoins.length} quality early entry coins for user ${chatId}`);

                for (const coinData of qualityEarlyEntryCoins) {
                    const coinSymbol = coinData.coin.symbol;
                    
                    // 检查是否已经在这个时间段发送过通知（避免同一天同一时间重复发送）
                    const alreadySent = await hasNotificationSent(chatId, coinSymbol, 'quality_early_entry', currentHour);
                    
                    if (!alreadySent) {
                        const message = `
🌟 *高质量进场期机会*

**${coinData.coin.name} (${coinSymbol})**
⭐ 质量评估：${coinData.period_quality || '待评估'}
📈 ${getTypeDisplay(coinData.entry_exit_type)}第${coinData.entry_exit_day}天（初期）
💥 爆破指数：${coinData.explosion_index || 'N/A'}
📊 场外指数：${coinData.otc_index || 'N/A'}
🎯 谢林点：${coinData.schelling_point || 'N/A'}

💡 处于高质量进场期初期，值得关注！
                        `;
                        
                        try {
                            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                            await recordNotification(chatId, coinSymbol, 'quality_early_entry', currentHour);
                            console.log(`Quality early entry notification sent to ${chatId} for ${coinSymbol}`);
                        } catch (error) {
                            console.error(`Failed to send quality early entry notification to ${chatId}:`, error);
                        }
                    }
                }
            } catch (userError) {
                console.error(`Error processing quality entry polling for user ${chatId}:`, userError);
            }
        }
    } catch (error) {
        console.error('Error in quality entry polling:', error);
    }
}

// 轮询用户收藏的币种，检查爆破指数跌破200和退场期
async function checkFavoriteCoinsAlerts() {
    console.log('Polling favorite coins for explosion drop and exit alerts...');
    
    try {
        const subscribedUsers = await getAllSubscribedUsers();
        const now = new Date();
        const currentTime = now.toISOString(); // 完整时间戳，用于精确去重
        
        console.log(`Checking favorite alerts for ${subscribedUsers.length} subscribed users`);

        for (const chatId of subscribedUsers) {
            // 检查用户是否已认证
            const isAuthenticated = await isUserAuthenticated(chatId);
            if (!isAuthenticated) {
                console.log(`User ${chatId} not authenticated, skipping favorite alerts`);
                continue;
            }

            try {
                // 获取用户的最新数据
                const data = await getUserLatestData(chatId);
                if (!data || !data.success) {
                    console.log(`No latest data available for user ${chatId}`);
                    continue;
                }

                // 获取用户Dashboard的收藏列表（API调用）
                const userFavoriteCoins = await getUserFavoriteCoins(chatId);
                console.log(`User ${chatId} has ${userFavoriteCoins.length} favorite coins from Dashboard`);

                for (const favoriteSymbol of userFavoriteCoins) {
                    const coinData = data.metrics.find(m => m.coin.symbol === favoriteSymbol);
                    
                    if (!coinData) {
                        console.log(`No data found for favorite coin ${favoriteSymbol} for user ${chatId}`);
                        continue;
                    }

                    const currentHour = now.toISOString().slice(0, 13); // YYYY-MM-DDTHH

                    // 1. 检查爆破指数跌破200（从>200降到<200）
                    if (coinData.explosion_index < 200) {
                        const alreadySentExplosion = await hasNotificationSent(chatId, favoriteSymbol, 'explosion_drop_200', currentHour);
                        
                        if (!alreadySentExplosion) {
                            const message = `
⚠️ *收藏币种爆破指数跌破200*

**${coinData.coin.name} (${favoriteSymbol})**
💥 爆破指数：${coinData.explosion_index || 'N/A'} (⬇️ 跌破200)
📊 场外指数：${coinData.otc_index || 'N/A'}
📈 当前状态：${getTypeDisplay(coinData.entry_exit_type)}${coinData.entry_exit_day ? `第${coinData.entry_exit_day}天` : ''}
⭐ 质量评估：${coinData.period_quality || '待评估'}
🎯 谢林点：${coinData.schelling_point || 'N/A'}

⚠️ 爆破指数已跌破关键阈值，请注意风险！
                            `;
                            
                            try {
                                await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                                await recordNotification(chatId, favoriteSymbol, 'explosion_drop_200', currentHour);
                                console.log(`Explosion drop notification sent to ${chatId} for ${favoriteSymbol}`);
                            } catch (error) {
                                console.error(`Failed to send explosion drop notification to ${chatId}:`, error);
                            }
                        }
                    }

                    // 2. 检查进入退场期
                    if (coinData.entry_exit_type === 'exit') {
                        const alreadySentExit = await hasNotificationSent(chatId, favoriteSymbol, 'favorite_exit_alert', currentHour);
                        
                        if (!alreadySentExit) {
                            const message = `
🚨 *收藏币种进入退场期*

**${coinData.coin.name} (${favoriteSymbol})**
📉 已进入${getTypeDisplay(coinData.entry_exit_type)}第${coinData.entry_exit_day}天
💥 爆破指数：${coinData.explosion_index || 'N/A'}
📊 场外指数：${coinData.otc_index || 'N/A'}
⭐ 质量评估：${coinData.period_quality || '待评估'}
🎯 谢林点：${coinData.schelling_point || 'N/A'}

🔔 建议密切关注并考虑调整仓位策略！
                            `;
                            
                            try {
                                await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                                await recordNotification(chatId, favoriteSymbol, 'favorite_exit_alert', currentHour);
                                console.log(`Favorite exit alert sent to ${chatId} for ${favoriteSymbol}`);
                            } catch (error) {
                                console.error(`Failed to send favorite exit alert to ${chatId}:`, error);
                            }
                        }
                    }
                }
            } catch (userError) {
                console.error(`Error processing favorite alerts for user ${chatId}:`, userError);
            }
        }
    } catch (error) {
        console.error('Error in favorite coins alerts check:', error);
    }
}

// 删除原有的checkExitAlerts函数，功能已合并到checkFavoriteCoinsAlerts中

// 辅助函数：判断是否应该发送优质进场期通知
async function shouldSendQualityEntryNotification(coinSymbol, coinData) {
    // 简化的连续3天逻辑 - 在实际应用中，可以查询历史数据来确认
    // 这里基于进场天数和质量评估来判断
    
    if (coinData.entry_exit_day >= 1 && coinData.entry_exit_day <= 7) {
        // 进场期前7天内，且是高质量
        return coinData.period_quality?.includes('高质量');
    }
    
    return false;
}

function getTypeDisplay(type) {
    switch (type) {
        case 'entry': return '进场期';
        case 'exit': return '退场期';
        default: return '观望期';
    }
}

// 定时任务设置
function initializeScheduler() {
    console.log('Initializing scheduler...');

    // 每2小时轮询所有币种的高质量进场期机会
    cron.schedule('0 */2 * * *', async () => {
        console.log('Running 2-hourly all coins quality entry polling');
        await checkAllCoinsQualityEntry();
    }, {
        timezone: "Asia/Shanghai"
    });

    // 每2小时轮询用户收藏币种的爆破指数和退场期状态
    cron.schedule('30 */2 * * *', async () => {
        console.log('Running 2-hourly favorite coins alerts check');
        await checkFavoriteCoinsAlerts();
    }, {
        timezone: "Asia/Shanghai"
    });

    console.log('Scheduler initialized with the following jobs:');
    console.log('- Every 2 hours (00:00, 02:00, 04:00...): All coins quality entry polling');
    console.log('- Every 2 hours (00:30, 02:30, 04:30...): Favorite coins explosion & exit alerts');
}

// 立即执行一次检查（用于测试）
async function runImmediateCheck() {
    console.log('Running immediate check...');
    await checkAllCoinsQualityEntry();
    await checkFavoriteCoinsAlerts();
    console.log('Immediate check completed');
}

module.exports = {
    initializeDependencies,
    initializeScheduler,
    runImmediateCheck,
    checkAllCoinsQualityEntry,
    checkFavoriteCoinsAlerts
};