// src/components/CoinCard.jsx - 调整布局，突出爆破指数，去掉价格, 添加收藏按钮, 显示涨跌幅
import React from 'react';
import { Card, Typography, Tag, Tooltip, Button } from 'antd';
import { 
    ArrowUpOutlined,  // Not directly used here, but often associated
    ArrowDownOutlined, // Not directly used here, but often associated
    WarningOutlined, 
    StarFilled, 
    StarOutlined,
    CaretUpOutlined,   // For percentage change
    CaretDownOutlined  // For percentage change
} from '@ant-design/icons';

const { Title, Text } = Typography;

// Helper function to format change percentage (copied from previous suggestion)
const formatChangePercent = (percent) => {
  if (percent === null || percent === undefined || isNaN(percent)) return null;
  
  const isPositive = percent > 0;
  const isNegative = percent < 0;
  const absPercent = Math.abs(percent);

  let displayPercent;
  if (absPercent === Infinity) {
      displayPercent = isPositive ? '+∞%' : '-∞%';
  } else if (absPercent > 10000) { // e.g. 100x for 10000%
      displayPercent = `${(absPercent / 100).toFixed(0)}x`;
  } else if (absPercent > 1000) { // e.g. 10.5x for 1050%
      displayPercent = `${(absPercent / 100).toFixed(1)}x`;
  }
   else {
      displayPercent = `${absPercent.toFixed(1)}%`;
  }

  const color = isPositive ? 'text-green-500' : isNegative ? 'text-red-500' : 'text-gray-500';
  const Icon = isPositive ? CaretUpOutlined : isNegative ? CaretDownOutlined : null;

  return (
    <span className={`ml-1 text-xs ${color} whitespace-nowrap`}>
      {Icon && <Icon />}
      {displayPercent}
    </span>
  );
};


function CoinCard({ coin, isFavorite, onToggleFavorite, onCardClick }) {
  // 防御性数据处理 - 确保所有属性都有默认值
  const { 
    symbol = 'UNKNOWN',
    name,
    entryExitType,
    entryExitDay,
    explosionIndex = 0,
    otcIndex = 0,
    schellingPoint = 0,
    // 新增：从 coin 对象中解构涨跌幅百分比
    otcIndexChangePercent,
    explosionIndexChangePercent
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
      'BTC': 'bg-amber-500', 'ETH': 'bg-blue-500', 'USDT': 'bg-green-500',
      'BNB': 'bg-yellow-500', 'SOL': 'bg-purple-500', 'DOGE': 'bg-yellow-400',
      'ADA': 'bg-blue-400', 'XRP': 'bg-red-400', 'DOT': 'bg-pink-500',
      'LTC': 'bg-gray-500', 'MATIC': 'bg-indigo-500', 'LINK': 'bg-blue-600',
      'UNI': 'bg-pink-400', 'AVAX': 'bg-red-500', 'ATOM': 'bg-purple-600',
      'LDO': 'bg-cyan-500', 'CRV': 'bg-red-600', 'TRUMP': 'bg-red-700',
    };
    const bgColor = colorMap[symbol.toUpperCase()] || 'bg-gray-500';
    const displayChar = symbol ? symbol.charAt(0).toUpperCase() : '?';
    return (
      <div className={`flex items-center justify-center w-10 h-10 rounded-full ${bgColor} text-white font-bold text-lg`}>
        {displayChar}
      </div>
    );
  };

  // 根据进退场期添加标签
  const renderEntryExitTag = () => {
    if (!entryExitType || entryExitType === 'neutral' || !entryExitDay) return null;
    const isEntry = entryExitType === 'entry';
    const color = isEntry ? 'success' : 'error';
    const text = isEntry ? `进${safeNumber(entryExitDay)}` : `退${safeNumber(entryExitDay)}`;
    return (
      <Tag color={color} className="ml-2 border-0" style={{ fontSize: '12px' }}>
        {text}
      </Tag>
    );
  };

  const handleFavoriteClick = (e) => {
    e.stopPropagation();
    if (onToggleFavorite) onToggleFavorite();
  };
  
  const handleCardBodyClick = () => {
    if (onCardClick) onCardClick();
  }

  return (
    <Card 
        className="coin-card w-full shadow-sm hover:shadow-lg transition-shadow relative"
        bodyStyle={{ padding: '16px' }}
        onClick={handleCardBodyClick}
    >
        {onToggleFavorite && (
            <Tooltip title={isFavorite ? "取消收藏" : "添加收藏"}>
                <Button 
                    shape="circle"
                    icon={isFavorite ? <StarFilled style={{ color: '#FFD700' }} /> : <StarOutlined />}
                    onClick={handleFavoriteClick}
                    className="absolute top-2 left-2 z-10 bg-opacity-50 hover:bg-opacity-100"
                    size="small"
                    style={{ border: 'none', background: 'rgba(255,255,255,0.1)'}}
                />
            </Tooltip>
        )}

      <div className="flex items-start space-x-3">
        <div className="pt-1 pl-6"> {/* Space for the star icon */}
            {renderIcon()}
        </div>
        <div className="flex-1 min-w-0"> {/* min-w-0 for better truncation */}
          <div className="flex items-center">
            <Title level={5} className="m-0 truncate pr-1" style={{ maxWidth: 'calc(100% - 70px)' }}> {/* Adjusted maxWidth for potential tag */}
                {symbol}
            </Title>
            {name && name !== symbol && (
              <Text type="secondary" className="ml-1 truncate">({name})</Text>
            )}
            {renderEntryExitTag()}
          </div>
          
          {/* 突出显示爆破指数 */}
          <div className="mt-2 mb-1">
            <div className={`flex items-center ${isExplosionSafe ? 'text-green-600' : 'text-red-600'} font-medium text-sm`}>
              <span className="mr-1">爆破:</span>
              <span className="font-bold text-base mr-1">{safeNumber(explosionIndex)}</span>
              {/* 显示爆破指数涨跌幅 */}
              {formatChangePercent(explosionIndexChangePercent)}
              {!isExplosionSafe && (
                <Tooltip title="低于安全阈值200">
                    <WarningOutlined className="ml-1" />
                </Tooltip>
              )}
            </div>
          </div>
          
          {/* 其他指标 */}
          <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
            <div className="flex items-center"> {/* Flex for alignment */}
              <span className="text-blue-600 font-medium">场外: </span>
              <span>{safeNumber(otcIndex)}</span>
              {/* 显示场外指数涨跌幅 */}
              {formatChangePercent(otcIndexChangePercent)}
            </div>
            <div>
              <span className="text-purple-600 font-medium">谢林: </span>
              <span>
                {typeof schellingPoint === 'number' ? 
                  (schellingPoint > 1000 ? schellingPoint.toLocaleString() : schellingPoint.toFixed(schellingPoint < 1 ? 3 : schellingPoint < 10 ? 2 : 0)) 
                  : '-'
                }
              </span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default CoinCard;