// src/components/CoinList.jsx - 修复数据加载和显示问题
import React, { useState, useEffect } from 'react';
import { Row, Col, Carousel, Pagination, Spin, Empty, Button, Alert, Card } from 'antd';
import { ReloadOutlined, WarningOutlined } from '@ant-design/icons';
import CoinCard from './CoinCard';

function CoinList({ coins = [], onCoinSelect, selectedCoin, favorites = [], onToggleFavorite, loading = false, error = null, onRefresh }) {
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState('all'); // 'all', 'favorites', 'popular'
  const pageSize = 8; // 每页显示8个币种
  
  // 当没有选定币种且有可用数据时自动选择第一个
  useEffect(() => {
    if (!selectedCoin && coins.length > 0 && onCoinSelect) {
      // 优先选择BTC如果存在
      const btcCoin = coins.find(c => c.symbol === 'BTC');
      onCoinSelect(btcCoin ? btcCoin.symbol : coins[0].symbol);
    }
  }, [coins, selectedCoin, onCoinSelect]);

  // 根据当前视图模式筛选币种
  const filterCoins = () => {
    // 确保数据是数组类型
    const safeCoins = Array.isArray(coins) ? coins : [];
    
    switch (viewMode) {
      case 'favorites':
        return safeCoins.filter(coin => favorites.includes(coin.symbol));
      case 'popular':
        // 这里可以根据特定指标筛选热门币种，比如爆破指数或场外指数较高的
        return safeCoins.filter(coin => (coin.explosionIndex || 0) > 170);
      default:
        return safeCoins;
    }
  };

  // 获取当前页的币种
  const getCurrentPageCoins = () => {
    const filteredCoins = filterCoins();
    const startIndex = (currentPage - 1) * pageSize;
    return filteredCoins.slice(startIndex, startIndex + pageSize);
  };

  // 处理币种点击
  const handleCoinClick = (coin) => {
    if (onCoinSelect) {
      onCoinSelect(coin.symbol);
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

  return (
    <div className="mb-6">
      {/* 顶部控制栏 */}
      <div className="flex flex-wrap justify-between items-center mb-4">
        <div className="flex space-x-2 mb-2 sm:mb-0">
          <Button 
            type={viewMode === 'all' ? 'primary' : 'default'}
            onClick={() => setViewMode('all')}
          >
            全部币种
          </Button>
          <Button 
            type={viewMode === 'favorites' ? 'primary' : 'default'}
            onClick={() => setViewMode('favorites')}
          >
            收藏币种
          </Button>
          <Button 
            type={viewMode === 'popular' ? 'primary' : 'default'} 
            onClick={() => setViewMode('popular')}
          >
            热门币种
          </Button>
        </div>
        <Button 
          icon={<ReloadOutlined />} 
          onClick={handleRefresh}
          loading={loading}
        >
          刷新
        </Button>
      </div>

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
      {loading && getCurrentPageCoins().length === 0 ? (
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
            {getCurrentPageCoins().length > 0 ? (
              <Row gutter={[16, 16]} className="mb-4">
                {getCurrentPageCoins().map((coin, index) => (
                  <Col key={`${coin.symbol}-${index}`} xs={24} sm={12} md={6}>
                    <div 
                      onClick={() => handleCoinClick(coin)}
                      className={`cursor-pointer transition-all duration-200 ${
                        selectedCoin === coin.symbol 
                          ? 'ring-2 ring-blue-500 shadow-md rounded-lg transform scale-[1.02]' 
                          : 'hover:shadow-md hover:scale-[1.01]'
                      }`}
                    >
                      <CoinCard coin={coin} />
                    </div>
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
            {getCurrentPageCoins().length > 0 ? (
              <Carousel autoplay dotPosition="bottom">
                {getCurrentPageCoins().map((coin, index) => (
                  <div key={`${coin.symbol}-${index}`} className="px-2 pb-8">
                    <div 
                      onClick={() => handleCoinClick(coin)}
                      className={`cursor-pointer ${
                        selectedCoin === coin.symbol ? 'ring-2 ring-blue-500 rounded-lg' : ''
                      }`}
                    >
                      <CoinCard coin={coin} />
                    </div>
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
          {filterCoins().length > pageSize && (
            <div className="flex justify-center mt-4">
              <Pagination
                current={currentPage}
                onChange={setCurrentPage}
                total={filterCoins().length}
                pageSize={pageSize}
                showSizeChanger={false}
                simple={filterCoins().length > 50} // 简化版本的分页组件，适合大量数据
              />
            </div>
          )}
        </>
      )}
      
      {/* 无数据情况下的提示 */}
      {!loading && coins.length === 0 && !error && (
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