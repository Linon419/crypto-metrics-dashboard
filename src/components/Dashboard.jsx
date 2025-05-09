import React, { useState, useEffect } from 'react';
import { Layout, Spin, Alert, DatePicker, Space, Typography } from 'antd';
import dayjs from 'dayjs';
import SearchBar from './SearchBar';
import CoinList from './CoinList';
import CoinDetailChart from './CoinDetailChart';
import LoadingPlaceholder from './LoadingPlaceholder';
import OtcIndexTable from './OtcIndexTable';
import { useLatestMetrics } from '../hooks/useApi';

const { Header, Content } = Layout;
const { Title } = Typography;

function Dashboard() {
  const [selectedDate, setSelectedDate] = useState(dayjs());
  const [selectedCoin, setSelectedCoin] = useState('BTC');
  const [favorites, setFavorites] = useState(
    JSON.parse(localStorage.getItem('favoriteCrypto') || '["BTC", "ETH"]')
  );
  const { latestData, loading, error, refetch } = useLatestMetrics();
  
  // 格式化数据以供组件使用
  const formatCoinsData = (data) => {
    if (!data || !data.coins) return [];
    
    return data.coins.map(coin => ({
      symbol: coin.symbol,
      name: coin.name || coin.symbol,
      price: coin.current_price || 0,
      priceChangePercent: 0, // 这个数据可能需要从其他API获取
      otcIndex: coin.metrics?.otc_index || 0,
      explosionIndex: coin.metrics?.explosion_index || 0,
      schellingPoint: coin.metrics?.schelling_point || 0,
      entryExitType: coin.metrics?.entry_exit_type || 'neutral',
      entryExitDay: coin.metrics?.entry_exit_day || 0
    }));
  };
  
  // 找到选中的币种数据
  const findSelectedCoinData = (coinsData) => {
    return coinsData.find(coin => coin.symbol === selectedCoin) || coinsData[0];
  };
  
  // 处理日期变更
  const handleDateChange = (date) => {
    setSelectedDate(date);
    // 这里可以添加根据日期获取数据的逻辑
  };
  
  // 处理币种选择
  const handleCoinSelect = (symbol) => {
    setSelectedCoin(symbol);
  };
  
  // 手动刷新数据
  const handleRefresh = () => {
    refetch();
  };
  
  // 处理收藏切换
  const handleToggleFavorite = (symbol) => {
    setFavorites(prev => {
      const newFavorites = prev.includes(symbol)
        ? prev.filter(s => s !== symbol)
        : [...prev, symbol];
      
      // 保存到本地存储
      localStorage.setItem('favoriteCrypto', JSON.stringify(newFavorites));
      return newFavorites;
    });
  };

  const coins = latestData ? formatCoinsData(latestData) : [];
  const selectedCoinData = findSelectedCoinData(coins);
  
  return (
    <Layout className="min-h-screen bg-gray-50">
      <Header className="bg-gray-900 px-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center">
          <div className="mr-4 text-xl font-bold text-white">加密货币指标看板</div>
          <SearchBar 
            coins={coins} 
            onSelect={handleCoinSelect} 
            favorites={favorites}
            onToggleFavorite={handleToggleFavorite}
          />
        </div>
        <Space>
          <DatePicker
            value={selectedDate}
            onChange={handleDateChange}
            format="YYYY-MM-DD"
          />
        </Space>
      </Header>
      
      <Content className="p-4">
        {error && (
          <Alert
            message="数据加载错误"
            description={error}
            type="error"
            showIcon
            className="mb-4"
          />
        )}
        
        {loading ? (
          <div className="flex flex-col items-center justify-center">
            <Spin size="large" />
            <div className="mt-4">加载数据中...</div>
          </div>
        ) : (
          <>
            <CoinList
              coins={coins}
              onCoinSelect={handleCoinSelect}
              selectedCoin={selectedCoin}
              favorites={favorites}
              onToggleFavorite={handleToggleFavorite}
            />
            
            {selectedCoinData ? (
              <CoinDetailChart
                coin={selectedCoinData}
                onRefresh={handleRefresh}
              />
            ) : (
              <div className="text-center py-10">
                <Title level={4}>请选择一个币种查看详情</Title>
              </div>
            )}
            
            {/* 添加场外指数表格 */}
            <OtcIndexTable coins={coins} />
          </>
        )}
      </Content>
    </Layout>
  );
}

export default Dashboard;