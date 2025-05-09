// src/components/CoinCard.jsx - 调整布局，突出爆破指数，去掉价格
import React from 'react';
import { Card, Typography, Tag } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, WarningOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

function CoinCard({ coin }) {
  // 防御性数据处理 - 确保所有属性都有默认值
  const { 
    symbol = 'UNKNOWN',
    name,
    entryExitType,
    entryExitDay,
    explosionIndex = 0,
    otcIndex = 0,
    schellingPoint = 0
  } = coin || {};

  // 安全数值转换函数，防止NaN
  const safeNumber = (value, defaultValue = 0) => {
    if (value === undefined || value === null || isNaN(value)) {
      return defaultValue;
    }
    return Number(value);
  };

  // 爆破指数是否安全（高于200为安全）
  const isExplosionSafe = safeNumber(explosionIndex) >= 200;
  
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
      <div className={`flex items-center justify-center w-10 h-10 rounded-full ${bgColor} text-white font-bold text-lg`}>
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
      <div className="flex items-start space-x-3">
        {renderIcon()}
        <div className="flex-1">
          <div className="flex items-center">
            <Title level={5} className="m-0">{symbol}</Title>
            {name && name !== symbol && (
              <Text type="secondary" className="ml-1">({name})</Text>
            )}
            {renderEntryExitTag()}
          </div>
          
          {/* 突出显示爆破指数 */}
          <div className="mt-2 mb-1">
            <div className={`flex items-center ${isExplosionSafe ? 'text-green-600' : 'text-red-600'} font-medium text-base`}>
              <span className="mr-2">爆破指数:</span>
              <span className="font-bold text-lg">{safeNumber(explosionIndex)}</span>
              {!isExplosionSafe && (
                <WarningOutlined className="ml-2" title="低于安全阈值200" />
              )}
            </div>
          </div>
          
          {/* 其他指标 */}
          <div className="grid grid-cols-2 gap-1 text-sm">
            <div>
              <span className="text-blue-600 font-medium">场外指数: </span>
              <span>{safeNumber(otcIndex)}</span>
            </div>
            <div>
              <span className="text-purple-600 font-medium">谢林点: </span>
              <span>{typeof schellingPoint === 'number' ? 
                schellingPoint > 1000 ? schellingPoint.toLocaleString() : schellingPoint.toFixed(2) 
                : '-'}</span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default CoinCard;