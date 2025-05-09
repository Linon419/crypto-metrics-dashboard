// src/components/CoinCard.jsx - 修改版
import React from 'react';
import { Card, Typography, Tag } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

function CoinCard({ coin }) {
  const { 
    symbol, 
    name, 
    price, 
    priceChangePercent,
    entryExitType,
    entryExitDay,
    explosionIndex,  // 添加爆破指数
    otcIndex         // 添加场外指数
  } = coin;

  // 判断价格变化方向
  const isPositiveChange = priceChangePercent >= 0;
  
  // 渲染币种图标
  const renderIcon = () => {
    const iconMap = {
      'BTC': <div className="flex items-center justify-center w-8 h-8 rounded-full bg-amber-500 text-white">B</div>,
      'ETH': <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-500 text-white">E</div>,
      'USDT': <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-500 text-white">T</div>,
      'BNB': <div className="flex items-center justify-center w-8 h-8 rounded-full bg-yellow-500 text-white">B</div>,
    };
    
    return iconMap[symbol] || <div className="w-8 h-8 rounded-full bg-gray-300"></div>;
  };

  // 根据进退场期添加标签
  const renderEntryExitTag = () => {
    if (!entryExitType || !entryExitDay) return null;
    
    const isEntry = entryExitType === 'entry';
    const color = isEntry ? 'success' : 'error';
    const text = isEntry ? `进${entryExitDay}○` : `退${entryExitDay}○`;
    
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
            <Text strong className="text-lg">${Number(price).toLocaleString()}</Text>
            <Text 
              className={`ml-2 ${isPositiveChange ? 'text-green-500' : 'text-red-500'}`}
            >
              {isPositiveChange ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
              {Math.abs(priceChangePercent).toFixed(2)}%
            </Text>
          </div>
          
          {/* 添加爆破指数显示 */}
          {explosionIndex && (
            <Text className="block text-sm text-red-600">
              爆破指数: {explosionIndex}
            </Text>
          )}
        </div>
      </div>
    </Card>
  );
}

export default CoinCard;