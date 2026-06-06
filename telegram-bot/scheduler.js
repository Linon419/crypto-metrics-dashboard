const cron = require('node-cron');
const axios = require('axios');
require('dotenv').config();

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001/api';

// 导入用户认证模块
const UserAuth = require('./user-auth');

// 全局变量存储引用
let bot = null;
let db = null;

// 存储上次检查的数据快照
const lastDataSnapshot = new Map();

// 创建数据快照用于比较
function createDataSnapshot(data) {
    return {
        date: data.date,
        totalCoins: data.metrics.length,
        coins: data.metrics.map(metric => ({
            symbol: metric.coin.symbol,
            otc_index: metric.otc_index,
            explosion_index: metric.explosion_index,
            entry_exit_type: metric.entry_exit_type,
            entry_exit_day: metric.entry_exit_day,
            period_quality: metric.period_quality,
            near_threshold: metric.near_threshold,
            momentumIndicators: metric.momentumIndicators,
            strategy_signal_level: getStrategySignal(metric)?.level || null
        }))
    };
}

// 检查数据是否有变化
function hasDataChanged(lastSnapshot, currentSnapshot) {
    // 如果数据日期不同，说明有更新
    if (lastSnapshot.date !== currentSnapshot.date) {
        return true;
    }

    // 如果币种数量不同
    if (lastSnapshot.totalCoins !== currentSnapshot.totalCoins) {
        return true;
    }

    // 检查关键指标变化
    for (let i = 0; i < currentSnapshot.coins.length; i++) {
        const current = currentSnapshot.coins[i];
        const last = lastSnapshot.coins.find(c => c.symbol === current.symbol);

        if (!last) continue;

        // 检查关键变化
        if (Math.abs((current.otc_index || 0) - (last.otc_index || 0)) > 50 ||
            Math.abs((current.explosion_index || 0) - (last.explosion_index || 0)) > 20 ||
            current.entry_exit_type !== last.entry_exit_type ||
            current.period_quality !== last.period_quality ||
            current.near_threshold !== last.near_threshold ||
            current.strategy_signal_level !== last.strategy_signal_level ||
            JSON.stringify(current.momentumIndicators) !== JSON.stringify(last.momentumIndicators)) {
            return true;
        }
    }

    return false;
}

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

function escapeHtml(value) {
    return String(value ?? 'N/A')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function formatNumber(value) {
    return value === null || value === undefined ? 'N/A' : String(value);
}

function formatPercent(value) {
    return Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(1)}%` : 'N/A';
}

function getPreviousExplosionIndex(metric) {
    return metric?.previous_day_data?.explosion_index
        ?? metric?.previousDayData?.explosionIndex
        ?? metric?.previousDay?.explosionIndex
        ?? null;
}

function isExplosionDropBelow200(metric) {
    const currentExplosion = Number(metric?.explosion_index);
    const previousExplosionValue = getPreviousExplosionIndex(metric);
    const previousExplosion = Number(previousExplosionValue);
    const hasShortExitSignal = Array.isArray(metric?.momentumIndicators)
        && metric.momentumIndicators.includes('‼');

    if (hasShortExitSignal && Number.isFinite(currentExplosion) && currentExplosion < 200) {
        return true;
    }

    return Number.isFinite(currentExplosion)
        && previousExplosionValue !== null
        && previousExplosionValue !== undefined
        && Number.isFinite(previousExplosion)
        && previousExplosion >= 200
        && currentExplosion < 200;
}

function isExplosionTurnPositive(metric) {
    const currentExplosion = Number(metric?.explosion_index);
    const previousExplosionValue = getPreviousExplosionIndex(metric);
    const previousExplosion = Number(previousExplosionValue);

    return Number.isFinite(currentExplosion)
        && previousExplosionValue !== null
        && previousExplosionValue !== undefined
        && Number.isFinite(previousExplosion)
        && previousExplosion <= 0
        && currentExplosion > 0;
}

function isImportantMomentumIndicator(indicator) {
    return indicator === '$' || indicator === '‼';
}

function getStrategySignal(metric) {
    return metric?.strategy_signal || metric?.strategySignal || null;
}

function isOtcTrendStrategySignal(signal) {
    return signal?.level === 'otc_up_3' || signal?.level === 'otc_down_3';
}

function getTelegramMessageOptions() {
    return {
        parse_mode: 'HTML',
        disable_web_page_preview: true
    };
}

async function sendTelegramNotification(chatId, message) {
    return bot.sendMessage(chatId, message, getTelegramMessageOptions());
}

function formatCoinHeader(coin) {
    return `<b>${escapeHtml(coin?.symbol)}</b> · ${escapeHtml(coin?.name || coin?.symbol)}`;
}

function formatMetricState(metric) {
    if (!metric?.entry_exit_type || metric.entry_exit_type === 'neutral') {
        return '观望';
    }

    const dayText = metric.entry_exit_day ? `第${metric.entry_exit_day}天` : '';
    return `${getTypeDisplay(metric.entry_exit_type)}${dayText}`;
}

function getLastSnapshotCoin(lastSnapshot, symbol) {
    if (!lastSnapshot?.coins || !symbol) {
        return null;
    }

    return lastSnapshot.coins.find(coin => coin.symbol === symbol) || null;
}

function getEntryQualityChange(metric, lastSnapshot) {
    const symbol = metric?.coin?.symbol;
    const lastCoin = getLastSnapshotCoin(lastSnapshot, symbol);

    if (
        metric?.entry_exit_type !== 'entry'
        || lastCoin?.entry_exit_type !== 'entry'
        || !metric.period_quality
        || !lastCoin.period_quality
        || metric.period_quality === lastCoin.period_quality
    ) {
        return null;
    }

    return {
        previousQuality: lastCoin.period_quality,
        currentQuality: metric.period_quality
    };
}

function formatSingleCoinAlert({ title, coinData, reason, action }) {
    const coin = coinData.coin || { symbol: coinData.symbol, name: coinData.name };

    return [
        `<b>${escapeHtml(title)}</b>`,
        '',
        formatCoinHeader(coin),
        `触发：${escapeHtml(reason)}`,
        '',
        `场外：<b>${escapeHtml(formatNumber(coinData.otc_index))}</b>`,
        `爆破：<b>${escapeHtml(formatNumber(coinData.explosion_index))}</b>`,
        `状态：${escapeHtml(formatMetricState(coinData))}`,
        `质量：${escapeHtml(coinData.period_quality || '待评估')}`,
        `谢林：${escapeHtml(formatNumber(coinData.schelling_point))}`,
        '',
        escapeHtml(action)
    ].join('\n');
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

                // 找到高质量进场期且在关键初期（1-3天）的币种
                const qualityEarlyEntryCoins = data.metrics.filter(metric => 
                    metric.entry_exit_type === 'entry' && 
                    (metric.period_quality === '高质量进场' || metric.period_quality?.includes('高质量')) &&
                    metric.entry_exit_day >= 1 && metric.entry_exit_day <= 3
                );

                // 找到爆破指数由负转正的币种
                const explosionTurnPositiveCoins = data.metrics.filter(isExplosionTurnPositive);

                console.log(`Found ${qualityEarlyEntryCoins.length} quality early entry coins and ${explosionTurnPositiveCoins.length} explosion turn positive coins for user ${chatId}`);

                for (const coinData of qualityEarlyEntryCoins) {
                    const coinSymbol = coinData.coin.symbol;
                    
                    // 检查是否已经在今天发送过通知
                    const alreadySent = await hasNotificationSent(chatId, coinSymbol, 'quality_early_entry', currentDate);
                    
                    if (!alreadySent) {
                        const message = formatSingleCoinAlert({
                            title: '高质量进场期初期',
                            coinData,
                            reason: `${coinData.period_quality || '高质量进场'} · ${getTypeDisplay(coinData.entry_exit_type)}第${coinData.entry_exit_day}天`,
                            action: '重要窗口：只在高质量进场初期提醒，后续以 dashboard 跟踪。'
                        });
                        
                        try {
                            await sendTelegramNotification(chatId, message);
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
                        const message = formatSingleCoinAlert({
                            title: '爆破指数由负转正',
                            coinData,
                            reason: `爆破 ${formatNumber(getPreviousExplosionIndex(coinData))} → ${formatNumber(coinData.explosion_index)}`,
                            action: '情绪修复信号：确认是否配合场外和周期质量。'
                        });
                        
                        try {
                            await sendTelegramNotification(chatId, message);
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

                    // 1. 检查爆破指数跌破200（从 >=200 降到 <200，或原文出现 ‼）
                    if (isExplosionDropBelow200(coinData)) {
                        const alreadySentExplosion = await hasNotificationSent(chatId, favoriteSymbol, 'explosion_drop_200', currentDate);
                        
                        if (!alreadySentExplosion) {
                            const message = formatSingleCoinAlert({
                                title: '收藏币种跌破 200',
                                coinData,
                                reason: `爆破 ${formatNumber(getPreviousExplosionIndex(coinData))} → ${formatNumber(coinData.explosion_index)}`,
                                action: '关键节点：检查是否需要降低仓位或等待修复。'
                            });
                            
                            try {
                                await sendTelegramNotification(chatId, message);
                                await recordNotification(chatId, favoriteSymbol, 'explosion_drop_200', currentDate);
                                console.log(`Explosion drop notification sent to ${chatId} for ${favoriteSymbol}`);
                            } catch (error) {
                                console.error(`Failed to send explosion drop notification to ${chatId}:`, error);
                            }
                        }
                    }

                    // 2. 检查进入退场期首日
                    if (coinData.entry_exit_type === 'exit' && coinData.entry_exit_day === 1) {
                        const alreadySentExit = await hasNotificationSent(chatId, favoriteSymbol, 'favorite_exit_alert', currentDate);
                        
                        if (!alreadySentExit) {
                            const message = formatSingleCoinAlert({
                                title: '收藏币种进入退场期',
                                coinData,
                                reason: '退场期第1天',
                                action: '周期切换：优先复核持仓和止盈/止损计划。'
                            });
                            
                            try {
                                await sendTelegramNotification(chatId, message);
                                await recordNotification(chatId, favoriteSymbol, 'favorite_exit_alert', currentDate);
                                console.log(`Favorite exit alert sent to ${chatId} for ${favoriteSymbol}`);
                            } catch (error) {
                                console.error(`Failed to send favorite exit alert to ${chatId}:`, error);
                            }
                        }
                    }

                    // 逼近期和单纯场外大涨会留在 dashboard 里看，TG 只推关键节点。
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

                // 检查是否有实际数据变化
                const currentDataSnapshot = createDataSnapshot(data);
                const lastSnapshot = lastDataSnapshot.get(chatId);

                // 如果是第一次检查或者数据有变化，才进行通知检查
                if (!lastSnapshot || hasDataChanged(lastSnapshot, currentDataSnapshot)) {
                    console.log(`Data changes detected for user ${chatId}, checking notifications...`);

                    // 更新数据快照
                    lastDataSnapshot.set(chatId, currentDataSnapshot);

                    const currentDate = new Date().toISOString().slice(0, 10);
                    const currentTimestamp = Math.floor(Date.now() / 60000); // 分钟级时间戳

                    // 使用更精确的去重机制
                    const alreadyNotified = await hasNotificationSent(chatId, 'SYSTEM', `data_update_${currentTimestamp}`, currentDate);

                    if (!alreadyNotified) {
                        // 获取所有重要变化和通知
                        const allNotifications = [];

                        // 1. 分析全市场重要变化
                        const significantChanges = analyzeDataChanges(data.metrics, lastSnapshot);
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

                        // 4. 检查策略关键信息
                        const strategySignals = await analyzeStrategySignals(data.metrics, chatId, currentDate);
                        if (strategySignals.length > 0) {
                            allNotifications.push({
                                type: 'strategy_signals',
                                title: '📌 策略关键信息',
                                content: strategySignals
                            });
                        }

                        // 5. 检查动能指标
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
                                await sendTelegramNotification(chatId, message);
                                await recordNotification(chatId, 'SYSTEM', 'data_update', currentDate);

                                // 为进场期前3天的币种记录特殊的通知历史
                                const qualityOpps = allNotifications.find(n => n.type === 'quality_opportunities');
                                if (qualityOpps) {
                                    for (const opp of qualityOpps.content) {
                                        if (opp.notificationKey) {
                                            await recordNotification(chatId, opp.coin.symbol, opp.notificationKey, currentDate);
                                        }
                                    }
                                }

                                const strategySignals = allNotifications.find(n => n.type === 'strategy_signals');
                                if (strategySignals) {
                                    for (const signal of strategySignals.content) {
                                        if (signal.notificationKey) {
                                            await recordNotification(chatId, signal.coin.symbol, signal.notificationKey, currentDate);
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
                } else {
                    console.log(`No data changes detected for user ${chatId}, skipping notifications`);
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
function analyzeDataChanges(metrics, lastSnapshot = null) {
    const significantChanges = [];
    
    metrics.forEach(metric => {
        const entryQualityChange = getEntryQualityChange(metric, lastSnapshot);
        if (entryQualityChange) {
            significantChanges.push({
                coin: metric.coin,
                changeType: '进场质量变化',
                description: `${entryQualityChange.previousQuality} → ${entryQualityChange.currentQuality}`,
                currentData: {
                    otc_index: metric.otc_index,
                    explosion_index: metric.explosion_index
                }
            });
        }

        // 检查爆破跌破200关键节点
        if (isExplosionDropBelow200(metric)) {
            significantChanges.push({
                coin: metric.coin,
                changeType: '爆破跌破 200',
                description: `爆破 ${formatNumber(getPreviousExplosionIndex(metric))} → ${formatNumber(metric.explosion_index)}`,
                currentData: {
                    otc_index: metric.otc_index,
                    explosion_index: metric.explosion_index
                }
            });
        }
        
        // 检查进退场状态变化
        if (metric.entry_exit_type === 'entry' && metric.entry_exit_day === 1) {
            significantChanges.push({
                coin: metric.coin,
                changeType: '新进入进场期',
                description: `质量评估：${metric.period_quality || '待评估'}`,
                currentData: {
                    otc_index: metric.otc_index,
                    explosion_index: metric.explosion_index
                }
            });
        }
        
        if (metric.entry_exit_type === 'exit' && metric.entry_exit_day === 1) {
            significantChanges.push({
                coin: metric.coin,
                changeType: '新进入退场期',
                description: `质量评估：${metric.period_quality || '待评估'}`,
                currentData: {
                    otc_index: metric.otc_index,
                    explosion_index: metric.explosion_index
                }
            });
        }
    });
    
    return significantChanges.slice(0, 5);
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
            
            // 检查爆破指数跌破200关键节点
            if (isExplosionDropBelow200(coinData)) {
                alerts.push({
                    coin: coinData.coin,
                    alertType: '爆破跌破 200',
                    description: `爆破 ${formatNumber(getPreviousExplosionIndex(coinData))} → ${formatNumber(coinData.explosion_index)}`,
                    priority: 'high'
                });
            }
            
            // 检查退场期首日
            if (coinData.entry_exit_type === 'exit' && coinData.entry_exit_day === 1) {
                alerts.push({
                    coin: coinData.coin,
                    alertType: '进入退场期',
                    description: `退场期第${coinData.entry_exit_day}天`,
                    priority: 'high'
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
                    
                    // 只推送强动能和短期撤出信号
                    for (const indicator of momentumIndicators.filter(isImportantMomentumIndicator)) {
                        const notificationKey = `momentum_${indicator}`;
                        const alreadySent = await hasNotificationSent(chatId, coinSymbol, notificationKey, currentDate);
                        
                        if (!alreadySent) {
                            const message = formatMomentumNotification(coinData, indicator);
                            
                            try {
                                await sendTelegramNotification(chatId, message);
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
    
    let message = `<b>${escapeHtml(config.title)}</b>\n\n`;
    message += `${formatCoinHeader(coin)}\n\n`;
    message += `信号：<b>${escapeHtml(indicator)}</b>\n`;
    message += `含义：${escapeHtml(config.description)}\n\n`;
    message += `场外：<b>${escapeHtml(formatNumber(coinData.otc_index))}</b>\n`;
    message += `爆破：<b>${escapeHtml(formatNumber(coinData.explosion_index))}</b>\n`;
    message += `谢林：${escapeHtml(formatNumber(coinData.schelling_point))}\n`;
    
    if (coinData.entry_exit_type && coinData.entry_exit_type !== 'neutral') {
        message += `状态：${escapeHtml(getTypeDisplay(coinData.entry_exit_type))}第${escapeHtml(coinData.entry_exit_day)}天\n`;
    }
    
    if (coinData.period_quality) {
        message += `质量：${escapeHtml(coinData.period_quality)}\n`;
    }
    
    // 根据不同指标添加特定建议
    if (indicator === '$') {
        message += `\n动作：重点关注，确认是否配合周期质量。\n`;
    } else if (indicator === '‼') {
        message += `\n动作：短期撤出信号，优先看风险控制。\n`;
    }
    
    return message;
}

// 分析优质机会
async function analyzeQualityOpportunities(metrics, chatId, currentDate, notificationSentChecker = hasNotificationSent) {
    const opportunities = [];
    
    // 优质进场期机会：只保留前3天
    const qualityEntryCoins = metrics.filter(metric => 
        metric.entry_exit_type === 'entry' && 
        (metric.period_quality === '高质量进场' || metric.period_quality?.includes('高质量')) &&
        metric.entry_exit_day >= 1 && metric.entry_exit_day <= 3
    );
    
    for (const coin of qualityEntryCoins) {
        if (coin.entry_exit_day === 1) {
            const notificationKey = 'quality_entry_start';
            const alreadySent = await notificationSentChecker(chatId, coin.coin.symbol, notificationKey, currentDate);

            if (!alreadySent) {
                opportunities.push({
                    coin: coin.coin,
                    opportunityType: '🌟 刚进入高质量进场期',
                    description: `第${coin.entry_exit_day}天 - ${coin.period_quality}`,
                    indices: {
                        explosion: coin.explosion_index,
                        otc: coin.otc_index
                    },
                    notificationKey: notificationKey,
                    isEarlyEntry: false
                });
            }
            continue;
        }

        // 对于前3天的进场期，使用特殊的去重逻辑（每天都可以通知）
        if (coin.entry_exit_day <= 3) {
            const notificationKey = `quality_entry_day_${coin.entry_exit_day}`;
            const alreadySent = await notificationSentChecker(chatId, coin.coin.symbol, notificationKey, currentDate);
            
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
        }
    }

    const qualityExitStartCoins = metrics.filter(metric =>
        metric.entry_exit_type === 'exit' &&
        (metric.period_quality === '高质量退场' || metric.period_quality?.includes('高质量')) &&
        metric.entry_exit_day === 1
    );

    for (const coin of qualityExitStartCoins) {
        const notificationKey = 'quality_exit_start';
        const alreadySent = await notificationSentChecker(chatId, coin.coin.symbol, notificationKey, currentDate);

        if (!alreadySent) {
            opportunities.push({
                coin: coin.coin,
                opportunityType: '📉 刚进入高质量退场期',
                description: `第${coin.entry_exit_day}天 - ${coin.period_quality}`,
                indices: {
                    explosion: coin.explosion_index,
                    otc: coin.otc_index
                },
                notificationKey: notificationKey,
                isEarlyEntry: false
            });
        }
    }
    
    // 爆破指数由负转正
    const explosionTurnPositiveCoins = metrics.filter(isExplosionTurnPositive);
    
    explosionTurnPositiveCoins.forEach(coin => {
        opportunities.push({
            coin: coin.coin,
            opportunityType: '🚀 爆破指数转正',
            description: `爆破 ${formatNumber(getPreviousExplosionIndex(coin))} → ${formatNumber(coin.explosion_index)}`,
            indices: {
                explosion: coin.explosion_index,
                otc: coin.otc_index
            },
            isEarlyEntry: false
        });
    });
    
    return opportunities.slice(0, 5); // 增加到最多显示5个机会
}

// 分析策略关键信息
async function analyzeStrategySignals(metrics, chatId, currentDate, notificationSentChecker = hasNotificationSent) {
    const alerts = [];

    for (const metric of metrics) {
        const signal = getStrategySignal(metric);
        if (!isOtcTrendStrategySignal(signal)) {
            continue;
        }

        const coin = metric.coin || { symbol: metric.symbol, name: metric.name };
        const coinSymbol = coin?.symbol;
        const notificationKey = `strategy_${signal.level}`;
        const alreadySent = await notificationSentChecker(chatId, coinSymbol, notificationKey, currentDate);

        if (alreadySent) {
            continue;
        }

        const reasons = Array.isArray(signal.reasons) ? signal.reasons.filter(Boolean) : [];
        alerts.push({
            coin,
            signalType: signal.label || (signal.level === 'otc_up_3' ? '做多：场外三连升' : '做空：场外三连降'),
            direction: signal.direction || (signal.level === 'otc_up_3' ? 'long' : 'short'),
            description: reasons.join(' / ') || (signal.level === 'otc_up_3' ? '场外指数连续3天大于1000且上升' : '场外指数连续3天下降'),
            indices: {
                explosion: metric.explosion_index,
                otc: metric.otc_index
            },
            notificationKey
        });
    }

    return alerts.slice(0, 5);
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
            if (!isImportantMomentumIndicator(indicator)) {
                continue;
            }

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
    let message = `<b>Crypto Metrics</b>\n`;
    message += `重要时间提醒\n`;
    message += `${new Date().toLocaleString('zh-CN', { timeZone: 'Australia/Sydney' })}\n\n`;

    notifications.forEach((notification, index) => {
        message += `<b>${escapeHtml(notification.title)}</b>\n`;

        if (notification.type === 'market_changes') {
            notification.content.forEach((change, i) => {
                // 使用分隔线和更清晰的布局
                message += `\n━━━━━━━━━━━━━━━━━━━━\n`;
                message += `${formatCoinHeader(change.coin)}\n`;
                message += `触发：${escapeHtml(change.changeType)}\n`;
                message += `${escapeHtml(change.description)}\n`;
                message += `场外：<b>${escapeHtml(formatNumber(change.currentData?.otc_index))}</b>\n`;
                message += `爆破：<b>${escapeHtml(formatNumber(change.currentData?.explosion_index))}</b>\n`;
                if (i < notification.content.length - 1) {
                    message += `\n`;
                }
            });
        } else if (notification.type === 'favorite_alerts') {
            notification.content.forEach((alert, i) => {
                message += `\n━━━━━━━━━━━━━━━━━━━━\n`;
                message += `${formatCoinHeader(alert.coin)}\n`;
                message += `触发：${escapeHtml(alert.alertType)}\n`;
                message += `${escapeHtml(alert.description)}\n`;
                if (i < notification.content.length - 1) {
                    message += `\n`;
                }
            });
        } else if (notification.type === 'quality_opportunities') {
            notification.content.forEach((opp, i) => {
                message += `\n━━━━━━━━━━━━━━━━━━━━\n`;
                message += `${formatCoinHeader(opp.coin)}\n`;
                message += `触发：${escapeHtml(opp.opportunityType)}\n`;
                message += `${escapeHtml(opp.description)}\n`;
                if (opp.isEarlyEntry) {
                    message += `窗口：高质量进场初期\n`;
                }
                message += `场外：<b>${escapeHtml(formatNumber(opp.indices.otc))}</b>\n`;
                message += `爆破：<b>${escapeHtml(formatNumber(opp.indices.explosion))}</b>\n`;
                if (i < notification.content.length - 1) {
                    message += `\n`;
                }
            });
        } else if (notification.type === 'strategy_signals') {
            notification.content.forEach((signal, i) => {
                message += `\n━━━━━━━━━━━━━━━━━━━━\n`;
                message += `${formatCoinHeader(signal.coin)}\n`;
                message += `触发：${escapeHtml(signal.signalType)}\n`;
                message += `${escapeHtml(signal.description)}\n`;
                message += `方向：${escapeHtml(signal.direction === 'long' ? '做多' : '做空')}\n`;
                message += `场外：<b>${escapeHtml(formatNumber(signal.indices.otc))}</b>\n`;
                message += `爆破：<b>${escapeHtml(formatNumber(signal.indices.explosion))}</b>\n`;
                if (i < notification.content.length - 1) {
                    message += `\n`;
                }
            });
        } else if (notification.type === 'momentum_alerts') {
            notification.content.forEach((alert, i) => {
                message += `\n━━━━━━━━━━━━━━━━━━━━\n`;
                message += `${formatCoinHeader(alert.coin)}\n`;
                message += `触发：${escapeHtml(alert.title)}\n`;
                message += `信号：<b>${escapeHtml(alert.indicator)}</b>\n`;
                message += `场外：<b>${escapeHtml(formatNumber(alert.indices.otc))}</b>\n`;
                message += `爆破：<b>${escapeHtml(formatNumber(alert.indices.explosion))}</b>\n`;
                if (i < notification.content.length - 1) {
                    message += `\n`;
                }
            });
        }

        if (index < notifications.length - 1) {
            message += '\n\n';
        }
    });

    message += `\n只推送关键节点；普通波动在 dashboard 查看。`;

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

    // 1. 高频数据检测 - 每5分钟检查一次（全天24小时）
    cron.schedule('*/5 * * * *', async () => {
        console.log('Running frequent data update check');
        await checkDataUpdates();
    }, {
        timezone: "Australia/Sydney"
    });

    // 2. 核心时段加强检测 - 下午2点到晚上8点，每2分钟检查一次
    cron.schedule('*/2 14-20 * * *', async () => {
        console.log('Running intensive data update check (core hours)');
        await checkDataUpdates();
    }, {
        timezone: "Australia/Sydney"
    });

    // 3. 收藏币种特别关注 - 每分钟检查收藏币种的关键变化
    cron.schedule('* 14-20 * * *', async () => {
        console.log('Running favorite coins alerts check');
        await checkFavoriteCoinsAlerts();
    }, {
        timezone: "Australia/Sydney"
    });

    console.log('Scheduler initialized with the following jobs:');
    console.log('- Every 5 minutes (24/7): Regular data update checks');
    console.log('- Every 2 minutes (2:00 PM - 8:00 PM): Intensive monitoring during core hours');
    console.log('- Every 1 minute (2:00 PM - 8:00 PM): Critical favorite coins alerts');
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
    checkMomentumIndicators,
    __testUtils: {
        analyzeDataChanges,
        analyzeQualityOpportunities,
        analyzeStrategySignals,
        analyzeMomentumIndicators,
        checkUserFavoriteAlerts,
        formatComprehensiveNotification,
        formatMomentumNotification,
        isExplosionDropBelow200,
        isExplosionTurnPositive,
        isImportantMomentumIndicator
    }
};
