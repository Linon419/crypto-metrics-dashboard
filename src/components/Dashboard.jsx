// src/components/Dashboard.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { Layout, Spin, Alert, DatePicker, Space, Typography, Button, Modal, notification, Dropdown, Menu, Avatar, Tooltip } from 'antd';
import { 
  ReloadOutlined, 
  InfoCircleOutlined, 
  ApiOutlined, 
  SearchOutlined,
  FireOutlined,
  StarOutlined,
  DatabaseOutlined,
  UserOutlined,
  LogoutOutlined,
  LockOutlined,
  SettingOutlined, 
  UserSwitchOutlined,
  RiseOutlined,
  FallOutlined
} from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import SearchBar from './SearchBar';
import CoinList from './CoinList';
import CoinDetailChart from './CoinDetailChart';
import OtcIndexTable from './OtcIndexTable';
import LiquidityRadialChart from './LiquidityRadialChart'; // 导入流动性图表组件
import LoadingPlaceholder from './LoadingPlaceholder';
import { fetchLatestMetrics } from '../services/api';
import { logout } from '../redux/slices/authSlice';
import ChangePassword from './ChangePassword';
import UserProfile from './UserProfile';

const { Header, Content } = Layout;
const { Title, Text } = Typography;

function Dashboard() {
  // 状态管理
  const [selectedDate, setSelectedDate] = useState(dayjs());
  const [selectedCoin, setSelectedCoin] = useState(null);
  const [allCoins, setAllCoins] = useState([]);
  const [favorites, setFavorites] = useState(
    JSON.parse(localStorage.getItem('favoriteCrypto') || '["BTC", "ETH"]')
  );
  const [loading, setLoading] = useState(true); 
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [error, setError] = useState(null);
  const [latestDateStr, setLatestDateStr] = useState('');
  const [infoModalVisible, setInfoModalVisible] = useState(false);
  const [apiStatusModalVisible, setApiStatusModalVisible] = useState(false);
  const [apiStatus, setApiStatus] = useState({ ok: false, message: '正在检查API状态...' });
  const [viewMode, setViewMode] = useState('all'); // 'all', 'favorites', 'popular', 'long', 'short'
  const [liquidityData, setLiquidityData] = useState(null); // 新增：存储流动性数据
  // Fix: Move these state declarations inside the component
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [profileModalVisible, setProfileModalVisible] = useState(false);

  // 认证相关
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { user } = useSelector(state => state.auth);
  
  // 加载数据
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await fetchLatestMetrics();
      console.log("API数据加载结果:", result);
      
      if (result) {
        // 格式化币种数据
        const formattedCoins = formatCoinsData(result);
        setAllCoins(formattedCoins);
        
        // 设置默认选中的币种
        if (!selectedCoin && formattedCoins.length > 0) {
          // 优先选择BTC，如果没有则选择第一个币种
          const btcCoin = formattedCoins.find(c => c.symbol === 'BTC');
          setSelectedCoin(btcCoin ? btcCoin.symbol : formattedCoins[0].symbol);
        }
        
        // 设置最新日期
        if (result.date) {
          setLatestDateStr(result.date);
          setSelectedDate(dayjs(result.date));
        }
        
        // 存储流动性数据
        if (result.liquidity) {
          setLiquidityData(result.liquidity);
        }
        
        // 更新API状态
        setApiStatus({ ok: true, message: '数据加载成功，API连接正常' });
        
        // 如果这是首次加载，显示一个通知
        if (!initialLoadComplete) {
          notification.success({
            message: '数据加载成功',
            description: `已获取最新的加密货币指标数据 (${result.date})`,
            duration: 3
          });
          setInitialLoadComplete(true);
        }
      }
    } catch (err) {
      console.error("加载数据失败:", err);
      setError(`加载数据失败：${err.message || "未知错误"}`);
      setApiStatus({ ok: false, message: `API连接错误: ${err.message}` });
      
      // 显示错误通知
      notification.error({
        message: '数据加载失败',
        description: err.message || '无法从服务器获取数据，请检查网络连接',
        duration: 4,
        btn: (
          <Button type="primary" size="small" onClick={checkApiStatus}>
            检查API状态
          </Button>
        )
      });
    } finally {
      setLoading(false);
    }
  }, [selectedCoin, initialLoadComplete]);
  
  // 格式化数据以供组件使用
  const formatCoinsData = (data) => {
    if (!data || !data.coins) return [];
    
    return data.coins.map(coin => {
      // 计算前一天数据的对比变化
      const previousDayData = coin.previous_day_data;
      let explosionIndexChangePercent = null;
      let otcIndexChangePercent = null;
      
      if (previousDayData) {
        // 计算爆破指数变化百分比
        if (previousDayData.explosion_index !== undefined && 
            previousDayData.explosion_index !== null && 
            coin.metrics?.explosion_index !== undefined) {
          const prev = previousDayData.explosion_index;
          const current = coin.metrics.explosion_index;
          if (prev !== 0) {
            explosionIndexChangePercent = ((current - prev) / Math.abs(prev)) * 100;
          } else if (current !== 0) {
            explosionIndexChangePercent = current > 0 ? 100 : -100; // 特殊处理前一天为0的情况
          }
        }
        
        // 计算场外指数变化百分比
        if (previousDayData.otc_index !== undefined && 
            previousDayData.otc_index !== null && 
            coin.metrics?.otc_index !== undefined) {
          const prev = previousDayData.otc_index;
          const current = coin.metrics.otc_index;
          if (prev !== 0) {
            otcIndexChangePercent = ((current - prev) / Math.abs(prev)) * 100;
          } else if (current !== 0) {
            otcIndexChangePercent = current > 0 ? 100 : -100; // 特殊处理前一天为0的情况
          }
        }
      }
      
      return {
        symbol: coin.symbol || 'UNKNOWN',
        name: coin.name || coin.symbol || 'Unknown Coin',
        price: typeof coin.price === 'number' ? coin.price : 
               typeof coin.current_price === 'number' ? coin.current_price : undefined,
        priceChangePercent: typeof coin.priceChangePercent === 'number' ? coin.priceChangePercent : undefined,
        otcIndex: typeof coin.otcIndex === 'number' ? coin.otcIndex : 
                  coin.metrics?.otc_index !== undefined ? coin.metrics.otc_index : undefined,
        explosionIndex: typeof coin.explosionIndex === 'number' ? coin.explosionIndex : 
                        coin.metrics?.explosion_index !== undefined ? coin.metrics.explosion_index : undefined,
        schellingPoint: typeof coin.schellingPoint === 'number' ? coin.schellingPoint : 
                        coin.metrics?.schelling_point !== undefined ? coin.metrics.schelling_point : undefined,
        entryExitType: coin.entryExitType || coin.metrics?.entry_exit_type || 'neutral',
        entryExitDay: typeof coin.entryExitDay === 'number' ? coin.entryExitDay : 
                      typeof coin.metrics?.entry_exit_day === 'number' ? coin.metrics.entry_exit_day : undefined,
        previousDayData: previousDayData,
        explosionIndexChangePercent: explosionIndexChangePercent,
        otcIndexChangePercent: otcIndexChangePercent
      };
    });
  };
  
  // 根据筛选条件过滤币种
  const getFilteredCoins = () => {
    switch (viewMode) {
      case 'favorites':
        return allCoins.filter(coin => favorites.includes(coin.symbol));
        
      case 'popular':
        // 假设热门币种是根据场外指数排序的前5个
        return [...allCoins].sort((a, b) => b.otcIndex - a.otcIndex).slice(0, 5);
        
      case 'long': // 做多策略：爆破指数由负转正或进场开始的币种
        return allCoins.filter(coin => {
          if (!coin.previousDayData) return false;
          
          const prevExplosionIndex = coin.previousDayData.explosion_index;
          const currExplosionIndex = coin.explosionIndex;
          
          // 1. 爆破指数由负转正
          const turnedPositive = prevExplosionIndex < 0 && currExplosionIndex > 0;
          
          // 2. 新进入进场期
          const justEnteredEntry = coin.entryExitType === 'entry' && coin.entryExitDay <= 3;
          
          // 3. 爆破指数大幅上升（上升30%以上）
          const significantIncrease = prevExplosionIndex > 0 && 
                                     currExplosionIndex > 0 &&
                                     coin.explosionIndexChangePercent > 30;
          
          return turnedPositive || justEnteredEntry || significantIncrease;
        });
        
      case 'short': // 做空策略：爆破指数跌破200或进入退场期的币种
        return allCoins.filter(coin => {
          if (!coin.previousDayData) return false;
          
          const prevExplosionIndex = coin.previousDayData.explosion_index;
          const currExplosionIndex = coin.explosionIndex;
          
          // 1. 爆破指数跌破200
          const brokeThreshold = prevExplosionIndex >= 200 && currExplosionIndex < 200;
          
          // 2. 新进入退场期
          const justEnteredExit = coin.entryExitType === 'exit' && coin.entryExitDay === 1;
          
          // 3. 爆破指数大幅下降（下降30%以上）
          const significantDecrease = prevExplosionIndex > 0 && 
                                     currExplosionIndex > 0 &&
                                     coin.explosionIndexChangePercent < -30;
          
          return brokeThreshold || justEnteredExit || significantDecrease;
        });
        
      default:
        return allCoins;
    }
  };
  
  // 首次加载
  useEffect(() => {
    loadData();
    
    // 每5分钟自动刷新一次数据
    const refreshInterval = setInterval(() => {
      loadData();
    }, 5 * 60 * 1000);
    
    return () => clearInterval(refreshInterval);
  }, [loadData]);
  
  // 处理日期变更 - 可以通过日期显示历史数据
  const handleDateChange = (date) => {
    if (date) {
      setSelectedDate(date);
      // 这里可以添加根据日期获取数据的逻辑
      // fetchDataByDate(date.format('YYYY-MM-DD'));
    }
  };
  
  // 处理币种选择
  const handleCoinSelect = (symbol) => {
    if (symbol) {
      setSelectedCoin(symbol);
    }
  };
  
  // 手动刷新数据
  const handleRefresh = () => {
    loadData();
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
  
  // 找到选中的币种数据
  const getSelectedCoinData = () => {
    return allCoins.find(coin => coin.symbol === selectedCoin);
  };
  
  // 打开币种信息模态框
  const openInfoModal = () => {
    setInfoModalVisible(true);
  };
  
  // 检查API状态
  const checkApiStatus = async () => {
    setApiStatusModalVisible(true);
    setApiStatus({ ok: false, message: '正在检查API连接...' });
    
    try {
      // 尝试调用API
      await fetchLatestMetrics();
      setApiStatus({ ok: true, message: 'API连接正常，服务器响应成功' });
    } catch (err) {
      setApiStatus({ 
        ok: false, 
        message: `API连接失败: ${err.message || '未知错误'}` 
      });
    }
  };

  // 退出登录
  const handleLogout = () => {
    dispatch(logout());
    navigate('/login');
  };
  
  // 用户菜单
  const userMenu = (
    <Menu>
      <Menu.Item key="username" disabled>
        <UserOutlined /> {user?.username || '用户'}
      </Menu.Item>
      <Menu.Divider />
      <Menu.Item 
        key="profile" 
        onClick={() => setProfileModalVisible(true)}
        icon={<UserSwitchOutlined />}
      >
        账户信息
      </Menu.Item>
      <Menu.Item 
        key="change-password" 
        onClick={() => setPasswordModalVisible(true)}
        icon={<LockOutlined />}
      >
        修改密码
      </Menu.Item>
      <Menu.Divider />
      <Menu.Item key="logout" onClick={handleLogout} icon={<LogoutOutlined />}>
        退出登录
      </Menu.Item>
    </Menu>
  );

  // 改进的按钮样式 - 使用更高对比度的颜色
  const buttonStyle = {
    fontWeight: 500,
    borderWidth: '2px', 
  };

  const filteredCoins = getFilteredCoins();

  return (
    <Layout className="min-h-screen bg-gray-50">
      <Header className="bg-gray-900 px-4 flex flex-wrap justify-between items-center shadow-sm">
        <div className="flex items-center mb-2 sm:mb-0">
          <div className="mr-4 text-xl font-bold text-white">加密货币指标看板</div>
          <SearchBar 
            coins={allCoins} 
            onSelect={handleCoinSelect} 
            favorites={favorites}
            onToggleFavorite={handleToggleFavorite}
            loading={loading}
          />
        </div>
        <Space wrap className="mb-2 sm:mb-0">
          {latestDateStr && (
            <Text className="text-gray-300 mr-2">
              最新数据: {latestDateStr}
            </Text>
          )}
          <DatePicker
            value={selectedDate}
            onChange={handleDateChange}
            format="YYYY-MM-DD"
            allowClear={false}
            className="mr-2"
          />
          <Button 
            type="primary" 
            icon={<ReloadOutlined />} 
            onClick={handleRefresh}
            loading={loading}
            style={{ background: '#1890ff', borderColor: '#1890ff', ...buttonStyle }}
          >
            刷新数据
          </Button>
          <Button
            icon={<InfoCircleOutlined />}
            onClick={openInfoModal}
            style={{ background: '#722ed1', borderColor: '#722ed1', color: 'white', ...buttonStyle }}
          >
            指标说明
          </Button>
          <Button
            icon={<ApiOutlined />}
            onClick={checkApiStatus}
            danger={!apiStatus.ok}
            style={{ 
              background: !apiStatus.ok ? '#ff4d4f' : '#52c41a', 
              borderColor: !apiStatus.ok ? '#ff4d4f' : '#52c41a', 
              color: 'white',
              ...buttonStyle
            }}
          >
            API状态
          </Button>
          
          {/* 用户信息下拉菜单 */}
          <Dropdown overlay={userMenu} trigger={['click']}>
            <Button
              icon={<UserOutlined />}
              type="primary"
              style={{ 
                background: '#0050b3', 
                borderColor: '#0050b3', 
                color: 'white',
                ...buttonStyle 
              }}
            >
              {user?.username || '用户'} <span className="ml-1">▼</span>
            </Button>
          </Dropdown>
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
            action={
              <Space>
                <Button type="primary" size="small" onClick={handleRefresh}>
                  重试
                </Button>
                <Button size="small" onClick={checkApiStatus}>
                  检查API
                </Button>
              </Space>
            }
          />
        )}
        
        {/* 币种视图选择按钮 */}
        <div className="flex flex-wrap mb-4 gap-2">
          <Button 
            type="primary"
            icon={<DatabaseOutlined />}
            onClick={() => setViewMode('all')}
            style={{ 
              background: viewMode === 'all' ? '#1890ff' : '#f0f0f0', 
              borderColor: viewMode === 'all' ? '#1890ff' : '#d9d9d9',
              color: viewMode === 'all' ? 'white' : 'rgba(0, 0, 0, 0.85)',
              ...buttonStyle
            }}
          >
            全部币种
          </Button>
          
          <Button 
            icon={<StarOutlined />}
            onClick={() => setViewMode('favorites')}
            style={{ 
              background: viewMode === 'favorites' ? '#faad14' : '#f0f0f0', 
              borderColor: viewMode === 'favorites' ? '#faad14' : '#d9d9d9',
              color: viewMode === 'favorites' ? 'white' : 'rgba(0, 0, 0, 0.85)',
              ...buttonStyle
            }}
          >
            收藏币种
          </Button>
          
          <Button 
            icon={<FireOutlined />}
            onClick={() => setViewMode('popular')}
            style={{ 
              background: viewMode === 'popular' ? '#ff4d4f' : '#f0f0f0', 
              borderColor: viewMode === 'popular' ? '#ff4d4f' : '#d9d9d9',
              color: viewMode === 'popular' ? 'white' : 'rgba(0, 0, 0, 0.85)',
              ...buttonStyle
            }}
          >
            热门币种
          </Button>
          
          {/* 新增做多策略按钮 */}
          <Tooltip title="筛选爆破指数由负转正或进入进场期的币种">
            <Button 
              icon={<RiseOutlined />}
              onClick={() => setViewMode('long')}
              style={{ 
                background: viewMode === 'long' ? '#52c41a' : '#f0f0f0', 
                borderColor: viewMode === 'long' ? '#52c41a' : '#d9d9d9',
                color: viewMode === 'long' ? 'white' : 'rgba(0, 0, 0, 0.85)',
                ...buttonStyle
              }}
            >
              做多策略
            </Button>
          </Tooltip>
          
          {/* 新增做空策略按钮 */}
          <Tooltip title="筛选爆破指数跌破200或新进入退场期的币种">
            <Button 
              icon={<FallOutlined />}
              onClick={() => setViewMode('short')}
              style={{ 
                background: viewMode === 'short' ? '#ff4d4f' : '#f0f0f0', 
                borderColor: viewMode === 'short' ? '#ff4d4f' : '#d9d9d9',
                color: viewMode === 'short' ? 'white' : 'rgba(0, 0, 0, 0.85)',
                ...buttonStyle
              }}
            >
              做空策略
            </Button>
          </Tooltip>
          
          <Button 
            icon={<ReloadOutlined />} 
            onClick={handleRefresh}
            loading={loading}
            style={{ marginLeft: 'auto', ...buttonStyle }}
          >
            刷新
          </Button>
        </div>
        
        {loading && !allCoins.length ? (
          <LoadingPlaceholder />
        ) : (
          <>
            <CoinList
              coins={filteredCoins}
              onCoinSelect={handleCoinSelect}
              selectedCoin={selectedCoin}
              favorites={favorites}
              onToggleFavorite={handleToggleFavorite}
              loading={loading}
              error={error}
              onRefresh={handleRefresh}
              viewMode={viewMode}
            />
            
            {selectedCoin && getSelectedCoinData() ? (
              <CoinDetailChart
                coin={getSelectedCoinData()}
                onRefresh={handleRefresh}
              />
            ) : (
              <div className="text-center py-10 bg-white rounded-lg shadow mb-4">
                <SearchOutlined style={{ fontSize: 32 }} className="text-gray-400 mb-4" />
                <Title level={4}>请选择一个币种查看详情</Title>
                <Text className="text-gray-500">
                  点击上方的币种卡片查看详细图表和指标数据
                </Text>
              </div>
            )}
            
            {/* 新增：流动性概况图表 */}
            <LiquidityRadialChart
              liquidity={liquidityData}
              loading={loading}
            />
            
            {/* 添加场外指数表格 */}
            <OtcIndexTable 
              coins={filteredCoins} 
              loading={loading}
              onRefresh={handleRefresh}
            />
          </>
        )}
      </Content>

      {/* 指标说明模态框 */}
      <Modal
        title="指标说明"
        open={infoModalVisible}
        onCancel={() => setInfoModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setInfoModalVisible(false)}>
            关闭
          </Button>
        ]}
        width={700}
      >
        <div className="space-y-4">
          <div>
            <Title level={5}>场外指数 (OTC Index)</Title>
            <Text>场外指数是衡量加密货币场外交易活跃度的指标。数值越高表示场外交易越活跃，通常与市场情绪有关。</Text>
            <Text className="block mt-1">1000是重要临界值：高于1000是最后一次加仓的时机，后面考虑何时盈利退出；低于1000表示拉盘资金阻力大于动力，难以形成新高突破。</Text>
          </div>
          
          <div>
            <Title level={5}>爆破指数 (Explosion Index)</Title>
            <Text>爆破指数反映市场可能大幅波动的风险。当指数低于200时，表示市场处于风险区间，可能存在较大的下跌风险。指数高于200通常被视为安全区间。</Text>
            <Text className="block mt-1">爆破指数对抄底时机指示有奇效：由负变正时基本都可以在合适位置抄底。爆破指数转正和进场开始都是抄底和加仓的好时机。</Text>
          </div>
          
          <div>
            <Title level={5}>谢林点 (Schelling Point)</Title>
            <Text>谢林点是一种市场共识价格，表示多数交易者认为合理的价格水平。这个指标有助于判断市场对价格的整体预期。</Text>
          </div>
          
          <div>
            <Title level={5}>进/退场期 (Entry/Exit Period)</Title>
            <Text>进场期表示适合买入的市场阶段，退场期表示适合卖出的市场阶段。后面的数字表示当前阶段的持续天数。</Text>
          </div>
          
          <div>
            <Title level={5}>策略筛选功能</Title>
            <Text className="block font-medium">做多策略：</Text>
            <Text>筛选出爆破指数由负转正、新进入进场期或爆破指数大幅上升的币种。这些通常是抄底和加仓的好时机。</Text>
            
            <Text className="block font-medium mt-2">做空策略：</Text>
            <Text>筛选出爆破指数跌破200、新进入退场期或爆破指数大幅下降的币种。这些通常是止盈或做空的好时机。</Text>
          </div>
          
          {/* 新增流动性概况的说明 */}
          <div>
            <Title level={5}>流动性概况 (Liquidity Overview)</Title>
            <Text>流动性概况展示了主要加密货币资金流入流出情况，包括BTC、ETH和SOL的资金变化以及总市场资金变化。正值表示资金流入，负值表示资金流出，单位为亿美元。</Text>
          </div>
        </div>
      </Modal>
      
      {/* API状态检查模态框 */}
      <Modal
        title="API连接状态"
        open={apiStatusModalVisible}
        onCancel={() => setApiStatusModalVisible(false)}
        footer={[
          <Button 
            key="retry" 
            type="primary" 
            onClick={checkApiStatus}
            loading={apiStatus.message.includes('正在检查')}
          >
            重新检查
          </Button>,
          <Button key="close" onClick={() => setApiStatusModalVisible(false)}>
            关闭
          </Button>
        ]}
      >
        <div className="p-4 flex items-center">
          {apiStatus.ok ? (
            <div className="w-4 h-4 rounded-full bg-green-500 mr-2"></div>
          ) : (
            <div className="w-4 h-4 rounded-full bg-red-500 mr-2"></div>
          )}
          <Text>{apiStatus.message}</Text>
        </div>
        
        <div className="mt-4 p-4 bg-gray-50 rounded-lg">
          <Title level={5}>API连接信息</Title>
          <Text>API基础URL: {process.env.REACT_APP_API_URL || 'http://localhost:3001/api'}</Text>
          
          <div className="mt-2">
            <Text strong>常见问题：</Text>
            <ul className="mt-1 list-disc pl-5">
              <li>检查API服务器是否正在运行</li>
              <li>确认网络连接正常</li>
              <li>验证API端点配置是否正确</li>
              <li>查看后端服务器日志获取详细错误信息</li>
            </ul>
          </div>
        </div>
      </Modal>

      {/* 用户信息模态框 */}
      <UserProfile 
        visible={profileModalVisible}
        onClose={() => setProfileModalVisible(false)}
      />
      
      {/* 密码修改模态框 */}
      <ChangePassword 
        visible={passwordModalVisible}
        onClose={() => setPasswordModalVisible(false)}
      />
    </Layout>
  );
}

export default Dashboard;