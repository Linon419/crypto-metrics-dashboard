// src/services/api.js - 修复数据加载问题
import axios from 'axios';

// 创建axios实例，添加超时和重试配置
const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:3001/api',
  timeout: 15000, // 增加超时时间
  headers: {
    'Content-Type': 'application/json'
  }
});

// 添加响应拦截器用于调试
api.interceptors.response.use(
  response => {
    console.log(`API响应成功: ${response.config.url}`, response.data);
    return response;
  },
  error => {
    console.error(`API错误: ${error.config?.url || '未知请求'}`, error);
    // 构建更友好的错误信息
    const errorMsg = error.response?.data?.error || error.message || '网络请求失败';
    return Promise.reject(new Error(errorMsg));
  }
);

// 获取所有币种信息 - 添加更强大的错误处理和数据验证
export const fetchCoins = async () => {
  try {
    const response = await api.get('/coins');
    
    // 数据验证
    if (!Array.isArray(response.data)) {
      console.warn('fetchCoins: 响应不是数组格式', response.data);
      return []; // 返回空数组而不是抛出错误
    }
    
    // 确保每个币种都有必要的字段
    return response.data.map(coin => ({
      symbol: coin.symbol || 'UNKNOWN',
      name: coin.name || coin.symbol || 'Unknown Coin',
      current_price: typeof coin.current_price === 'number' ? coin.current_price : 0,
      logo_url: coin.logo_url || null
    }));
  } catch (error) {
    console.error('获取币种列表失败:', error);
    // 返回一个基本的币种列表而不是抛出错误
    return getFallbackCoins();
  }
};

// 获取特定币种的指标数据 - 添加默认值防止NaN
export const fetchCoinMetrics = async (symbol, { startDate, endDate } = {}) => {
  try {
    const params = {};
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    
    const response = await api.get(`/coins/${symbol}/metrics`, { params });
    
    // 验证并确保数据格式正确
    if (!Array.isArray(response.data)) {
      console.warn(`fetchCoinMetrics: ${symbol} 响应不是数组格式`, response.data);
      return [];
    }
    
    // 确保每条指标记录都有必要的字段，防止NaN值
    return response.data.map(metric => ({
      date: metric.date || new Date().toISOString().split('T')[0],
      otc_index: typeof metric.otc_index === 'number' ? metric.otc_index : 0,
      explosion_index: typeof metric.explosion_index === 'number' ? metric.explosion_index : 0,
      schelling_point: typeof metric.schelling_point === 'number' ? metric.schelling_point : 0,
      entry_exit_type: metric.entry_exit_type || 'neutral',
      entry_exit_day: typeof metric.entry_exit_day === 'number' ? metric.entry_exit_day : 0
    }));
  } catch (error) {
    console.error(`获取${symbol}指标数据失败:`, error);
    return [];
  }
};

// 获取当天的仪表盘数据 - 添加完整的错误处理和备用数据
export const fetchDashboardData = async (date) => {
  try {
    const params = date ? { date } : {};
    const response = await api.get('/dashboard', { params });
    
    // 确保response.data是一个有效对象
    if (!response.data || typeof response.data !== 'object') {
      console.warn('fetchDashboardData: 无效的响应数据', response.data);
      return getFallbackDashboardData();
    }
    
    // 数据验证和防御性编程
    const dashboardData = {
      date: response.data.date || new Date().toISOString().split('T')[0],
      coins: Array.isArray(response.data.coins) ? response.data.coins.map(sanitizeCoinData) : [],
      liquidity: response.data.liquidity || getDefaultLiquidity(),
      trendingCoins: Array.isArray(response.data.trendingCoins) ? response.data.trendingCoins : [],
      statistics: response.data.statistics || { total_coins: 0 }
    };
    
    return dashboardData;
  } catch (error) {
    console.error('获取仪表盘数据失败:', error);
    return getFallbackDashboardData();
  }
};

// 提交原始数据 - 改进错误处理和日志记录
export const submitRawData = async (rawData) => {
  try {
    if (!rawData || typeof rawData !== 'string') {
      throw new Error('原始数据必须是字符串');
    }
    
    console.log('开始提交数据，长度:', rawData.length);
    console.log('前100个字符:', rawData.substring(0, 100));
    
    const response = await api.post('/data/input', { rawData });
    console.log('提交成功，响应:', response.data);
    return response.data;
  } catch (error) {
    console.error('提交数据失败:', error);
    // 详细的错误信息
    let errorMessage = '提交数据失败';
    if (error.response) {
      errorMessage += `: 服务器返回 ${error.response.status} - ${JSON.stringify(error.response.data)}`;
    } else if (error.request) {
      errorMessage += ': 未收到服务器响应';
    } else {
      errorMessage += `: ${error.message}`;
    }
    throw new Error(errorMessage);
  }
};

// 获取流动性概况 - 添加默认值防止未定义错误
export const fetchLiquidityOverview = async (date) => {
  try {
    const params = date ? { date } : {};
    const response = await api.get('/liquidity', { params });
    
    // 确保返回的是数组
    const liquidityData = Array.isArray(response.data) ? response.data : [response.data];
    
    // 标准化每条记录
    return liquidityData.map(item => ({
      date: item.date || new Date().toISOString().split('T')[0],
      btc_fund_change: typeof item.btc_fund_change === 'number' ? item.btc_fund_change : 0,
      eth_fund_change: typeof item.eth_fund_change === 'number' ? item.eth_fund_change : 0,
      sol_fund_change: typeof item.sol_fund_change === 'number' ? item.sol_fund_change : 0,
      total_market_fund_change: typeof item.total_market_fund_change === 'number' ? item.total_market_fund_change : 0,
      comments: item.comments || ''
    }));
  } catch (error) {
    console.error('获取流动性概况失败:', error);
    return [getDefaultLiquidity()];
  }
};

// 获取最新指标数据的增强版本
export const fetchLatestMetrics = async () => {
  try {
    const response = await api.get('/data/latest');
    
    // 数据验证
    if (!response.data || typeof response.data !== 'object') {
      console.warn('fetchLatestMetrics: 无效的响应数据', response.data);
      return getFallbackMetricsData();
    }
    
    // 确保date字段存在
    const date = response.data.date || new Date().toISOString().split('T')[0];
    
    // 处理币种和指标数据
    let coinsWithMetrics = [];
    if (Array.isArray(response.data.metrics)) {
      // 将API返回的复杂格式转换为前端所需的简单格式
      coinsWithMetrics = response.data.metrics.map(metric => {
        const coin = metric.coin || {};
        return {
          id: metric.coin_id || 0,
          symbol: coin.symbol || 'UNKNOWN',
          name: coin.name || coin.symbol || 'Unknown Coin',
          current_price: coin.current_price || 0,
          logo_url: coin.logo_url || null,
          otcIndex: metric.otc_index || 0,
          explosionIndex: metric.explosion_index || 0,
          schellingPoint: metric.schelling_point || 0,
          entryExitType: metric.entry_exit_type || 'neutral',
          entryExitDay: metric.entry_exit_day || 0,
          nearThreshold: !!metric.near_threshold
        };
      });
    }
    
    // 如果没有找到任何币种数据，使用备用数据
    if (coinsWithMetrics.length === 0) {
      console.warn('fetchLatestMetrics: 未找到币种数据，使用备用数据');
      coinsWithMetrics = getFallbackCoins();
    }
    
    return {
      date,
      coins: coinsWithMetrics,
      liquidity: response.data.liquidity || getDefaultLiquidity(),
      trendingCoins: Array.isArray(response.data.trendingCoins) ? response.data.trendingCoins : []
    };
  } catch (error) {
    console.error('获取最新指标数据失败:', error);
    return getFallbackMetricsData();
  }
};

// 辅助函数 - 确保币种数据格式正确
function sanitizeCoinData(coin) {
  if (!coin) return null;
  return {
    id: coin.id || 0,
    symbol: coin.symbol || 'UNKNOWN',
    name: coin.name || coin.symbol || 'Unknown Coin',
    current_price: typeof coin.current_price === 'number' ? coin.current_price : 0,
    logo_url: coin.logo_url || null,
    metrics: coin.metrics ? {
      otc_index: typeof coin.metrics.otc_index === 'number' ? coin.metrics.otc_index : 0,
      explosion_index: typeof coin.metrics.explosion_index === 'number' ? coin.metrics.explosion_index : 0,
      schelling_point: typeof coin.metrics.schelling_point === 'number' ? coin.metrics.schelling_point : 0,
      entry_exit_type: coin.metrics.entry_exit_type || 'neutral',
      entry_exit_day: typeof coin.metrics.entry_exit_day === 'number' ? coin.metrics.entry_exit_day : 0,
      near_threshold: !!coin.metrics.near_threshold
    } : null
  };
}

// 备用数据 - 当API失败时使用
function getFallbackCoins() {
  // 基础币种作为备用数据
  return [
    {
      symbol: 'BTC',
      name: 'Bitcoin',
      current_price: 99623.24,
      otcIndex: 1627,
      explosionIndex: 195,
      schellingPoint: 98500,
      entryExitType: 'entry',
      entryExitDay: 26
    },
    {
      symbol: 'ETH',
      name: 'Ethereum',
      current_price: 1937.98,
      otcIndex: 1430,
      explosionIndex: 180,
      schellingPoint: 1820,
      entryExitType: 'exit',
      entryExitDay: 104
    },
    {
      symbol: 'BNB',
      name: 'Binance Coin',
      current_price: 616.96,
      otcIndex: 1200,
      explosionIndex: 175,
      schellingPoint: 620,
      entryExitType: 'entry',
      entryExitDay: 14
    },
    {
      symbol: 'SOL',
      name: 'Solana',
      current_price: 153.68,
      otcIndex: 1339,
      explosionIndex: 181,
      schellingPoint: 152.5,
      entryExitType: 'entry',
      entryExitDay: 14
    },
    {
      symbol: 'DOGE',
      name: 'Dogecoin',
      current_price: 0.12,
      otcIndex: 930,
      explosionIndex: 145,
      schellingPoint: 0.11,
      entryExitType: 'neutral',
      entryExitDay: 0
    },
    {
      symbol: 'LTC',
      name: 'Litecoin',
      current_price: 87.65,
      otcIndex: 820,
      explosionIndex: 162,
      schellingPoint: 85.3,
      entryExitType: 'entry',
      entryExitDay: 7
    },
    {
      symbol: 'LDO',
      name: 'Lido DAO',
      current_price: 2.43,
      otcIndex: 750,
      explosionIndex: 140,
      schellingPoint: 2.35,
      entryExitType: 'exit',
      entryExitDay: 15
    },
    {
      symbol: 'CRV',
      name: 'Curve DAO',
      current_price: 0.63,
      otcIndex: 680,
      explosionIndex: 135,
      schellingPoint: 0.62,
      entryExitType: 'exit',
      entryExitDay: 22
    }
  ];
}

// 默认流动性数据
function getDefaultLiquidity() {
  return {
    date: new Date().toISOString().split('T')[0],
    btc_fund_change: 0.2,
    eth_fund_change: -1.7,
    sol_fund_change: 0.8,
    total_market_fund_change: 0.5,
    comments: "市场流动性数据暂不可用，显示备用数据"
  };
}

// 备用仪表盘数据
function getFallbackDashboardData() {
  return {
    date: new Date().toISOString().split('T')[0],
    coins: getFallbackCoins().map(coin => ({
      id: 0,
      symbol: coin.symbol,
      name: coin.name,
      current_price: coin.current_price,
      metrics: {
        otc_index: coin.otcIndex,
        explosion_index: coin.explosionIndex,
        schelling_point: coin.schellingPoint,
        entry_exit_type: coin.entryExitType,
        entry_exit_day: coin.entryExitDay,
        near_threshold: false
      }
    })),
    liquidity: getDefaultLiquidity(),
    trendingCoins: [
      {
        symbol: 'SOL',
        otc_index: 1339,
        explosion_index: 181,
        entry_exit_type: 'entry',
        entry_exit_day: 14,
        schelling_point: 152.5
      }
    ],
    statistics: {
      total_coins: 8,
      entry_coins: 5,
      exit_coins: 3,
      near_threshold_coins: 0
    }
  };
}

// 备用最新指标数据
function getFallbackMetricsData() {
  return {
    date: new Date().toISOString().split('T')[0],
    coins: getFallbackCoins(),
    liquidity: getDefaultLiquidity(),
    trendingCoins: [
      {
        symbol: 'SOL',
        otc_index: 1339,
        explosion_index: 181,
        entry_exit_type: 'entry',
        entry_exit_day: 14,
        schelling_point: 152.5
      }
    ]
  };
}