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

  const tone = isPositive ? 'positive' : isNegative ? 'negative' : 'flat';
  const Icon = isPositive ? CaretUpOutlined : isNegative ? CaretDownOutlined : null;

  return (
    <span className={`coin-card__change coin-card__change--${tone}`}>
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
    const fallbackLogoUrl = getCoinLogoFallbackUrl(symbol);

    return (
      <div className={`coin-token coin-card__token${isMobile ? ' is-mobile' : ''}`}>
        <img
          src={getCoinLogoUrl(symbol, logoUrl || camelLogoUrl)}
          alt={`${symbol} logo`}
          className="coin-card__token-image"
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
      <Tag color={color} className="coin-card__tag coin-card__phase-tag" style={{ fontSize: '12px' }}>
        {text}
      </Tag>
    );
  };

  // Render near threshold tag
  const renderNearThresholdTag = () => {
    if (!nearThreshold) return null;
    return (
      <Tooltip title="正在逼近关键阈值">
        <Tag color="warning" className="coin-card__tag" style={{ fontSize: '12px', backgroundColor: '#faad14', color: '#fff' }}>
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
      <div className="coin-card__momentum">
        {momentumIndicators.map((symbol, index) => {
          const config = indicatorConfig[symbol];
          if (!config) return null;
          
          return (
            <Tooltip key={`${symbol}-${index}`} title={config.tooltip}>
              <span 
                className="coin-card__momentum-chip"
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
        styles={{ body: cardPadding }}
        onClick={handleCardBodyClick}
        size={isMobile ? "small" : "default"}
    >
        {onToggleFavorite && (
            <Tooltip title={isFavorite ? "取消收藏" : "添加收藏"}>
                <Button 
                    shape="circle"
                    icon={isFavorite ? <StarFilled style={{ color: '#FFD700' }} /> : <StarOutlined />}
                    onClick={handleFavoriteClick}
                    className="coin-card__favorite"
                    size="small"
                />
            </Tooltip>
        )}

      <div className={`coin-card__content${isMobile ? ' is-mobile' : ''}`}>
        <div className="coin-card__logo">
            {renderIcon()}
        </div>
        <div className="coin-card__details">
          <div className="coin-card__identity">
            <Text 
              strong 
              className={`coin-card__symbol${isMobile ? ' is-mobile' : ''}`}
            >
              {symbol}
            </Text>
            {renderEntryExitTag()}
            {renderNearThresholdTag()}
            {renderMomentumIndicators()}
          </div>
          
          {/* Highlight explosion index */}
          <div className="coin-card__primary-metric">
            <div className={`coin-card__explosion ${isExplosionSafe ? 'is-safe' : 'is-risk'}`}>
              <span>爆破:</span>
              <strong>{safeNumber(explosionIndex)}</strong>
              {formatChangePercent(explosionIndexChangePercent)}
              {!isExplosionSafe && (
                <Tooltip title="低于安全阈值200">
                    <WarningOutlined className="coin-card__warning" />
                </Tooltip>
              )}
            </div>
          </div>
          
          {/* Other metrics */}
          <div className="coin-card__metrics">
            <div className="coin-card__metric">
              <span className="coin-card__metric-label coin-card__metric-label--otc">场外:</span>
              <span>{safeNumber(otcIndex)}</span>
              {formatChangePercent(otcIndexChangePercent)}
            </div>
            <div className="coin-card__metric">
              <span className="coin-card__metric-label coin-card__metric-label--schelling">谢林:</span>
              <span>
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

export default React.memo(CoinCard);
