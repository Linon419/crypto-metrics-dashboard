// src/components/CoinList.jsx - Mobile-friendly version
import React, { useState, useEffect, useMemo } from 'react';
import { Row, Col, Pagination, Spin, Empty, Button, Alert, Card, Badge } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import CoinCard from './CoinCard';
import { getQualityRibbonProps } from '../utils/periodQualityMeta';

function CoinList({ 
  coins = [], 
  onCoinSelect, 
  selectedCoin, 
  favorites = [], 
  onToggleFavorite,
  loading = false, 
  error = null, 
  onRefresh,
  viewMode = 'all'
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const pageSize = isMobile ? 6 : 8; // Optimized page size for mobile

  // 视图筛选（收藏/热门/多空）统一由 Dashboard 决定，这里只负责展示，
  // 避免"筛选栏说 10 个、卡片只画 3 张"这种两处规则不一致的问题
  const displayedCoins = useMemo(() => (Array.isArray(coins) ? coins : []), [coins]);
  const safeCoins = displayedCoins;

  // Listen for window resize to adjust for mobile
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 以集合内容作为重置依据：父组件每次渲染都会生成新数组，
  // 按引用重置会导致父级重渲染把分页打回第 1 页
  const coinSetKey = useMemo(
    () => `${displayedCoins.length}|${displayedCoins.map(coin => coin.symbol).join(',')}`,
    [displayedCoins]
  );

  // Reset to first page only when the coin set itself or the view mode changes
  useEffect(() => {
    setCurrentPage(1);
  }, [coinSetKey, viewMode]);

  // Auto-select first coin when none selected
  useEffect(() => {
    if (!selectedCoin && displayedCoins.length > 0 && onCoinSelect) {
      const firstCoinToSelect = displayedCoins[0];
      // Prefer BTC if available
      const btcCoin = displayedCoins.find(c => c.symbol === 'BTC');
      onCoinSelect(btcCoin ? btcCoin.symbol : firstCoinToSelect.symbol);
    }
  }, [displayedCoins, selectedCoin, onCoinSelect]);

  // Get current page coins
  const getCurrentPageCoins = () => {
    const startIndex = (currentPage - 1) * pageSize;
    return displayedCoins.slice(startIndex, startIndex + pageSize);
  };

  // Handle coin click
  const handleCoinClick = (coinSymbol) => {
    if (onCoinSelect) {
      onCoinSelect(coinSymbol);
    }
  };
  
  // Handle refresh
  const handleRefresh = () => {
    if (onRefresh) {
      onRefresh();
    }
  };
  
  // Render fallback card when data loading fails
  const renderFallbackCard = (index) => {
    const symbols = ['BTC', 'ETH', 'BNB', 'SOL', 'DOGE', 'LTC', 'USDT', 'XRP'];
    const symbol = symbols[index % symbols.length];
    
    return (
      <Card className="w-full shadow-sm hover:shadow-md transition-shadow">
        <div className="flex items-center space-x-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-400 text-white font-bold">
            {symbol.charAt(0)}
          </div>
          <div className="flex-1">
            <div className="font-medium">{symbol}</div>
            <div className="text-gray-400">数据加载中...</div>
            <div className="text-sm text-gray-400 mt-1">
              <span>爆破指数: - </span>
              <span className="ml-4">场外指数: - </span>
            </div>
          </div>
        </div>
      </Card>
    );
  };

  const currentCoinsToDisplay = getCurrentPageCoins();

  return (
    <div className="coin-list-section">
      {/* Error alert */}
      {error && (
        <Alert
          message="数据加载错误"
          description={error}
          type="error"
          showIcon
          className="mb-4"
          action={
            <Button size="small" danger onClick={handleRefresh}>
              重试
            </Button>
          }
        />
      )}

      {/* List content */}
      {loading && currentCoinsToDisplay.length === 0 ? (
        // Loading state - skeleton screen
        <div className="hidden md:block">
          <Row gutter={[16, 16]} className="mb-4">
            {[...Array(isMobile ? 4 : 8)].map((_, index) => (
              <Col key={index} xs={24} sm={12} md={6}>
                {renderFallbackCard(index)}
              </Col>
            ))}
          </Row>
        </div>
      ) : (
        <>
          {/* Desktop and tablet display */}
          <div className="hidden md:block">
            {currentCoinsToDisplay.length > 0 ? (
              <Row gutter={[16, 16]} className="mb-4">
                {currentCoinsToDisplay.map((coin, index) => {
                  const ribbonProps = getQualityRibbonProps(coin.period_quality);

                  return (
                  <Col key={`${coin.symbol}-${index}`} xs={24} sm={12} md={6}>
                    <Badge.Ribbon
                      text={ribbonProps.text}
                      color={ribbonProps.color}
                      style={{ display: ribbonProps.display, fontSize: '10px', lineHeight: '14px', height: '16px', top: '-2px', right: '10px' }}
                    >
                      <div
                        className={`coin-card-shell cursor-pointer relative ${
                          selectedCoin === coin.symbol ? 'is-selected' : ''
                        }`}
                      >
                        <CoinCard 
                          coin={coin} 
                          onCardClick={() => handleCoinClick(coin.symbol)}
                          isFavorite={favorites.includes(coin.symbol)}
                          onToggleFavorite={() => onToggleFavorite(coin.symbol)}
                        />
                      </div>
                    </Badge.Ribbon>
                  </Col>
                  );
                })}
              </Row>
            ) : !loading ? (
              <Empty 
                description={
                  viewMode === 'favorites' 
                    ? "没有收藏的币种，请点击星标收藏" 
                    : viewMode === 'popular' 
                    ? "没有找到热门币种" 
                    : "没有找到币种数据"
                }
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ) : null}
          </div>
          
          {/* Mobile display */}
          <div className="block md:hidden">
            {currentCoinsToDisplay.length > 0 ? (
              <>
                {/* Optimized mobile grid layout */}
                <Row gutter={[8, 8]} className="mb-4">
                  {currentCoinsToDisplay.map((coin, index) => {
                    const ribbonProps = getQualityRibbonProps(coin.period_quality);

                    return (
                    <Col key={`${coin.symbol}-${index}`} xs={24} sm={12}>
                      <Badge.Ribbon
                        text={ribbonProps.text}
                        color={ribbonProps.color}
                        style={{ display: ribbonProps.display, fontSize: '9px', lineHeight: '12px', height: '14px', top: '-1px', right: '3px' }}
                      >
                        <div
                          className={`coin-card-shell cursor-pointer relative ${
                            selectedCoin === coin.symbol ? 'is-selected' : ''
                          }`}
                        >
                          <CoinCard 
                            coin={coin} 
                            onCardClick={() => handleCoinClick(coin.symbol)}
                            isFavorite={favorites.includes(coin.symbol)}
                            onToggleFavorite={() => onToggleFavorite(coin.symbol)}
                            isMobile={true}
                          />
                        </div>
                      </Badge.Ribbon>
                    </Col>
                    );
                  })}
                </Row>
              </>
            ) : !loading ? (
              <Empty 
                description={
                  viewMode === 'favorites' 
                    ? "没有收藏的币种" 
                    : viewMode === 'popular' 
                    ? "没有找到热门币种" 
                    : "没有找到币种数据"
                }
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ) : (
              <div className="flex justify-center items-center h-24">
                <Spin size="large" />
              </div>
            )}
          </div>

          {/* Pagination - simplified on mobile */}
          {displayedCoins.length > pageSize && (
            <div className="flex justify-center mt-4">
              <Pagination
                current={currentPage}
                onChange={setCurrentPage}
                total={displayedCoins.length}
                pageSize={pageSize}
                showSizeChanger={false}
                simple={isMobile || displayedCoins.length > 50}
                size={isMobile ? "small" : "default"}
              />
            </div>
          )}
        </>
      )}
      
      {!loading && !error && safeCoins.length === 0 && (
        <Alert
          message="没有找到数据"
          description="暂无币种数据，请检查API连接或点击刷新按钮重试。"
          type="info"
          showIcon
          icon={<WarningOutlined />}
          className="mb-4"
          action={
            <Button size="small" type="primary" onClick={handleRefresh}>
              刷新数据
            </Button>
          }
        />
      )}
    </div>
  );
}

// Dashboard 会因为滚动、后台轮询等原因频繁重渲染，这里挡一层
export default React.memo(CoinList);
