// src/components/Dashboard.jsx - Mobile-friendly version
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Layout, Tag, Divider, Alert, DatePicker, Space, Typography, Button, Modal, notification, Dropdown, Menu, Tooltip, Drawer, Progress } from 'antd';
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
  UserSwitchOutlined,
  RiseOutlined,
  FallOutlined,
  MenuOutlined,
  AppstoreOutlined,
  BugOutlined,
  CloudDownloadOutlined
} from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import SearchBar from './SearchBar';
import CoinList from './CoinList';
import CoinDetailChart from './CoinDetailChart';
import OtcIndexTable from './OtcIndexTable';
import BtcVolatilityPanel from './BtcVolatilityPanel';
import LiquidityChart from './LiquidityChart';
import LoadingPlaceholder from './LoadingPlaceholder';
import FavoriteDebug from './FavoriteDebug';
import {
  fetchLatestMetrics,
  fetchDataByDate,
  fetchAvailableDataDates,
  fetchKlineBackfillStatus,
  startKlineBackfill,
} from '../services/api'; // Keep this
import { logout } from '../redux/slices/authSlice';
import ChangePassword from './ChangePassword';
import UserProfile from './UserProfile';
import { useFavorites } from '../hooks/useFavorites'; // Keep this
import { PERIOD_QUALITY_GUIDE, PERIOD_QUALITY_METHOD } from '../utils/periodQualityMeta';
import { evaluateStrategySignal, hasStrategyDirection } from '../utils/strategySignals';
import {
  findNearestAvailableDate,
  isDateAvailable,
  normalizeAvailableDates,
} from '../utils/availableDates';


const { Header, Content } = Layout;
const { Title, Text } = Typography;

const getRiskRank = (risk) => {
  if (risk === 'low') return 0;
  if (risk === 'medium') return 1;
  return 2;
};

const getSignalSummaryText = (signals) => {
  if (signals.length === 0) return '暂无';

  return signals
    .slice(0, 3)
    .map(({ coin, signal }) => `${coin.symbol}(${signal.confirmed ? '已确认' : '候选'})`)
    .join('、');
};

const VIEW_MODES = [
  {
    key: 'all',
    label: '全部币种',
    icon: <DatabaseOutlined />,
  },
  {
    key: 'favorites',
    label: '收藏币种',
    icon: <StarOutlined />,
  },
  {
    key: 'popular',
    label: '热门币种',
    icon: <FireOutlined />,
  },
  {
    key: 'long',
    label: '做多策略',
    icon: <RiseOutlined />,
    tooltip: '场外指数连续3天大于1000且上升，或爆破负转正 / 进场期第一天',
  },
  {
    key: 'short',
    label: '做空策略',
    icon: <FallOutlined />,
    tooltip: '场外指数连续3天下降，或爆破跌破200叠加低质量进场 / 退场期第一天',
  },
];

const KLINE_BACKFILL_INTERVALS = ['15m', '1h', '4h', '1d'];
const KLINE_BACKFILL_INTERVAL_LABELS = {
  '15m': '15min',
  '1h': '1h',
  '4h': '4h',
  '1d': '日',
};

const KLINE_BACKFILL_DONE_STATUSES = new Set(['completed', 'completed_with_errors', 'failed']);

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
  const [error, setError] = useState(null);
  const [latestDateStr, setLatestDateStr] = useState('');
  const [latestAvailableDateStr, setLatestAvailableDateStr] = useState('');
  const [availableDates, setAvailableDates] = useState([]);
  const [availableDatesLoaded, setAvailableDatesLoaded] = useState(false);
  const [infoModalVisible, setInfoModalVisible] = useState(false);
  const [apiStatusModalVisible, setApiStatusModalVisible] = useState(false);
  const [apiStatus, setApiStatus] = useState({ ok: false, message: '正在检查API状态...' });
  const [viewMode, setViewMode] = useState('all'); // 'all', 'favorites', 'popular', 'long', 'short'
  const [liquidityData, setLiquidityData] = useState(null);
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [profileModalVisible, setProfileModalVisible] = useState(false);
  const [debugModalVisible, setDebugModalVisible] = useState(false);
  const [klineBackfillJob, setKlineBackfillJob] = useState(null);

  // Mobile-specific state
  const [menuDrawerVisible, setMenuDrawerVisible] = useState(false);
  const [filterDrawerVisible, setFilterDrawerVisible] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const notifiedStrategyDatesRef = useRef(new Set());
  const initialLoadCompleteRef = useRef(false);
  const activeDataRequestRef = useRef(0);
  const klineBackfillPollRef = useRef(null);

  // Authentication related
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { user } = useSelector(state => state.auth);

  const showStrategyNotification = useCallback((coins, liquidity, date) => {
    if (!date || !Array.isArray(coins) || coins.length === 0) return;
    if (notifiedStrategyDatesRef.current.has(date)) return;

    const signals = coins
      .map(coin => ({
        coin,
        signal: evaluateStrategySignal(coin, { marketCoins: coins, liquidity })
      }))
      .filter(item => item.signal.direction === 'long' || item.signal.direction === 'short')
      .sort((a, b) => {
        if (a.signal.confirmed !== b.signal.confirmed) return a.signal.confirmed ? -1 : 1;
        return getRiskRank(a.signal.risk) - getRiskRank(b.signal.risk);
      });

    const longSignals = signals.filter(item => item.signal.direction === 'long');
    const shortSignals = signals.filter(item => item.signal.direction === 'short');
    const confirmedLongCount = longSignals.filter(item => item.signal.confirmed).length;
    const confirmedShortCount = shortSignals.filter(item => item.signal.confirmed).length;

    notifiedStrategyDatesRef.current.add(date);

    notification.open({
      key: `strategy-${date}`,
      message: `策略信号更新 · ${date}`,
      description: (
        <div>
          <div className="mb-2">
            <Tag color="success">做多 {longSignals.length}</Tag>
            <Text type="secondary">已确认 {confirmedLongCount}：{getSignalSummaryText(longSignals)}</Text>
          </div>
          <div>
            <Tag color="error">做空 {shortSignals.length}</Tag>
            <Text type="secondary">已确认 {confirmedShortCount}：{getSignalSummaryText(shortSignals)}</Text>
          </div>
        </div>
      ),
      placement: 'topRight',
      duration: 10,
    });
  }, []);

  const refreshAvailableDates = useCallback(async () => {
    try {
      const result = await fetchAvailableDataDates();
      const normalizedDates = normalizeAvailableDates(result.dates);
      setAvailableDates(normalizedDates);
      setAvailableDatesLoaded(true);

      const newestDate = result.newestDate && normalizedDates.includes(result.newestDate)
        ? result.newestDate
        : normalizedDates[normalizedDates.length - 1] || '';

      if (newestDate) {
        setLatestAvailableDateStr(newestDate);
      }

      return normalizedDates;
    } catch (error) {
      console.error('加载可用日期失败:', error);
      setAvailableDates([]);
      setAvailableDatesLoaded(true);
      return [];
    }
  }, []);

  const disabledCalendarDate = useCallback((date) => {
    if (!date) return true;
    if (!availableDatesLoaded) return true;
    return !isDateAvailable(date, availableDates);
  }, [availableDates, availableDatesLoaded]);

  // Window resize handler for responsive design
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Load data
  const loadData = useCallback(async (forceRefresh = false) => {
    const requestId = activeDataRequestRef.current + 1;
    activeDataRequestRef.current = requestId;
    setLoading(true);
    setError(null);

    try {
      console.log('[Dashboard] Loading data, forceRefresh:', forceRefresh);
      const result = await fetchLatestMetrics(forceRefresh); // This already contains previousDayData
      // console.log("[DASHBOARD - fetchLatestMetrics result]", JSON.stringify(result, null, 2));

      if (activeDataRequestRef.current !== requestId) return;

      if (result && result.coins) { // Check if result and result.coins are valid
        // No need for an additional formatCoinsData if fetchLatestMetrics already prepares the data well
        setAllCoins(result.coins); // Directly use coins from fetchLatestMetrics

        setSelectedCoin(currentSelectedCoin => {
          if (currentSelectedCoin && result.coins.some(coin => coin.symbol === currentSelectedCoin)) {
            return currentSelectedCoin;
          }

          const btcCoin = result.coins.find(c => c.symbol === 'BTC');
          return btcCoin ? btcCoin.symbol : result.coins[0]?.symbol || null;
        });

        if (result.date) {
          console.log('[Dashboard] Setting date from API:', result.date);
          setLatestDateStr(result.date);
          setLatestAvailableDateStr(result.date);
          setSelectedDate(dayjs(result.date));
          console.log('[Dashboard] Selected date set to:', dayjs(result.date).format('YYYY-MM-DD'));
        }

        if (result.liquidity) {
          setLiquidityData(result.liquidity);
        }

        setApiStatus({ ok: true, message: '数据加载成功，API连接正常' });
        showStrategyNotification(result.coins, result.liquidity, result.date);
        refreshAvailableDates();

        if (!initialLoadCompleteRef.current) {
          notification.success({
            message: '数据加载成功',
            description: `已获取最新的加密货币指标数据 (${result.date || '未知日期'})`,
            duration: 3
          });
          initialLoadCompleteRef.current = true;
        }
      } else {
        // Handle case where result or result.coins is not as expected
        console.warn("loadData: fetchLatestMetrics did not return expected data structure.", result);
        setAllCoins([]); // Set to empty array to avoid errors in child components
        setError("获取到的数据格式不正确");
      }
    } catch (err) {
      if (activeDataRequestRef.current !== requestId) return;
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
      if (activeDataRequestRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [showStrategyNotification, refreshAvailableDates]); // Removed formatCoinsData from dependencies as it's defined inside or constant

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
        return currentAllCoins.filter(coin => hasStrategyDirection(coin, 'long', {
          marketCoins: currentAllCoins,
          liquidity: liquidityData
        }));

      case 'short': // Short strategy
        return currentAllCoins.filter(coin => hasStrategyDirection(coin, 'short', {
          marketCoins: currentAllCoins,
          liquidity: liquidityData
        }));

      default:
        return currentAllCoins;
    }
  };

  // Load data on mount
  useEffect(() => {
    refreshAvailableDates();
    loadData();

    const refreshInterval = setInterval(() => {
      loadData();
    }, 5 * 60 * 1000);

    return () => clearInterval(refreshInterval);
  }, [loadData, refreshAvailableDates]); // loadData is now stable due to useCallback

  const applyHistoricalData = (selectedDateStr, historicalData) => {
    if (!historicalData || !historicalData.success) {
      throw new Error(historicalData?.error || '获取历史数据失败');
    }

    const historicalCoins = historicalData.coins || [];
    const btcCoin = historicalCoins.find(c => c.symbol === 'BTC');

    setAllCoins(historicalCoins);
    setLatestDateStr(selectedDateStr);
    setLiquidityData(historicalData.liquidityOverview || historicalData.liquidity || null);
    setViewMode('all');
    setSelectedCoin(btcCoin ? btcCoin.symbol : historicalCoins[0]?.symbol || null);

    notification.success({
      message: '历史数据加载成功',
      description: `已获取 ${selectedDateStr} 的数据，包含 ${historicalData.totalCoins || 0} 个币种`,
      duration: 3
    });

    setApiStatus({ ok: true, message: `历史数据加载成功 (${selectedDateStr})` });
  };

  const loadHistoricalDate = async (dateStr, requestId) => {
    console.log(`加载 ${dateStr} 的历史数据...`);
    const historicalData = await fetchDataByDate(dateStr);
    if (activeDataRequestRef.current !== requestId) return false;
    applyHistoricalData(dateStr, historicalData);
    return true;
  };

  const resolveSelectableDate = (date) => {
    if (!date) return;

    let selectedDateStr = date.format('YYYY-MM-DD');
    let nextDate = date;

    if (availableDates.length > 0 && !isDateAvailable(date, availableDates)) {
      const fallbackDateStr = findNearestAvailableDate(selectedDateStr, availableDates);
      if (!fallbackDateStr) return;

      selectedDateStr = fallbackDateStr;
      nextDate = dayjs(fallbackDateStr);
      notification.info({
        message: '已回退到最近有数据日期',
        description: `所选日期暂无数据，已切换到 ${fallbackDateStr}`,
        duration: 3
      });
    }

    return { selectedDateStr, nextDate };
  };

  // Handle date change
  const handleDateChange = async (date) => {
    const resolvedDate = resolveSelectableDate(date);
    if (!resolvedDate) return;

    const { selectedDateStr, nextDate } = resolvedDate;
    const requestId = activeDataRequestRef.current + 1;
    activeDataRequestRef.current = requestId;

    setSelectedDate(nextDate);

    if (latestAvailableDateStr && selectedDateStr === latestAvailableDateStr) {
      loadData(true);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await loadHistoricalDate(selectedDateStr, requestId);
    } catch (error) {
      if (activeDataRequestRef.current !== requestId) return;
      console.error('加载历史数据失败:', error);
      const fallbackDateStr = findNearestAvailableDate(
        selectedDateStr,
        availableDates.filter(availableDate => availableDate !== selectedDateStr)
      );

      if (fallbackDateStr) {
        try {
          setSelectedDate(dayjs(fallbackDateStr));
          const fallbackApplied = await loadHistoricalDate(fallbackDateStr, requestId);
          if (!fallbackApplied) return;
          notification.info({
            message: '已回退到最近有数据日期',
            description: `${selectedDateStr} 加载失败，已切换到 ${fallbackDateStr}`,
            duration: 3
          });
          return;
        } catch (fallbackError) {
          console.error('回退日期加载失败:', fallbackError);
        }
      }

      if (activeDataRequestRef.current !== requestId) return;
      setError(`加载 ${selectedDateStr} 的数据失败: ${error.message}`);
      setApiStatus({ ok: false, message: `加载历史数据失败: ${error.message}` });

      notification.error({
        message: '历史数据加载失败',
        description: `无法获取 ${selectedDateStr} 的数据: ${error.message}`,
        duration: 5
      });
    } finally {
      if (activeDataRequestRef.current === requestId) {
        setLoading(false);
      }
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
    console.log('[Dashboard] Force refreshing all data...');
    loadData(true); // 强制刷新，绕过缓存
    refreshFavorites();
  };

  const stopKlineBackfillPolling = useCallback(() => {
    if (klineBackfillPollRef.current) {
      clearInterval(klineBackfillPollRef.current);
      klineBackfillPollRef.current = null;
    }
  }, []);

  const refreshKlineBackfillStatus = useCallback(async () => {
    try {
      const result = await fetchKlineBackfillStatus();
      const job = result?.job || null;
      setKlineBackfillJob(job);

      if (job && KLINE_BACKFILL_DONE_STATUSES.has(job.status)) {
        stopKlineBackfillPolling();
        if (job.status === 'completed') {
          notification.success({
            message: 'K线回补完成',
            description: `已保存 ${job.saved || 0} 根K线，处理 ${job.completedCoins || 0} 个币种周期`,
            duration: 4,
          });
        } else if (job.status === 'completed_with_errors') {
          notification.warning({
            message: 'K线回补完成，有部分失败',
            description: `成功 ${job.completedCoins || 0} 个币种周期，失败 ${job.failedCoins || 0} 个`,
            duration: 6,
          });
        } else {
          notification.error({
            message: 'K线回补失败',
            description: job.error || '后台任务异常',
            duration: 6,
          });
        }
      }
    } catch (error) {
      stopKlineBackfillPolling();
      notification.error({
        message: '回补进度获取失败',
        description: error.message || '无法读取后台任务状态',
        duration: 5,
      });
    }
  }, [stopKlineBackfillPolling]);

  const startKlineBackfillPolling = useCallback(() => {
    stopKlineBackfillPolling();
    refreshKlineBackfillStatus();
    klineBackfillPollRef.current = setInterval(refreshKlineBackfillStatus, 2000);
  }, [refreshKlineBackfillStatus, stopKlineBackfillPolling]);

  const handleStartKlineBackfill = useCallback(async () => {
    try {
      const result = await startKlineBackfill({
        intervals: KLINE_BACKFILL_INTERVALS,
        delayMs: 5000,
        limit: 1500,
        maxChunksPerCoin: 40,
      });
      setKlineBackfillJob(result?.job || null);
      notification.info({
        message: result?.reused ? 'K线回补正在运行' : 'K线回补已启动',
        description: '后台会慢速顺序回补，进度会自动更新',
        duration: 4,
      });
      startKlineBackfillPolling();
    } catch (error) {
      notification.error({
        message: 'K线回补启动失败',
        description: error.message || '请检查后端服务',
        duration: 5,
      });
    }
  }, [startKlineBackfillPolling]);

  useEffect(() => () => {
    stopKlineBackfillPolling();
  }, [stopKlineBackfillPolling]);

  const handleBackToLatest = () => {
    loadData(true);
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
    // 仅在开发环境显示调试选项
    ...(process.env.NODE_ENV === 'development' ? [{
      key: 'debug',
      icon: <BugOutlined />,
      label: '收藏调试',
      onClick: () => setDebugModalVisible(true)
    }] : []),
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

  const filteredCoins = getFilteredCoins();
  const marketCoins = useMemo(() => Array.isArray(allCoins) ? allCoins : [], [allCoins]);
  const selectedDateStr = selectedDate ? selectedDate.format('YYYY-MM-DD') : '';
  const isViewingLatest = latestAvailableDateStr
    ? latestDateStr === latestAvailableDateStr
    : Boolean(latestDateStr && selectedDateStr === latestDateStr);
  const activeView = VIEW_MODES.find(mode => mode.key === viewMode) || VIEW_MODES[0];
  const signalCounts = useMemo(() => ({
    long: marketCoins.filter(coin => hasStrategyDirection(coin, 'long', {
      marketCoins,
      liquidity: liquidityData
    })).length,
    short: marketCoins.filter(coin => hasStrategyDirection(coin, 'short', {
      marketCoins,
      liquidity: liquidityData
    })).length,
  }), [marketCoins, liquidityData]);
  const dashboardMetrics = [
    { label: '跟踪币种', value: marketCoins.length, hint: `当前显示 ${filteredCoins.length}` },
    { label: '做多信号', value: signalCounts.long, hint: '策略候选' },
    { label: '做空信号', value: signalCounts.short, hint: '风险候选' },
    { label: '收藏币种', value: favorites.length, hint: user?.username || '当前账户' },
  ];
  const klineBackfillRunning = klineBackfillJob
    ? ['queued', 'running'].includes(klineBackfillJob.status)
    : false;
  const klineBackfillProgress = klineBackfillJob?.progress || 0;
  const klineBackfillLatestLog = Array.isArray(klineBackfillJob?.logs)
    ? klineBackfillJob.logs[klineBackfillJob.logs.length - 1]?.message
    : '';
  const klineBackfillProgressStatus = ['failed', 'completed_with_errors'].includes(klineBackfillJob?.status)
    ? 'exception'
    : (klineBackfillJob?.status === 'completed' ? 'success' : 'active');
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
    <Layout className="dashboard-shell">
      <Header className="dashboard-topbar">
        <div className="dashboard-brand">
          {isMobile && (
            <Button
              type="text"
              icon={<MenuOutlined />}
              onClick={() => setMenuDrawerVisible(true)}
              className="text-white mr-2"
            />
          )}
          <div>
            <div className="dashboard-brand__title">加密指标</div>
            <div className="dashboard-brand__meta">
              <span className="dashboard-status-dot" />
              <span>{apiStatus.ok ? '数据服务在线' : '等待 API 检查'}</span>
            </div>
          </div>
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
                {!isViewingLatest
                  ? `历史数据: ${latestDateStr}`
                  : `最新数据: ${latestDateStr}`}
              </Text>
            )}
            <DatePicker
              value={selectedDate}
              onChange={handleDateChange}
              disabledDate={disabledCalendarDate}
              format="YYYY-MM-DD"
              allowClear={false}
              className="mr-2"
              placeholder="选择历史日期"
              disabled={loading || !availableDatesLoaded}
            />
            {!isViewingLatest && (
              <Button onClick={handleBackToLatest} disabled={loading}>
                回到最新
              </Button>
            )}
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              onClick={handleRefresh}
              loading={loading}
              className="dashboard-action"
            >
              刷新
            </Button>
            <Button
              icon={<InfoCircleOutlined />}
              onClick={openInfoModal}
              className="dashboard-action"
            >
              指标说明
            </Button>
            <Button
              icon={<ApiOutlined />}
              onClick={checkApiStatus}
              danger={!apiStatus.ok}
              className="dashboard-action"
            >
              API状态
            </Button>

            {/* User dropdown menu */}
            <Dropdown overlay={userMenu} trigger={['click']}>
              <Button
                icon={<UserOutlined />}
                type="primary"
                className="dashboard-action"
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

      <Content className="dashboard-content">
        <section className="dashboard-overview-strip">
          <div className="dashboard-overview-strip__left">
            <span className="dashboard-overview-pill is-active">{activeView.label}</span>
            <span className="dashboard-overview-pill">日期 {latestDateStr || '加载中'}</span>
            {dashboardMetrics.map(metric => (
              <span className="dashboard-overview-pill" key={metric.label}>
                {metric.label} <strong>{metric.value}</strong>
              </span>
            ))}
          </div>
          <BtcVolatilityPanel />
        </section>

        <section className="dashboard-kline-backfill">
          <div className="dashboard-kline-backfill__controls">
            <Space wrap align="center">
              <Text strong>K线回补</Text>
              <Button
                icon={<CloudDownloadOutlined />}
                onClick={handleStartKlineBackfill}
                loading={klineBackfillRunning}
              >
                一键回补全部周期
              </Button>
              {klineBackfillJob && (
                <Text type="secondary">
                  {klineBackfillJob.status} · {klineBackfillJob.completedChunks || 0}/{klineBackfillJob.totalChunks || 0} 段 · 保存 {klineBackfillJob.saved || 0} 根
                </Text>
              )}
            </Space>
          </div>
          {klineBackfillJob && (
            <div className="dashboard-kline-backfill__progress">
              <Progress
                percent={klineBackfillProgress}
                size="small"
                status={klineBackfillProgressStatus}
              />
              <Text type="secondary">
                当前：{KLINE_BACKFILL_INTERVAL_LABELS[klineBackfillJob.currentInterval] || klineBackfillJob.currentInterval || '等待'} · {klineBackfillJob.currentCoin || '等待'} {klineBackfillJob.currentChunk || ''}
                {klineBackfillLatestLog ? ` · ${klineBackfillLatestLog}` : ''}
              </Text>
            </div>
          )}
        </section>

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
          <div className="dashboard-filterbar">
            {VIEW_MODES.map(mode => {
              const button = (
                <Button
                  key={mode.key}
                  type={viewMode === mode.key ? 'primary' : 'default'}
                  icon={mode.icon}
                  onClick={() => handleViewModeChange(mode.key)}
                >
                  {mode.label}
                </Button>
              );

              return mode.tooltip ? (
                <Tooltip key={mode.key} title={mode.tooltip}>
                  {button}
                </Tooltip>
              ) : button;
            })}
            <Text type="secondary" className="dashboard-refresh-spacer">
              {filteredCoins.length} / {marketCoins.length} 个币种
            </Text>
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
                selectedDate={selectedDate}
                useLatestKlineWindow={isViewingLatest}
              />
            ) : (
              !loading && ( // Only show placeholder if not loading and no coin selected
                <div className={`text-center ${isMobile ? 'py-6' : 'py-10'} bg-white rounded-lg shadow mb-4`}>
                  <SearchOutlined style={{ fontSize: isMobile ? 24 : 32 }} className="text-gray-400 mb-4" />
                  <Title level={isMobile ? 5 : 4}>请选择一个币种查看详情</Title>
                  <Text className="text-gray-500">
                    {isMobile ? '点击币种卡片查看图表' : '点击上方的币种卡片查看详细图表和指标数据'}
                  </Text>
                </div>
              )
            )}

            {/* Liquidity chart */}
            <LiquidityChart
              liquidity={liquidityData}
              loading={loading && !liquidityData} // Show loading if liquidity data is not yet available
            />

            {/* OTC index table */}
            <OtcIndexTable
              coins={filteredCoins}
              marketCoins={allCoins}
              liquidity={liquidityData}
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
          {latestDateStr && (
            <Text type="secondary" className="block mb-2">
              当前数据: {latestDateStr}
            </Text>
          )}
          <DatePicker
            value={selectedDate}
            onChange={(date) => {
              handleDateChange(date);
              setFilterDrawerVisible(false);
            }}
            disabledDate={disabledCalendarDate}
            format="YYYY-MM-DD"
            allowClear={false}
            className="w-full mb-3"
            placeholder="选择历史日期"
            disabled={loading || !availableDatesLoaded}
          />

          {!isViewingLatest && (
            <Button
              block
              onClick={() => {
                handleBackToLatest();
                setFilterDrawerVisible(false);
              }}
              disabled={loading}
              className="mb-3"
            >
              回到最新
            </Button>
          )}

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
            <Title level={5}>{PERIOD_QUALITY_METHOD.title}</Title>
            <Text>{PERIOD_QUALITY_METHOD.intro}</Text>
            <div className="mt-2 space-y-2">
              {PERIOD_QUALITY_METHOD.rules.map((rule) => (
                <Text key={rule} className="block">
                  • {rule}
                </Text>
              ))}
            </div>
            <div className={`mt-3 grid gap-3 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
              {PERIOD_QUALITY_GUIDE.map((item) => (
                <div key={item.key} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <Tag color={item.color} className="mb-2">
                    {item.label}
                  </Tag>
                  <Text className="block text-sm text-gray-600">
                    {item.description}
                  </Text>
                </div>
              ))}
            </div>
          </div>

          <div>
            <Title level={5}>策略筛选功能</Title>
            <Text className="block font-medium">做多策略：</Text>
            <Text>筛选出两类币种：场外指数连续3天大于1000且上升；爆破指数负转正或进场期第一天。</Text>

            <Text className="block font-medium mt-2">做空策略：</Text>
            <Text>筛选出两类币种：场外指数连续3天下降；爆破指数跌破200且处于低质量进场，或退场期第一天。</Text>
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

      {/* Debug modal - only in development */}
      {process.env.NODE_ENV === 'development' && (
        <Modal
          title="收藏功能调试"
          open={debugModalVisible}
          onCancel={() => setDebugModalVisible(false)}
          footer={null}
          width={900}
        >
          <FavoriteDebug />
        </Modal>
      )}
    </Layout>
  );
}

export default Dashboard;
