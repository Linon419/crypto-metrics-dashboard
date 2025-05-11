// src/components/CoinList.jsx - Mobile-friendly version
import React, { useState, useEffect } from 'react';
import { Row, Col, Carousel, Pagination, Spin, Empty, Button, Alert, Card, Badge } from 'antd';
import { ReloadOutlined, WarningOutlined } from '@ant-design/icons';
import CoinCard from './CoinCard';

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
  const pageSize = isMobile ? 4 : 8; // Smaller page size on mobile
  
  const safeCoins = Array.isArray(coins) ? coins : [];

  // Listen for window resize to adjust for mobile
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Filter coins based on view mode
  const filterCoins = () => {
    switch (viewMode) {
      case 'favorites':
        return safeCoins.filter(coin => favorites.includes(coin.symbol));
      case 'popular':
        return safeCoins.filter(coin => {
          const otcIndex = parseInt(coin.otcIndex) || 0;
          const explosionIndex = parseInt(coin.explosionIndex) || 0;
          return otcIndex > 1000 && explosionIndex > 180;
        });
      default:
        return safeCoins;
    }
  };

  const [displayedCoins, setDisplayedCoins] = useState(filterCoins());

  // Update displayed coins when filters change
  useEffect(() => {
    setDisplayedCoins(filterCoins());
    setCurrentPage(1); // Reset to first page
  }, [coins, viewMode, favorites, safeCoins]);

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
    <div className="mb-6">
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
                {currentCoinsToDisplay.map((coin, index) => (
                  <Col key={`${coin.symbol}-${index}`} xs={24} sm={12} md={6}>
                    <Badge.Ribbon 
                      text={coin.entryExitType === 'entry' ? `进${coin.entryExitDay || 0}` : coin.entryExitType === 'exit' ? `退${coin.entryExitDay || 0}` : ''}
                      color={coin.entryExitType === 'entry' ? 'green' : coin.entryExitType === 'exit' ? 'red' : 'blue'}
                      style={{ display: coin.entryExitType === 'neutral' || !coin.entryExitType ? 'none' : 'block', fontSize: '10px', lineHeight: '14px', height: '16px', top: '-2px', right: '10px' }}
                    >
                      <div 
                        className={`cursor-pointer transition-all duration-200 relative ${
                          selectedCoin === coin.symbol 
                            ? 'ring-2 ring-blue-500 shadow-lg rounded-lg transform scale-[1.02]' 
                            : 'hover:shadow-lg hover:scale-[1.01] rounded-lg'
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
                ))}
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
                {/* Grid layout instead of Carousel for better mobile UX */}
                <Row gutter={[12, 12]} className="mb-4">
                  {currentCoinsToDisplay.map((coin, index) => (
                    <Col key={`${coin.symbol}-${index}`} xs={12}>
                      <Badge.Ribbon 
                        text={coin.entryExitType === 'entry' ? `进${coin.entryExitDay || 0}` : coin.entryExitType === 'exit' ? `退${coin.entryExitDay || 0}` : ''}
                        color={coin.entryExitType === 'entry' ? 'green' : coin.entryExitType === 'exit' ? 'red' : 'blue'}
                        style={{ display: coin.entryExitType === 'neutral' || !coin.entryExitType ? 'none' : 'block', fontSize: '10px', lineHeight: '14px', height: '16px', top: '-2px', right: '5px' }}
                      >
                        <div 
                          className={`cursor-pointer relative ${
                            selectedCoin === coin.symbol ? 'ring-2 ring-blue-500 rounded-lg' : 'rounded-lg'
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
                  ))}
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

export default CoinList;