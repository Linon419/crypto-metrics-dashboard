// src/components/CoinList.jsx - 更新以匹配新的布局和按钮颜色
import React, { useState, useEffect } from 'react';
import { Row, Col, Carousel, Pagination, Spin, Empty, Button, Alert, Card, Badge } from 'antd';
import { ReloadOutlined, WarningOutlined, StarFilled, StarOutlined } from '@ant-design/icons'; // Import Star icons
import CoinCard from './CoinCard';

function CoinList({ 
  coins = [], 
  onCoinSelect, 
  selectedCoin, 
  favorites = [], 
  onToggleFavorite, // Make sure this is passed from Dashboard
  loading = false, 
  error = null, 
  onRefresh,
  viewMode = 'all' // 来自父组件的viewMode
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 8; // 每页显示8个币种
  
  const safeCoins = Array.isArray(coins) ? coins : [];

  // 用viewMode筛选币种
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

  // 当coins, viewMode, or favorites改变时，更新displayedCoins并重置页码
  useEffect(() => {
    setDisplayedCoins(filterCoins());
    setCurrentPage(1); // 重置到第一页
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coins, viewMode, favorites, safeCoins]); // Added safeCoins to dependency array if it's derived outside and changes

  // 当没有选定币种且有可用数据时自动选择第一个
  useEffect(() => {
    if (!selectedCoin && displayedCoins.length > 0 && onCoinSelect) {
      const firstCoinToSelect = displayedCoins[0];
      // 优先选择BTC如果存在于当前显示的币种中
      const btcCoin = displayedCoins.find(c => c.symbol === 'BTC');
      onCoinSelect(btcCoin ? btcCoin.symbol : firstCoinToSelect.symbol);
    }
  }, [displayedCoins, selectedCoin, onCoinSelect]);


  // 获取当前页的币种
  const getCurrentPageCoins = () => {
    const startIndex = (currentPage - 1) * pageSize;
    return displayedCoins.slice(startIndex, startIndex + pageSize);
  };

  // 处理币种点击 (不包括星星)
  const handleCoinClick = (coinSymbol) => {
    if (onCoinSelect) {
      onCoinSelect(coinSymbol);
    }
  };
  
  // 处理刷新请求
  const handleRefresh = () => {
    if (onRefresh) {
      onRefresh();
    }
  };
  
  // 备用卡片 - 当数据加载失败时显示
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
      {/* 错误提示 */}
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

      {/* 列表内容 */}
      {loading && currentCoinsToDisplay.length === 0 ? (
        // 加载状态 - 使用骨架屏
        <div className="hidden md:block">
          <Row gutter={[16, 16]} className="mb-4">
            {[...Array(8)].map((_, index) => (
              <Col key={index} xs={24} sm={12} md={6}>
                {renderFallbackCard(index)}
              </Col>
            ))}
          </Row>
        </div>
      ) : (
        <>
          {/* 桌面端显示 */}
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
                        className={`cursor-pointer transition-all duration-200 relative ${ // Added relative for star positioning
                          selectedCoin === coin.symbol 
                            ? 'ring-2 ring-blue-500 shadow-lg rounded-lg transform scale-[1.02]' 
                            : 'hover:shadow-lg hover:scale-[1.01] rounded-lg' // ensure rounded-lg for non-selected too
                        }`}
                      >
                        <CoinCard 
                            coin={coin} 
                            onCardClick={() => handleCoinClick(coin.symbol)} // Pass specific click handler for card body
                            isFavorite={favorites.includes(coin.symbol)}
                            onToggleFavorite={() => onToggleFavorite(coin.symbol)} // Pass toggle favorite handler
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
          
          {/* 移动端轮播 */}
          <div className="block md:hidden">
            {currentCoinsToDisplay.length > 0 ? (
              <Carousel autoplay dotPosition="bottom">
                {currentCoinsToDisplay.map((coin, index) => (
                  <div key={`${coin.symbol}-${index}`} className="px-2 pb-8">
                    <Badge.Ribbon 
                      text={coin.entryExitType === 'entry' ? `进${coin.entryExitDay || 0}` : coin.entryExitType === 'exit' ? `退${coin.entryExitDay || 0}` : ''}
                      color={coin.entryExitType === 'entry' ? 'green' : coin.entryExitType === 'exit' ? 'red' : 'blue'}
                      style={{ display: coin.entryExitType === 'neutral' || !coin.entryExitType ? 'none' : 'block', fontSize: '10px', lineHeight: '14px', height: '16px', top: '-2px', right: '10px' }}
                    >
                      <div 
                        className={`cursor-pointer relative ${ // Added relative for star positioning
                          selectedCoin === coin.symbol ? 'ring-2 ring-blue-500 rounded-lg' : 'rounded-lg'
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
                  </div>
                ))}
              </Carousel>
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
              <div className="flex justify-center items-center h-40">
                <Spin size="large" />
              </div>
            )}
          </div>

          {/* 分页控件 */}
          {displayedCoins.length > pageSize && (
            <div className="flex justify-center mt-4">
              <Pagination
                current={currentPage}
                onChange={setCurrentPage}
                total={displayedCoins.length}
                pageSize={pageSize}
                showSizeChanger={false}
                simple={displayedCoins.length > 50} 
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