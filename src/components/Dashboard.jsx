// src/components/Dashboard.jsx - Mobile-friendly version
import React, { useState, useEffect, useCallback } from 'react';
import { Layout, Tag, Divider, Spin, Alert, DatePicker, Space, Typography, Button, Modal, notification, Dropdown, Menu, Avatar, Tooltip, Drawer } from 'antd';
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
  FallOutlined,
  MenuOutlined,
  AppstoreOutlined
} from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import SearchBar from './SearchBar';
import CoinList from './CoinList';
import CoinDetailChart from './CoinDetailChart';
import OtcIndexTable from './OtcIndexTable';
import LiquidityRadialChart from './LiquidityRadialChart';
import LoadingPlaceholder from './LoadingPlaceholder';
import { fetchLatestMetrics } from '../services/api'; // Keep this
import { logout } from '../redux/slices/authSlice';
import ChangePassword from './ChangePassword';
import UserProfile from './UserProfile';
import { useFavorites } from '../hooks/useFavorites'; // Keep this


const { Header, Content } = Layout;
const { Title, Text } = Typography;

function Dashboard() {
  // State management
  const [selectedDate, setSelectedDate] = useState(dayjs());
  const [selectedCoin, setSelectedCoin] = useState(null);
  const [allCoins, setAllCoins] = useState([]);
  const {
    favorites,
    // loading: favoritesLoading, // favoritesLoading is not used, can be removed if not needed elsewhere
    error: favoritesError,
    toggleFavorite,
    refreshFavorites
  } = useFavorites();
  const [loading, setLoading] = useState(true);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [error, setError] = useState(null);
  const [latestDateStr, setLatestDateStr] = useState('');
  const [infoModalVisible, setInfoModalVisible] = useState(false);
  const [apiStatusModalVisible, setApiStatusModalVisible] = useState(false);
  const [apiStatus, setApiStatus] = useState({ ok: false, message: '正在检查API状态...' });
  const [viewMode, setViewMode] = useState('all'); // 'all', 'favorites', 'popular', 'long', 'short'
  const [liquidityData, setLiquidityData] = useState(null);
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [profileModalVisible, setProfileModalVisible] = useState(false);

  // Mobile-specific state
  const [menuDrawerVisible, setMenuDrawerVisible] = useState(false);
  const [filterDrawerVisible, setFilterDrawerVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  // Authentication related
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { user } = useSelector(state => state.auth);

  // Window resize handler for responsive design
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await fetchLatestMetrics(); // This already contains previousDayData
      // console.log("[DASHBOARD - fetchLatestMetrics result]", JSON.stringify(result, null, 2));


      if (result && result.coins) { // Check if result and result.coins are valid
        // No need for an additional formatCoinsData if fetchLatestMetrics already prepares the data well
        setAllCoins(result.coins); // Directly use coins from fetchLatestMetrics

        if (!selectedCoin && result.coins.length > 0) {
          const btcCoin = result.coins.find(c => c.symbol === 'BTC');
          setSelectedCoin(btcCoin ? btcCoin.symbol : result.coins[0].symbol);
        }

        if (result.date) {
          setLatestDateStr(result.date);
          setSelectedDate(dayjs(result.date));
        }

        if (result.liquidity) {
          setLiquidityData(result.liquidity);
        }

        setApiStatus({ ok: true, message: '数据加载成功，API连接正常' });

        if (!initialLoadComplete) {
          notification.success({
            message: '数据加载成功',
            description: `已获取最新的加密货币指标数据 (${result.date || '未知日期'})`,
            duration: 3
          });
          setInitialLoadComplete(true);
        }
      } else {
        // Handle case where result or result.coins is not as expected
        console.warn("loadData: fetchLatestMetrics did not return expected data structure.", result);
        setAllCoins([]); // Set to empty array to avoid errors in child components
        setError("获取到的数据格式不正确");
      }
    } catch (err) {
      console.error("加载数据失败:", err);
      setError(`加载数据失败：${err.message || "未知错误"}`);
      setApiStatus({ ok: false, message: `API连接错误: ${err.message}` });

      notification.error({
        message: '数据加载失败',
        description: err.message || '无法从服务器获取数据，请检查网络连接',
        duration: 4,
        btn: (
          <Button type="primary" size="small" onClick={() => checkApiStatus()}>
            检查API状态
          </Button>
        )
      });
    } finally {
      setLoading(false);
    }
  }, [selectedCoin, initialLoadComplete]); // Removed formatCoinsData from dependencies as it's defined inside or constant

  // Filter coins based on view mode
  const getFilteredCoins = () => {
    // Ensure allCoins is an array before filtering
    const currentAllCoins = Array.isArray(allCoins) ? allCoins : [];

    switch (viewMode) {
      case 'favorites':
        return currentAllCoins.filter(coin => favorites.includes(coin.symbol));

      case 'popular':
        // Ensure otcIndex is a number for sorting, provide a default if not
        return [...currentAllCoins].sort((a, b) => (b.otcIndex || 0) - (a.otcIndex || 0)).slice(0, 10); // Increased to 10

      case 'long': // Long strategy
        return currentAllCoins.filter(coin => {
          if (!coin.previousDayData || coin.explosionIndex === undefined || coin.previousDayData.explosion_index === undefined) return false;

          const prevExplosionIndex = parseFloat(coin.previousDayData.explosion_index);
          const currExplosionIndex = parseFloat(coin.explosionIndex);
          const explosionChangePercent = parseFloat(coin.explosionIndexChangePercent);


          const turnedPositive = prevExplosionIndex < 0 && currExplosionIndex > 0;
          const justEnteredEntry = coin.entryExitType === 'entry' && (coin.entryExitDay || 0) <= 3;
          const significantIncrease = prevExplosionIndex >= 0 && // Changed from >0 to >=0 to include cases from 0
                                     currExplosionIndex > 0 &&
                                     !isNaN(explosionChangePercent) && explosionChangePercent > 30;

          return turnedPositive || justEnteredEntry || significantIncrease;
        });

      case 'short': // Short strategy
        return currentAllCoins.filter(coin => {
            if (!coin.previousDayData || coin.explosionIndex === undefined || coin.previousDayData.explosion_index === undefined) return false;

            const prevExplosionIndex = parseFloat(coin.previousDayData.explosion_index);
            const currExplosionIndex = parseFloat(coin.explosionIndex);
            const explosionChangePercent = parseFloat(coin.explosionIndexChangePercent);

            const brokeThreshold = prevExplosionIndex >= 200 && currExplosionIndex < 200;
            const justEnteredExit = coin.entryExitType === 'exit' && (coin.entryExitDay || 0) === 1;
            const significantDecrease = prevExplosionIndex > 0 &&
                                     currExplosionIndex > 0 && // Or currExplosionIndex < prevExplosionIndex if allowing negative current
                                     !isNaN(explosionChangePercent) && explosionChangePercent < -30;

          return brokeThreshold || justEnteredExit || significantDecrease;
        });

      default:
        return currentAllCoins;
    }
  };

  // Load data on mount
  useEffect(() => {
    loadData();

    const refreshInterval = setInterval(() => {
      loadData();
    }, 5 * 60 * 1000);

    return () => clearInterval(refreshInterval);
  }, [loadData]); // loadData is now stable due to useCallback

  // Handle date change
  const handleDateChange = (date) => {
    if (date) {
      setSelectedDate(date);
      // Potentially reload data for the new date if your API supports it
      // loadData(date.format('YYYY-MM-DD')); // Example if loadData accepted a date
    }
  };

  // Handle coin selection
  const handleCoinSelect = (symbol) => {
    if (symbol) {
      setSelectedCoin(symbol);
      if (isMobile) {
        setMenuDrawerVisible(false);
      }
    }
  };

  // Refresh data manually
  const handleRefresh = () => {
    loadData();
    refreshFavorites();
  };

  // Handle favorite toggle
  const handleToggleFavorite = async (symbol) => {
    try {
      await toggleFavorite(symbol);
      // Optionally: show success notification or update UI immediately if not handled by useFavorites hook
    } catch (error) {
      notification.error({
        message: '收藏失败',
        description: error.message || '操作收藏时出错，请稍后重试'
      });
    }
  };


  // Get selected coin data
  const getSelectedCoinData = () => {
    // Ensure allCoins is an array
    const currentAllCoins = Array.isArray(allCoins) ? allCoins : [];
    return currentAllCoins.find(coin => coin.symbol === selectedCoin);
  };

  // Open info modal
  const openInfoModal = () => {
    setInfoModalVisible(true);
  };

  // Check API status
  const checkApiStatus = async () => {
    setApiStatusModalVisible(true);
    setApiStatus({ ok: false, message: '正在检查API连接...' });

    try {
      await fetchLatestMetrics(); // This function itself will try to fetch from /data/latest
      setApiStatus({ ok: true, message: 'API连接正常，服务器响应成功' });
    } catch (err) {
      setApiStatus({
        ok: false,
        message: `API连接失败: ${err.message || '未知错误'}`
      });
    }
  };

  // Logout handler
  const handleLogout = () => {
    dispatch(logout());
    navigate('/login');
  };

  // View mode handler
  const handleViewModeChange = (mode) => {
    setViewMode(mode);
    if (isMobile) {
      setFilterDrawerVisible(false);
    }
  };

  // Mobile menu items
  const mobileMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: user?.username || '用户',
      onClick: () => setProfileModalVisible(true)
    },
    {
      key: 'password',
      icon: <LockOutlined />,
      label: '修改密码',
      onClick: () => setPasswordModalVisible(true)
    },
    {
      key: 'info',
      icon: <InfoCircleOutlined />,
      label: '指标说明',
      onClick: openInfoModal
    },
    {
      key: 'api',
      icon: <ApiOutlined />,
      label: 'API状态',
      onClick: checkApiStatus,
      danger: !apiStatus.ok
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: handleLogout,
      danger: true
    }
  ];

  // User dropdown menu (desktop)
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

  // Button style
  const buttonStyle = {
    fontWeight: 500,
    borderWidth: '2px',
  };

  const filteredCoins = getFilteredCoins();
    // console.log("[DASHBOARD - filteredCoins for OtcIndexTable[0]]", filteredCoins && filteredCoins.length > 0 ? JSON.stringify(filteredCoins[0], null, 2) : "empty or undefined");


  // Render mobile filter buttons in drawer
  const renderMobileFilterButtons = () => (
    <Menu mode="vertical" selectedKeys={[viewMode]}>
      <Menu.Item
        key="all"
        icon={<DatabaseOutlined />}
        onClick={() => handleViewModeChange('all')}
      >
        全部币种
      </Menu.Item>
      <Menu.Item
        key="favorites"
        icon={<StarOutlined />}
        onClick={() => handleViewModeChange('favorites')}
      >
        收藏币种
      </Menu.Item>
      <Menu.Item
        key="popular"
        icon={<FireOutlined />}
        onClick={() => handleViewModeChange('popular')}
      >
        热门币种
      </Menu.Item>
      <Menu.Item
        key="long"
        icon={<RiseOutlined />}
        onClick={() => handleViewModeChange('long')}
      >
        做多策略
      </Menu.Item>
      <Menu.Item
        key="short"
        icon={<FallOutlined />}
        onClick={() => handleViewModeChange('short')}
      >
        做空策略
      </Menu.Item>
    </Menu>
  );

  return (
    <Layout className="min-h-screen bg-gray-50">
      {/* Mobile-friendly header */}
      <Header className="bg-gray-900 px-2 sm:px-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center">
          {isMobile && (
            <Button
              type="text"
              icon={<MenuOutlined />}
              onClick={() => setMenuDrawerVisible(true)}
              className="text-white mr-2"
            />
          )}
          <div className="text-xl font-bold text-white mr-3">加密指标</div>
          <SearchBar
            coins={allCoins}
            onSelect={handleCoinSelect}
            favorites={favorites}
            onToggleFavorite={handleToggleFavorite}
            loading={loading}
          />
        </div>

        {/* Desktop controls */}
        {!isMobile && (
          <Space wrap>
            {latestDateStr && (
              <Text className="text-gray-300 mr-2 hidden sm:inline">
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
              刷新
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

            {/* User dropdown menu */}
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
        )}

        {/* Mobile action buttons */}
        {isMobile && (
          <Space>
            <Button
              type="text"
              icon={<AppstoreOutlined />}
              onClick={() => setFilterDrawerVisible(true)}
              className="text-white"
            />
            <Button
              type="text"
              icon={<ReloadOutlined />}
              onClick={handleRefresh}
              loading={loading}
              className="text-white"
            />
          </Space>
        )}
      </Header>

      <Content className="p-2 sm:p-4">
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
        {/* 在这里添加收藏错误的代码 */}
        {favoritesError && (
            <Alert
            message="收藏加载错误"
            description={favoritesError}
            type="warning"
            showIcon
            className="mb-4"
            action={
                <Button size="small" onClick={refreshFavorites}>
                重试
                </Button>
            }
            />
        )}
        {/* Desktop coin filter buttons */}
        {!isMobile && (
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

            {/* Long strategy button */}
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

            {/* Short strategy button */}
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
        )}

        {/* Current view mode indicator (mobile) */}
        {isMobile && (
          <div className="mb-3 flex justify-between items-center">
            <div className="flex items-center">
              <Text strong className="mr-2">当前视图: </Text>
              <Tag
                color={
                  viewMode === 'all' ? 'blue' :
                  viewMode === 'favorites' ? 'gold' :
                  viewMode === 'popular' ? 'red' :
                  viewMode === 'long' ? 'green' :
                  viewMode === 'short' ? 'volcano' : 'default'
                }
              >
                {
                  viewMode === 'all' ? '全部币种' :
                  viewMode === 'favorites' ? '收藏币种' :
                  viewMode === 'popular' ? '热门币种' :
                  viewMode === 'long' ? '做多策略' :
                  viewMode === 'short' ? '做空策略' : '未知'
                }
              </Tag>
            </div>
            {latestDateStr && (
              <Text type="secondary" className="text-xs">
                {latestDateStr}
              </Text>
            )}
          </div>
        )}

        {(loading && (!allCoins || allCoins.length === 0)) ? (
          <LoadingPlaceholder />
        ) : (
          <>
            <CoinList
              coins={filteredCoins}
              onCoinSelect={handleCoinSelect}
              selectedCoin={selectedCoin}
              favorites={favorites}
              onToggleFavorite={handleToggleFavorite}
              loading={loading && (!allCoins || allCoins.length === 0)} // Show loading in CoinList only if allCoins is truly empty
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
              !loading && ( // Only show placeholder if not loading and no coin selected
                <div className="text-center py-10 bg-white rounded-lg shadow mb-4">
                  <SearchOutlined style={{ fontSize: 32 }} className="text-gray-400 mb-4" />
                  <Title level={4}>请选择一个币种查看详情</Title>
                  <Text className="text-gray-500">
                    点击上方的币种卡片查看详细图表和指标数据
                  </Text>
                </div>
              )
            )}

            {/* Liquidity chart */}
            <LiquidityRadialChart
              liquidity={liquidityData}
              loading={loading && !liquidityData} // Show loading if liquidity data is not yet available
            />

            {/* OTC index table */}
            <OtcIndexTable
              coins={filteredCoins}
              loading={loading && (!allCoins || allCoins.length === 0)} // Show loading in Table only if allCoins is truly empty
              onRefresh={handleRefresh}
            />
          </>
        )}
      </Content>

      {/* Mobile menu drawer */}
      <Drawer
        title={
          <div className="flex items-center">
            <UserOutlined className="mr-2" />
            <span>{user?.username || '用户'}</span>
          </div>
        }
        placement="left"
        open={menuDrawerVisible}
        onClose={() => setMenuDrawerVisible(false)}
        width={280}
        bodyStyle={{ padding: 0 }}
      >
        <Menu mode="vertical" style={{ border: 'none' }}>
          {mobileMenuItems.map(item => (
            <Menu.Item
              key={item.key}
              icon={item.icon}
              onClick={() => { item.onClick(); setMenuDrawerVisible(false); }} // Close drawer on click
              danger={item.danger}
              className={item.danger ? 'text-red-500' : ''}
            >
              {item.label}
            </Menu.Item>
          ))}
        </Menu>

        <Divider />

        <div className="p-4">
          <Text type="secondary">
            加密货币指标看板 ©2025
          </Text>
        </div>
      </Drawer>

      {/* Mobile filter drawer */}
      <Drawer
        title="筛选视图"
        placement="right"
        open={filterDrawerVisible}
        onClose={() => setFilterDrawerVisible(false)}
        width={280}
        bodyStyle={{ padding: 0 }}
      >
        {renderMobileFilterButtons()}

        <Divider />

        <div className="p-4">
          <DatePicker
            value={selectedDate}
            onChange={(date) => {
              handleDateChange(date);
              setFilterDrawerVisible(false);
            }}
            format="YYYY-MM-DD"
            allowClear={false}
            className="w-full mb-3"
          />

          <Button
            block
            type="primary"
            icon={<InfoCircleOutlined />}
            onClick={() => {
              openInfoModal();
              setFilterDrawerVisible(false);
            }}
            className="mb-3"
          >
            指标说明
          </Button>

          <Button
            block
            type="primary"
            icon={<ApiOutlined />}
            onClick={() => {
              checkApiStatus();
              setFilterDrawerVisible(false);
            }}
            danger={!apiStatus.ok}
          >
            API状态
          </Button>
        </div>
      </Drawer>

      {/* Modals remain the same */}
      <Modal
        title="指标说明"
        open={infoModalVisible}
        onCancel={() => setInfoModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setInfoModalVisible(false)}>
            关闭
          </Button>
        ]}
        width={isMobile ? '95%' : 700}
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

          <div>
            <Title level={5}>流动性概况 (Liquidity Overview)</Title>
            <Text>流动性概况展示了主要加密货币资金流入流出情况，包括BTC、ETH和SOL的资金变化以及总市场资金变化。正值表示资金流入，负值表示资金流出，单位为亿美元。</Text>
          </div>
        </div>
      </Modal>

      {/* API status modal */}
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
        width={isMobile ? '95%' : 'auto'}
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
          <Text>API基础URL: {window.runtimeConfig?.API_BASE_URL || process.env.REACT_APP_API_URL || 'http://localhost:3001/api'}</Text>

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

      {/* User profile and password modals */}
      <UserProfile
        visible={profileModalVisible}
        onClose={() => setProfileModalVisible(false)}
      />

      <ChangePassword
        visible={passwordModalVisible}
        onClose={() => setPasswordModalVisible(false)}
      />
    </Layout>
  );
}

export default Dashboard;