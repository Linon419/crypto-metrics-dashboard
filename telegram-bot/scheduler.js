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
        const currentDate = now.toISOString().slice(0, 10); // YYYY-MM-DD format
        
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

                // 找到爆破指数由负转正的币种
                const explosionTurnPositiveCoins = data.metrics.filter(metric => 
                    metric.explosion_index > 0 && 
                    metric.explosion_index_change_percent && 
                    metric.explosion_index_change_percent > 0 &&
                    // 需要确保之前是负数，现在是正数（简化判断：变化幅度大且现在为正）
                    metric.explosion_index <= 50 && // 刚转正，通常不会太高
                    metric.explosion_index_change_percent > 20 // 显著的正向变化
                );

                console.log(`Found ${qualityEarlyEntryCoins.length} quality early entry coins and ${explosionTurnPositiveCoins.length} explosion turn positive coins for user ${chatId}`);

                for (const coinData of qualityEarlyEntryCoins) {
                    const coinSymbol = coinData.coin.symbol;
                    
                    // 检查是否已经在今天发送过通知
                    const alreadySent = await hasNotificationSent(chatId, coinSymbol, 'quality_early_entry', currentDate);
                    
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
                            await recordNotification(chatId, coinSymbol, 'quality_early_entry', currentDate);
                            console.log(`Quality early entry notification sent to ${chatId} for ${coinSymbol}`);
                        } catch (error) {
                            console.error(`Failed to send quality early entry notification to ${chatId}:`, error);
                        }
                    }
                }

                // 处理爆破指数由负转正的币种通知
                for (const coinData of explosionTurnPositiveCoins) {
                    const coinSymbol = coinData.coin.symbol;
                    
                    // 检查是否已经在今天发送过通知
                    const alreadySent = await hasNotificationSent(chatId, coinSymbol, 'explosion_turn_positive', currentDate);
                    
                    if (!alreadySent) {
                        const message = `
🚀 *爆破指数由负转正*

**${coinData.coin.name} (${coinSymbol})**
💥 爆破指数：${coinData.explosion_index || 'N/A'} (📈 转正)
📊 爆破变化：+${coinData.explosion_index_change_percent?.toFixed(2)}%
📈 当前状态：${getTypeDisplay(coinData.entry_exit_type)}${coinData.entry_exit_day ? `第${coinData.entry_exit_day}天` : ''}
🎯 场外指数：${coinData.otc_index || 'N/A'}
⭐ 质量评估：${coinData.period_quality || '待评估'}

🔥 爆破指数从负数转为正数，市场情绪回暖！
                        `;
                        
                        try {
                            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                            await recordNotification(chatId, coinSymbol, 'explosion_turn_positive', currentDate);
                            console.log(`Explosion turn positive notification sent to ${chatId} for ${coinSymbol}`);
                        } catch (error) {
                            console.error(`Failed to send explosion turn positive notification to ${chatId}:`, error);
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
        const currentDate = now.toISOString().slice(0, 10); // YYYY-MM-DD format
        
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

                    // 使用当前日期进行去重检查

                    // 1. 检查爆破指数跌破200（从>200降到<200）
                    if (coinData.explosion_index < 200) {
                        const alreadySentExplosion = await hasNotificationSent(chatId, favoriteSymbol, 'explosion_drop_200', currentDate);
                        
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
                                await recordNotification(chatId, favoriteSymbol, 'explosion_drop_200', currentDate);
                                console.log(`Explosion drop notification sent to ${chatId} for ${favoriteSymbol}`);
                            } catch (error) {
                                console.error(`Failed to send explosion drop notification to ${chatId}:`, error);
                            }
                        }
                    }

                    // 2. 检查进入退场期
                    if (coinData.entry_exit_type === 'exit') {
                        const alreadySentExit = await hasNotificationSent(chatId, favoriteSymbol, 'favorite_exit_alert', currentDate);
                        
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
                                await recordNotification(chatId, favoriteSymbol, 'favorite_exit_alert', currentDate);
                                console.log(`Favorite exit alert sent to ${chatId} for ${favoriteSymbol}`);
                            } catch (error) {
                                console.error(`Failed to send favorite exit alert to ${chatId}:`, error);
                            }
                        }
                    }

                    // 3. 检查进入逼近期
                    if (coinData.near_threshold || 
                        (coinData.entry_exit_type === 'neutral' && coinData.explosion_index > 0 && coinData.explosion_index < 100)) {
                        const alreadySentNear = await hasNotificationSent(chatId, favoriteSymbol, 'favorite_near_threshold', currentDate);
                        
                        if (!alreadySentNear) {
                            const message = `
⚠️ *收藏币种进入逼近期*

**${coinData.coin.name} (${favoriteSymbol})**
🎯 当前状态：逼近关键阈值
💥 爆破指数：${coinData.explosion_index || 'N/A'}
📊 场外指数：${coinData.otc_index || 'N/A'}
⭐ 质量评估：${coinData.period_quality || '待评估'}
🎯 谢林点：${coinData.schelling_point || 'N/A'}

💡 币种正接近重要阈值，可能即将突破或回调！
                            `;
                            
                            try {
                                await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                                await recordNotification(chatId, favoriteSymbol, 'favorite_near_threshold', currentDate);
                                console.log(`Favorite near threshold alert sent to ${chatId} for ${favoriteSymbol}`);
                            } catch (error) {
                                console.error(`Failed to send favorite near threshold alert to ${chatId}:`, error);
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

// 检查数据更新并推送通知
async function checkDataUpdates() {
    console.log('Checking for dashboard data updates...');
    
    try {
        const subscribedUsers = await getAllSubscribedUsers();
        console.log(`Checking data updates for ${subscribedUsers.length} subscribed users`);

        for (const chatId of subscribedUsers) {
            // 检查用户是否已认证
            const isAuthenticated = await isUserAuthenticated(chatId);
            if (!isAuthenticated) {
                console.log(`User ${chatId} not authenticated, skipping data update check`);
                continue;
            }

            try {
                const data = await getUserLatestData(chatId);
                if (!data || !data.success) {
                    console.log(`No latest data available for user ${chatId}`);
                    continue;
                }

                // 检查数据更新时间（假设API返回数据有更新时间字段）
                const currentDate = new Date().toISOString().slice(0, 10);
                const updateKey = `data_update_${currentDate}`;
                
                // 检查是否已经发送过今天的数据更新通知
                const alreadyNotified = await hasNotificationSent(chatId, 'SYSTEM', 'data_update', currentDate);
                
                if (!alreadyNotified) {
                    // 获取所有重要变化和通知
                    const allNotifications = [];
                    
                    // 1. 分析全市场重要变化
                    const significantChanges = analyzeDataChanges(data.metrics);
                    if (significantChanges.length > 0) {
                        allNotifications.push({
                            type: 'market_changes',
                            title: '📊 市场重要变化',
                            content: significantChanges
                        });
                    }
                    
                    // 2. 检查收藏币种状态
                    const favoriteAlerts = await checkUserFavoriteAlerts(chatId, data.metrics);
                    if (favoriteAlerts.length > 0) {
                        allNotifications.push({
                            type: 'favorite_alerts',
                            title: '⭐ 收藏币种提醒',
                            content: favoriteAlerts
                        });
                    }
                    
                    // 3. 检查优质进场期机会
                    const qualityOpportunities = await analyzeQualityOpportunities(data.metrics, chatId, currentDate);
                    if (qualityOpportunities.length > 0) {
                        allNotifications.push({
                            type: 'quality_opportunities',
                            title: '🌟 优质机会发现',
                            content: qualityOpportunities
                        });
                    }
                    
                    // 4. 检查动能指标
                    const momentumAlerts = await analyzeMomentumIndicators(data.metrics, chatId, currentDate);
                    if (momentumAlerts.length > 0) {
                        allNotifications.push({
                            type: 'momentum_alerts',
                            title: '⚡ 动能信号',
                            content: momentumAlerts
                        });
                    }
                    
                    if (allNotifications.length > 0) {
                        const message = formatComprehensiveNotification(allNotifications);
                        
                        try {
                            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                            await recordNotification(chatId, 'SYSTEM', 'data_update', currentDate);
                            
                            // 为进场期前3天的币种记录特殊的通知历史
                            const qualityOpps = allNotifications.find(n => n.type === 'quality_opportunities');
                            if (qualityOpps) {
                                for (const opp of qualityOpps.content) {
                                    if (opp.isEarlyEntry && opp.notificationKey) {
                                        await recordNotification(chatId, opp.coin.symbol, opp.notificationKey, currentDate);
                                    }
                                }
                            }
                            
                            // 记录动能指标通知
                            const momentumAlerts = allNotifications.find(n => n.type === 'momentum_alerts');
                            if (momentumAlerts) {
                                for (const alert of momentumAlerts.content) {
                                    if (alert.notificationKey) {
                                        await recordNotification(chatId, alert.coin.symbol, alert.notificationKey, currentDate);
                                    }
                                }
                            }
                            
                            console.log(`Comprehensive notification sent to ${chatId} with ${allNotifications.length} types`);
                        } catch (error) {
                            console.error(`Failed to send comprehensive notification to ${chatId}:`, error);
                        }
                    }
                }
            } catch (userError) {
                console.error(`Error checking data updates for user ${chatId}:`, userError);
            }
        }
    } catch (error) {
        console.error('Error in data update check:', error);
    }
}

// 分析数据变化
function analyzeDataChanges(metrics) {
    const significantChanges = [];
    
    metrics.forEach(metric => {
        // 检查爆破指数显著变化 (>50%变化)
        if (metric.explosion_index_change_percent && Math.abs(metric.explosion_index_change_percent) > 50) {
            significantChanges.push({
                coin: metric.coin,
                changeType: '💥 爆破指数大幅变化',
                description: `${metric.explosion_index_change_percent > 0 ? '+' : ''}${metric.explosion_index_change_percent.toFixed(1)}%`
            });
        }
        
        // 检查场外指数显著变化 (>30%变化)
        if (metric.otc_index_change_percent && Math.abs(metric.otc_index_change_percent) > 30) {
            significantChanges.push({
                coin: metric.coin,
                changeType: '📊 场外指数大幅变化',
                description: `${metric.otc_index_change_percent > 0 ? '+' : ''}${metric.otc_index_change_percent.toFixed(1)}%`
            });
        }
        
        // 检查进退场状态变化
        if (metric.entry_exit_type === 'entry' && metric.entry_exit_day === 1) {
            significantChanges.push({
                coin: metric.coin,
                changeType: '📈 新进入进场期',
                description: `质量评估：${metric.period_quality || '待评估'}`
            });
        }
        
        if (metric.entry_exit_type === 'exit' && metric.entry_exit_day === 1) {
            significantChanges.push({
                coin: metric.coin,
                changeType: '📉 新进入退场期',
                description: `质量评估：${metric.period_quality || '待评估'}`
            });
        }
    });
    
    return significantChanges.slice(0, 5); // 最多显示5个重要变化
}

// 检查用户收藏币种的所有状态
async function checkUserFavoriteAlerts(chatId, metrics) {
    const alerts = [];
    
    try {
        // 获取用户Dashboard的收藏列表
        const userFavoriteCoins = await getUserFavoriteCoins(chatId);
        
        for (const favoriteSymbol of userFavoriteCoins) {
            const coinData = metrics.find(m => m.coin.symbol === favoriteSymbol);
            
            if (!coinData) continue;
            
            // 检查爆破指数跌破200
            if (coinData.explosion_index < 200) {
                alerts.push({
                    coin: coinData.coin,
                    alertType: '⚠️ 爆破指数跌破200',
                    description: `爆破指数：${coinData.explosion_index}`,
                    priority: 'high'
                });
            }
            
            // 检查退场期
            if (coinData.entry_exit_type === 'exit') {
                alerts.push({
                    coin: coinData.coin,
                    alertType: '📉 进入退场期',
                    description: `退场期第${coinData.entry_exit_day}天`,
                    priority: 'high'
                });
            }
            
            // 检查逼近期
            if (coinData.near_threshold || 
                (coinData.entry_exit_type === 'neutral' && coinData.explosion_index > 0 && coinData.explosion_index < 100)) {
                alerts.push({
                    coin: coinData.coin,
                    alertType: '🎯 进入逼近期',
                    description: '逼近关键阈值',
                    priority: 'medium'
                });
            }
        }
    } catch (error) {
        console.error(`Error checking favorite alerts for user ${chatId}:`, error);
    }
    
    return alerts.slice(0, 3); // 最多显示3个收藏提醒
}

// 检查动能指标并发送通知
async function checkMomentumIndicators() {
    console.log('Checking momentum indicators for all subscribed users...');
    
    try {
        const subscribedUsers = await getAllSubscribedUsers();
        const now = new Date();
        const currentDate = now.toISOString().slice(0, 10); // YYYY-MM-DD format
        
        console.log(`Checking momentum indicators for ${subscribedUsers.length} subscribed users`);

        for (const chatId of subscribedUsers) {
            // 检查用户是否已认证
            const isAuthenticated = await isUserAuthenticated(chatId);
            if (!isAuthenticated) {
                console.log(`User ${chatId} not authenticated, skipping momentum indicators`);
                continue;
            }

            try {
                const data = await getUserLatestData(chatId);
                if (!data || !data.success) {
                    console.log(`No data available for user ${chatId}`);
                    continue;
                }

                // 查找有动能指标的币种
                const coinsWithMomentum = data.metrics.filter(metric => 
                    metric.momentumIndicators && 
                    Array.isArray(metric.momentumIndicators) && 
                    metric.momentumIndicators.length > 0
                );

                console.log(`Found ${coinsWithMomentum.length} coins with momentum indicators for user ${chatId}`);

                for (const coinData of coinsWithMomentum) {
                    const coinSymbol = coinData.coin.symbol;
                    const momentumIndicators = coinData.momentumIndicators;
                    
                    // 为每个特殊动能指标检查是否需要发送通知
                    for (const indicator of momentumIndicators) {
                        const notificationKey = `momentum_${indicator}`;
                        const alreadySent = await hasNotificationSent(chatId, coinSymbol, notificationKey, currentDate);
                        
                        if (!alreadySent) {
                            const message = formatMomentumNotification(coinData, indicator);
                            
                            try {
                                await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                                await recordNotification(chatId, coinSymbol, notificationKey, currentDate);
                                console.log(`Momentum ${indicator} notification sent to ${chatId} for ${coinSymbol}`);
                            } catch (error) {
                                console.error(`Failed to send momentum ${indicator} notification to ${chatId}:`, error);
                            }
                        }
                    }
                }
            } catch (userError) {
                console.error(`Error processing momentum indicators for user ${chatId}:`, userError);
            }
        }
    } catch (error) {
        console.error('Error in momentum indicators check:', error);
    }
}

// 格式化动能指标通知消息
function formatMomentumNotification(coinData, indicator) {
    const coin = coinData.coin;
    
    // 动能指标的含义和颜色配置
    const indicatorConfig = {
        '$': { 
            title: '🌟 向上动能强劲', 
            description: '该币种此时有较大的向上动能，可以重点关注',
            priority: 'high'
        },
        '※': { 
            title: '🚀 高速油门期', 
            description: '爆破指数高于200，处于高速油门期',
            priority: 'high'
        },
        '‼': { 
            title: '⚠️ 短期撤出信号', 
            description: '爆破指数从200以上跌至200以下，短期可撤出落袋为安的信号',
            priority: 'high'
        },
        '↑': { 
            title: '📈 连续上涨通道', 
            description: '爆破指数连续2-3天持续上涨，最灵敏的走出阴跌行情进入上升通道指标',
            priority: 'medium'
        },
        'w': { 
            title: '🤔 巨头犹豫期', 
            description: '在退场天数后标注，表示场外巨头准备撤场但可能有犹豫的特殊情况',
            priority: 'medium'
        }
    };
    
    const config = indicatorConfig[indicator] || { 
        title: `📊 动能信号 ${indicator}`, 
        description: '检测到特殊动能信号',
        priority: 'medium'
    };
    
    let message = `${config.title}\n\n`;
    message += `**${coin.name} (${coin.symbol})**\n\n`;
    message += `🎯 **动能信号**: ${indicator}\n`;
    message += `💡 **含义**: ${config.description}\n\n`;
    message += `📊 **当前数据**:\n`;
    message += `• 场外指数：${coinData.otc_index || 'N/A'}\n`;
    message += `• 爆破指数：${coinData.explosion_index || 'N/A'}\n`;
    message += `• 谢林点：${coinData.schelling_point || 'N/A'}\n`;
    
    if (coinData.entry_exit_type && coinData.entry_exit_type !== 'neutral') {
        message += `• 状态：${getTypeDisplay(coinData.entry_exit_type)}第${coinData.entry_exit_day}天\n`;
    }
    
    if (coinData.period_quality) {
        message += `• 质量评估：${coinData.period_quality}\n`;
    }
    
    // 根据不同指标添加特定建议
    if (indicator === '$') {
        message += `\n💎 **建议**: 重点关注，具备较强向上动能\n`;
    } else if (indicator === '※') {
        message += `\n🚀 **建议**: 高速油门期，注意风险控制\n`;
    } else if (indicator === '‼') {
        message += `\n⚠️ **建议**: 短期撤出信号，考虑落袋为安\n`;
    } else if (indicator === '↑') {
        message += `\n📈 **建议**: 连续上涨，可关注上升通道机会\n`;
    } else if (indicator === 'w') {
        message += `\n🤔 **建议**: 巨头犹豫期，密切观察动向\n`;
    }
    
    return message;
}

// 分析优质机会
async function analyzeQualityOpportunities(metrics, chatId, currentDate) {
    const opportunities = [];
    
    // 优质进场期机会 - 分为两类处理
    const qualityEntryCoins = metrics.filter(metric => 
        metric.entry_exit_type === 'entry' && 
        (metric.period_quality === '高质量进场' || metric.period_quality?.includes('高质量')) &&
        metric.entry_exit_day >= 1 && metric.entry_exit_day <= 7
    );
    
    for (const coin of qualityEntryCoins) {
        // 对于前3天的进场期，使用特殊的去重逻辑（每天都可以通知）
        if (coin.entry_exit_day <= 3) {
            const notificationKey = `quality_entry_day_${coin.entry_exit_day}`;
            const alreadySent = await hasNotificationSent(chatId, coin.coin.symbol, notificationKey, currentDate);
            
            if (!alreadySent) {
                opportunities.push({
                    coin: coin.coin,
                    opportunityType: '🌟 高质量进场期初期',
                    description: `第${coin.entry_exit_day}天 - ${coin.period_quality}`,
                    indices: {
                        explosion: coin.explosion_index,
                        otc: coin.otc_index
                    },
                    notificationKey: notificationKey,
                    isEarlyEntry: true
                });
            }
        } else {
            // 4-7天的进场期，使用普通逻辑（避免重复）
            opportunities.push({
                coin: coin.coin,
                opportunityType: '🌟 高质量进场期',
                description: `第${coin.entry_exit_day}天 - ${coin.period_quality}`,
                indices: {
                    explosion: coin.explosion_index,
                    otc: coin.otc_index
                },
                isEarlyEntry: false
            });
        }
    }
    
    // 爆破指数由负转正
    const explosionTurnPositiveCoins = metrics.filter(metric => 
        metric.explosion_index > 0 && 
        metric.explosion_index_change_percent && 
        metric.explosion_index_change_percent > 0
        // 移除额外限制：只要当前为正且有正向变化就通知
    );
    
    explosionTurnPositiveCoins.forEach(coin => {
        opportunities.push({
            coin: coin.coin,
            opportunityType: '🚀 爆破指数转正',
            description: `+${coin.explosion_index_change_percent.toFixed(1)}% 转正`,
            indices: {
                explosion: coin.explosion_index,
                otc: coin.otc_index
            },
            isEarlyEntry: false
        });
    });
    
    return opportunities.slice(0, 5); // 增加到最多显示5个机会
}

// 分析动能指标
async function analyzeMomentumIndicators(metrics, chatId, currentDate) {
    const alerts = [];
    
    // 查找有动能指标的币种
    const coinsWithMomentum = metrics.filter(metric => 
        metric.momentumIndicators && 
        Array.isArray(metric.momentumIndicators) && 
        metric.momentumIndicators.length > 0
    );
    
    for (const coin of coinsWithMomentum) {
        for (const indicator of coin.momentumIndicators) {
            const notificationKey = `momentum_${indicator}`;
            const alreadySent = await hasNotificationSent(chatId, coin.coin.symbol, notificationKey, currentDate);
            
            if (!alreadySent) {
                const indicatorConfig = {
                    '$': { title: '🌟 向上动能强劲', priority: 'high' },
                    '※': { title: '🚀 高速油门期', priority: 'high' },
                    '‼': { title: '⚠️ 短期撤出信号', priority: 'high' },
                    '↑': { title: '📈 连续上涨通道', priority: 'medium' },
                    'w': { title: '🤔 巨头犹豫期', priority: 'medium' }
                };
                
                const config = indicatorConfig[indicator] || { 
                    title: `📊 动能信号 ${indicator}`, 
                    priority: 'medium'
                };
                
                alerts.push({
                    coin: coin.coin,
                    indicator: indicator,
                    title: config.title,
                    priority: config.priority,
                    indices: {
                        explosion: coin.explosion_index,
                        otc: coin.otc_index
                    },
                    notificationKey: notificationKey
                });
            }
        }
    }
    
    return alerts.slice(0, 3); // 最多显示3个动能信号
}

// 格式化综合通知消息
function formatComprehensiveNotification(notifications) {
    let message = `📱 *实时数据更新*\n\n`;
    
    notifications.forEach((notification, index) => {
        message += `${notification.title}\n`;
        
        if (notification.type === 'market_changes') {
            notification.content.forEach(change => {
                message += `• **${change.coin.name} (${change.coin.symbol})**\n`;
                message += `   ${change.changeType}: ${change.description}\n`;
                message += `   📊 场外：${change.coin.otc_index || 'N/A'} | 💥 爆破：${change.coin.explosion_index || 'N/A'}\n`;
            });
        } else if (notification.type === 'favorite_alerts') {
            notification.content.forEach(alert => {
                message += `• **${alert.coin.name} (${alert.coin.symbol})**\n`;
                message += `   ${alert.alertType}: ${alert.description}\n`;
            });
        } else if (notification.type === 'quality_opportunities') {
            notification.content.forEach(opp => {
                message += `• **${opp.coin.name} (${opp.coin.symbol})**\n`;
                message += `   ${opp.opportunityType}: ${opp.description}\n`;
                if (opp.isEarlyEntry) {
                    message += `   🔥 *进场期黄金时间* - 持续关注\n`;
                }
                message += `   📊 场外：${opp.indices.otc || 'N/A'} | 💥 爆破：${opp.indices.explosion || 'N/A'}\n`;
            });
        } else if (notification.type === 'momentum_alerts') {
            notification.content.forEach(alert => {
                message += `• **${alert.coin.name} (${alert.coin.symbol})**\n`;
                message += `   ${alert.title}: ${alert.indicator}\n`;
                message += `   📊 场外：${alert.indices.otc || 'N/A'} | 💥 爆破：${alert.indices.explosion || 'N/A'}\n`;
            });
        }
        
        if (index < notifications.length - 1) {
            message += '\n';
        }
    });
    
    message += `\n⏰ ${new Date().toLocaleString('zh-CN', {timeZone: 'Australia/Sydney'})}`;
    
    return message;
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

    // 移除固定时间的定时通知，只保留实时数据更新检测

    // 下午2点到晚上8点，每30分钟检查一次数据更新
    cron.schedule('*/30 14-20 * * *', async () => {
        console.log('Running data update check');
        await checkDataUpdates();
    }, {
        timezone: "Australia/Sydney"
    });

    console.log('Scheduler initialized with the following jobs:');
    console.log('- Every 30 minutes (2:00 PM - 8:00 PM): Real-time data update checks with comprehensive monitoring');
}

// 立即执行一次检查（用于测试）
async function runImmediateCheck() {
    console.log('Running immediate check...');
    await checkAllCoinsQualityEntry();
    await checkFavoriteCoinsAlerts();
    await checkMomentumIndicators();
    console.log('Immediate check completed');
}

module.exports = {
    initializeDependencies,
    initializeScheduler,
    runImmediateCheck,
    checkAllCoinsQualityEntry,
    checkFavoriteCoinsAlerts,
    checkDataUpdates,
    checkMomentumIndicators
};