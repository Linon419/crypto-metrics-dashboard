// src/services/api.js
import axios from 'axios';

// 创建axios实例
const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:3001/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
});

// 获取所有币种信息
export const fetchCoins = async () => {
  try {
    const response = await api.get('/coins');
    return response.data;
  } catch (error) {
    console.error('Error fetching coins:', error);
    throw error;
  }
};

// 获取特定币种的指标数据
export const fetchCoinMetrics = async (symbol, { startDate, endDate } = {}) => {
  try {
    const params = {};
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    
    const response = await api.get(`/coins/${symbol}/metrics`, { params });
    return response.data;
  } catch (error) {
    console.error(`Error fetching metrics for ${symbol}:`, error);
    throw error;
  }
};

// 获取当天的仪表盘数据
export const fetchDashboardData = async (date) => {
  try {
    const params = date ? { date } : {};
    const response = await api.get('/dashboard', { params });
    return response.data;
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    throw error;
  }
};

// src/services/api.js - 修改submitRawData函数
export const submitRawData = async (rawData) => {
    try {
      console.log('开始提交数据:', rawData.substring(0, 50) + '...');
      
      // 查看API请求的URL
      console.log('提交到URL:', `${process.env.REACT_APP_API_URL || 'http://localhost:3001/api'}/data/input`);
      
      const response = await api.post('/data/input', { rawData });
      console.log('提交成功，响应:', response.data);
      return response.data;
    } catch (error) {
      console.error('提交数据失败:', error);
      
      // 更详细的错误信息
      if (error.response) {
        console.error('响应状态码:', error.response.status);
        console.error('响应数据:', error.response.data);
      } else if (error.request) {
        console.error('未收到响应，请求信息:', error.request);
      }
      
      throw error;
    }
  };

// 获取流动性概况
export const fetchLiquidityOverview = async (date) => {
  try {
    const params = date ? { date } : {};
    const response = await api.get('/liquidity', { params });
    return response.data;
  } catch (error) {
    console.error('Error fetching liquidity overview:', error);
    throw error;
  }
};

// 由于目前还没有后端API，我们可以创建一个模拟数据函数来测试前端
export const fetchMockData = () => {
  return {
    coins: [
      {
        symbol: 'BTC',
        name: 'Bitcoin',
        price: 99623.24,
        priceChangePercent: 2.68,
        otcIndex: 1627,
        explosionIndex: 195,
        schellingPoint: 98500,
        entryExitType: 'entry',
        entryExitDay: 26
      },
      {
        symbol: 'ETH',
        name: 'Ethereum',
        price: 1937.98,
        priceChangePercent: 7.01,
        otcIndex: 1430,
        explosionIndex: 180,
        schellingPoint: 1820,
        entryExitType: 'exit',
        entryExitDay: 104
      },
      {
        symbol: 'USDT',
        name: 'Tether',
        price: 1.00005,
        priceChangePercent: 0.01,
        otcIndex: 800,
        explosionIndex: 120,
        schellingPoint: 1.0,
        entryExitType: 'neutral',
        entryExitDay: 0
      },
      {
        symbol: 'BNB',
        name: 'Binance Coin',
        price: 616.96,
        priceChangePercent: 2.37,
        otcIndex: 1200,
        explosionIndex: 175,
        schellingPoint: 620,
        entryExitType: 'entry',
        entryExitDay: 14
      }
    ],
    liquidity: {
      btcFundChange: 0.2,
      ethFundChange: -1.7,
      solFundChange: 0.8,
      totalMarketFundChange: 0.5,
      comments: "市场流动性总体稳定，BTC和SOL资金流入，ETH资金流出"
    },
    trendingCoins: [
      {
        symbol: 'SOL',
        otcIndex: 1339,
        explosionIndex: 181,
        entryExitType: 'entry',
        entryExitDay: 14,
        schellingPoint: 153.2
      }
    ]
  };
};

// 为了开发阶段使用的模拟API函数
export const fetchLatestMetrics = async () => {
  // 模拟网络延迟
  await new Promise(resolve => setTimeout(resolve, 800));
  return fetchMockData();
};