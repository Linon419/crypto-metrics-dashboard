// src/components/CoinCard.jsx - Mobile-friendly version
import React from 'react';
import { Card, Typography, Tag, Tooltip, Button } from 'antd';
import { 
    WarningOutlined, 
    StarFilled, 
    StarOutlined,
    CaretUpOutlined,
    CaretDownOutlined
} from '@ant-design/icons';
import { getCoinLogoFallbackUrl, getCoinLogoUrl } from '../utils/coinLogos';

const { Text } = Typography;

// Helper function to format change percentage
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


function CoinCard({ coin, isFavorite, onToggleFavorite, onCardClick, isMobile = false }) {
  // Defensive data handling
  const {
    symbol = 'UNKNOWN',
    entryExitType,
    entryExitDay,
    explosionIndex = 0,
    otcIndex = 0,
    schellingPoint = 0,
    otcIndexChangePercent,
    explosionIndexChangePercent,
    nearThreshold = false,
    momentumIndicators = [],
    logo_url: logoUrl,
    logoUrl: camelLogoUrl,
  } = coin || {};

  // Safe number conversion
  const safeNumber = (value, defaultValue = 0) => {
    if (value === undefined || value === null || isNaN(value)) {
      return defaultValue;
    }
    return Number(value);
  };

  // Check if explosion index is safe (above 200)
  const isExplosionSafe = safeNumber(explosionIndex) >= 200;
  
  const renderIcon = () => {
    const iconSize = isMobile ? 'w-8 h-8' : 'w-10 h-10';
    const fallbackLogoUrl = getCoinLogoFallbackUrl(symbol);

    return (
      <div className={`coin-token flex items-center justify-center ${iconSize} rounded-full bg-white overflow-hidden border border-gray-100 shadow-sm`}>
        <img
          src={getCoinLogoUrl(symbol, logoUrl || camelLogoUrl)}
          alt={`${symbol} logo`}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(event) => {
            event.currentTarget.onerror = null;
            event.currentTarget.src = fallbackLogoUrl;
          }}
        />
      </div>
    );
  };

  // Render entry/exit tag
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

  // Render near threshold tag
  const renderNearThresholdTag = () => {
    if (!nearThreshold) return null;
    return (
      <Tooltip title="正在逼近关键阈值">
        <Tag color="warning" className="ml-1 border-0" style={{ fontSize: '12px', backgroundColor: '#faad14', color: '#fff' }}>
          逼近
        </Tag>
      </Tooltip>
    );
  };

  // Render momentum indicators
  const renderMomentumIndicators = () => {
    if (!momentumIndicators || momentumIndicators.length === 0) return null;
    
    const indicatorConfig = {
      '$': { color: '#52c41a', tooltip: '向上动能强劲，重点关注' },
      '*': { color: '#ff4d4f', tooltip: '高速油门期，爆破指数>200' },
      '※': { color: '#ff4d4f', tooltip: '高速油门期，爆破指数>200' },
      '‼': { color: '#faad14', tooltip: '短期撤出信号，爆破跌破200' },
      '↑': { color: '#1890ff', tooltip: '连续上涨，进入上升通道' },
      'w': { color: '#722ed1', tooltip: '巨头犹豫，退场期特殊情况' }
    };
    
    return (
      <div className="flex items-center ml-1">
        {momentumIndicators.map((symbol, index) => {
          const config = indicatorConfig[symbol];
          if (!config) return null;
          
          return (
            <Tooltip key={`${symbol}-${index}`} title={config.tooltip}>
              <span 
                className="inline-block px-1 text-sm font-bold rounded mr-1"
                style={{ 
                  color: config.color,
                  backgroundColor: `${config.color}15`,
                  border: `1px solid ${config.color}50`
                }}
              >
                {symbol}
              </span>
            </Tooltip>
          );
        })}
      </div>
    );
  };



  const handleFavoriteClick = (e) => {
    e.stopPropagation();
    if (onToggleFavorite) onToggleFavorite();
  };
  
  const handleCardBodyClick = () => {
    if (onCardClick) onCardClick();
  }

  // Adjust card padding for mobile
  const cardPadding = isMobile ? { padding: '10px' } : { padding: '16px' };

  return (
    <Card
        className={`coin-card w-full transition-shadow relative ${isMobile ? 'mb-2' : ''}`}
        bodyStyle={cardPadding}
        onClick={handleCardBodyClick}
        size={isMobile ? "small" : "default"}
    >
        {onToggleFavorite && (
            <Tooltip title={isFavorite ? "取消收藏" : "添加收藏"}>
                <Button 
                    shape="circle"
                    icon={isFavorite ? <StarFilled style={{ color: '#FFD700' }} /> : <StarOutlined />}
                    onClick={handleFavoriteClick}
                    className="absolute top-1 left-1 z-10"
                    size="small"
                    style={{ border: 'none', background: 'rgba(255,255,255,0.1)'}}
                />
            </Tooltip>
        )}

      <div className="flex items-start space-x-2">
        <div className="pt-1 pl-5"> {/* Space for star icon */}
            {renderIcon()}
        </div>
        <div className="flex-1 min-w-0"> {/* min-w-0 for better truncation */}
          <div className="flex items-center">
            <Text 
              strong 
              className={`truncate ${isMobile ? 'text-sm' : ''}`} 
              style={{ maxWidth: 'calc(100% - 80px)' }}
            >
              {symbol}
            </Text>
            {renderEntryExitTag()}
            {renderNearThresholdTag()}
            {renderMomentumIndicators()}
          </div>
          
          {/* Highlight explosion index */}
          <div className="mt-1">
            <div className={`flex items-center ${isExplosionSafe ? 'text-green-600' : 'text-red-600'} font-medium ${isMobile ? 'text-xs' : 'text-sm'}`}>
              <span className="mr-1">爆破:</span>
              <span className="font-bold text-base mr-1">{safeNumber(explosionIndex)}</span>
              {formatChangePercent(explosionIndexChangePercent)}
              {!isExplosionSafe && (
                <Tooltip title="低于安全阈值200">
                    <WarningOutlined className="ml-1" />
                </Tooltip>
              )}
            </div>
          </div>
          
          {/* Other metrics */}
          <div className={`grid grid-cols-2 gap-x-1 gap-y-0 ${isMobile ? 'text-xs' : 'text-xs'} mt-1`}>
            <div className="flex items-center">
              <span className="text-blue-600 font-medium">场外: </span>
              <span>{safeNumber(otcIndex)}</span>
              {formatChangePercent(otcIndexChangePercent)}
            </div>
            <div>
              <span className="text-purple-600 font-medium">谢林: </span>
              <span className="truncate">
                {typeof schellingPoint === 'number' ?
                  (schellingPoint > 1000 ?
                    isMobile ?
                      Intl.NumberFormat('en', {notation: 'compact'}).format(schellingPoint) :
                      schellingPoint.toLocaleString()
                    : schellingPoint.toFixed(schellingPoint < 1 ? 3 : schellingPoint < 10 ? 2 : 0))
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
