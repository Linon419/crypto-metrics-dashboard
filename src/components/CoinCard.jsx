// src/components/CoinCard.jsx - 修复显示NaN问题
import React from 'react';
import { Card, Typography, Tag } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, WarningOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

function CoinCard({ coin }) {
  // 防御性数据处理 - 确保所有属性都有默认值，防止NaN显示
  const { 
    symbol = 'UNKNOWN',
    name,
    price,
    priceChangePercent,
    entryExitType,
    entryExitDay,
    explosionIndex,
    otcIndex,
    schellingPoint
  } = coin || {};

  // 安全数值转换函数，防止NaN
  const safeNumber = (value, defaultValue = 0) => {
    if (value === undefined || value === null || isNaN(value)) {
      return defaultValue;
    }
    return Number(value);
  };

  // 安全格式化价格的函数
  const formatPrice = (value) => {
    const num = safeNumber(value);
    if (num > 1000) return num.toLocaleString();
    if (num > 1) return num.toFixed(2);
    if (num > 0.001) return num.toFixed(4);
    return num.toFixed(6);
  };

  // 判断价格变化方向
  const priceChange = safeNumber(priceChangePercent);
  const isPositiveChange = priceChange >= 0;
  
  // 渲染币种图标 - 使用首字母和颜色映射
  const renderIcon = () => {
    const colorMap = {
      'BTC': 'bg-amber-500',
      'ETH': 'bg-blue-500',
      'USDT': 'bg-green-500',
      'BNB': 'bg-yellow-500',
      'SOL': 'bg-purple-500',
      'DOGE': 'bg-yellow-400',
      'ADA': 'bg-blue-400',
      'XRP': 'bg-red-400',
      'DOT': 'bg-pink-500',
      'LTC': 'bg-gray-500',
      'MATIC': 'bg-indigo-500',
      'LINK': 'bg-blue-600',
      'UNI': 'bg-pink-400',
      'AVAX': 'bg-red-500',
      'ATOM': 'bg-purple-600',
      'LDO': 'bg-cyan-500',
      'CRV': 'bg-red-600',
    };
    
    const bgColor = colorMap[symbol] || 'bg-gray-500';
    const displayChar = symbol ? symbol.charAt(0) : '?';
    
    return (
      <div className={`flex items-center justify-center w-8 h-8 rounded-full ${bgColor} text-white font-bold`}>
        {displayChar}
      </div>
    );
  };

  // 根据进退场期添加标签
  const renderEntryExitTag = () => {
    if (!entryExitType || !entryExitDay) return null;
    
    const isEntry = entryExitType === 'entry';
    const color = isEntry ? 'success' : 'error';
    const text = isEntry ? `进${safeNumber(entryExitDay)}` : `退${safeNumber(entryExitDay)}`;
    
    return (
      <Tag color={color} className="ml-2 border-0" style={{ fontSize: '12px' }}>
        {text}
      </Tag>
    );
  };

  return (
    <Card className="coin-card w-full shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center space-x-3">
        {renderIcon()}
        <div className="flex-1">
          <div className="flex items-center">
            <Title level={5} className="m-0">{name || symbol}</Title>
            {renderEntryExitTag()}
          </div>
          <div className="flex items-baseline">
            {price !== undefined && price !== null ? (
              <>
                <Text strong className="text-lg">${formatPrice(price)}</Text>
                {priceChangePercent !== undefined && (
                  <Text 
                    className={`ml-2 ${isPositiveChange ? 'text-green-500' : 'text-red-500'}`}
                  >
                    {isPositiveChange ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
                    {Math.abs(priceChange).toFixed(2)}%
                  </Text>
                )}
              </>
            ) : (
              // 当价格数据不可用时的回退显示
              <Text className="text-gray-400">价格数据加载中...</Text>
            )}
          </div>
          
          {/* 指标区域 - 添加爆破指数和场外指数 */}
          <div className="mt-1 flex flex-wrap gap-2">
            {/* 爆破指数 */}
            {explosionIndex !== undefined && (
              <Text className={`text-sm ${safeNumber(explosionIndex) > 200 ? 'text-green-600' : 'text-red-600'}`}>
                爆破指数: {safeNumber(explosionIndex)}
              </Text>
            )}

            {/* 场外指数 */}
            {otcIndex !== undefined && (
              <Text className="text-sm text-blue-600">
                场外指数: {safeNumber(otcIndex)}
              </Text>
            )}
            
            {/* 谢林点 - 可选显示 */}
            {schellingPoint !== undefined && (
              <Text className="text-sm text-purple-600 hidden sm:inline-block">
                谢林点: {safeNumber(schellingPoint).toLocaleString()}
              </Text>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

export default CoinCard;