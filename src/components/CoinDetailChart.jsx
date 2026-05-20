// src/components/CoinDetailChart.jsx - 确保与卡片数据一致
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Area, ResponsiveContainer,
  ReferenceArea, ReferenceLine, Legend, ComposedChart, Bar, Cell
} from 'recharts';
import { Card, Button, Typography, Row, Col, Statistic, Spin, Select, Alert, Empty, Radio, Tag, Tooltip as AntTooltip, DatePicker } from 'antd';
import {
  ZoomInOutlined,
  ZoomOutOutlined,
  UndoOutlined,
  ReloadOutlined,
  InfoCircleOutlined,
  LineChartOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { fetchCoinMetrics, fetchLiquidityHistory } from '../services/api';
import { getPeriodQualityMeta } from '../utils/periodQualityMeta';
import { buildPeriodQualityMarkers } from '../utils/periodQualityMarkers';
import {
  formatMetricAxisTick,
  formatMetricDisplayTime,
  getMetricSortTime,
  getMetricTimeKey,
} from '../utils/timeDisplay';

const { Title, Text } = Typography;
const { Option } = Select;
const { RangePicker } = DatePicker;
const chartSyncId = 'coin-detail-date-sync';
const liquiditySeriesMeta = {
  BTC: { key: 'btc', label: 'Bitcoin' },
  ETH: { key: 'eth', label: 'Ethereum' },
  SOL: { key: 'sol', label: 'Solana' }
};
const getLiquidityBarColor = (value) => {
  if (value > 0) return '#16a34a';
  if (value < 0) return '#dc2626';
  return '#94a3b8';
};

function CoinDetailChart({ coin, onRefresh, selectedDate }) {
  console.log('[CoinDetailChart] Component rendered with props:', {
    coinSymbol: coin?.symbol,
    selectedDate: selectedDate ? selectedDate.format('YYYY-MM-DD') : 'null'
  });
  const [metrics, setMetrics] = useState([]);
  const [liquidityHistory, setLiquidityHistory] = useState([]);
  const [liquidityLoading, setLiquidityLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [timeRange, setTimeRange] = useState('1M'); // 默认显示1个月
  const [customDateRange, setCustomDateRange] = useState(null);
  const [zoomState, setZoomState] = useState(null);
  const [displayData, setDisplayData] = useState([]);
  const [chartMode, setChartMode] = useState('both'); // 'blast', 'otc', 'both'
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const chartRef = useRef(null);
  const fallbackEndDate = selectedDate || dayjs();

  const presetStartDate = useMemo(() => {
    switch(timeRange) {
      case '1W':
        return fallbackEndDate.subtract(7, 'day');
      case '1M':
        return fallbackEndDate.subtract(30, 'day');
      case '3M':
        return fallbackEndDate.subtract(90, 'day');
      case '6M':
        return fallbackEndDate.subtract(180, 'day');
      case '1Y':
        return fallbackEndDate.subtract(365, 'day');
      case 'ALL':
        return dayjs('2023-01-01');
      default:
        return fallbackEndDate.subtract(30, 'day');
    }
  }, [timeRange, fallbackEndDate]);

  const effectiveStartDateStr = (customDateRange?.[0] || presetStartDate).format('YYYY-MM-DD');
  const effectiveEndDateStr = (customDateRange?.[1] || fallbackEndDate).format('YYYY-MM-DD');
  const chartMargin = isMobile ?
    { top: 28, right: 10, left: 10, bottom: 20 } :
    { top: 30, right: 30, left: 20, bottom: 30 };
  const selectedLiquiditySeries = liquiditySeriesMeta[coin?.symbol?.toUpperCase()];
  const periodQualityMarkers = useMemo(
    () => buildPeriodQualityMarkers(displayData),
    [displayData]
  );
  const renderPeriodQualityMarkerLabel = useCallback(({ viewBox, marker }) => {
    const x = Number(viewBox?.x);
    const y = Number(viewBox?.y);
    const width = Number(viewBox?.width);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    const edgePadding = isMobile ? 44 : 60;
    let dx = 0;
    let textAnchor = 'middle';
    if (x < edgePadding) {
      dx = 8;
      textAnchor = 'start';
    } else if (Number.isFinite(width) && x > width - edgePadding) {
      dx = -8;
      textAnchor = 'end';
    }

    return (
      <text
        x={x + dx}
        y={y + (isMobile ? 14 : 16)}
        fill={marker.color}
        fontSize={isMobile ? 10 : 12}
        fontWeight={600}
        textAnchor={textAnchor}
      >
        {marker.label}
      </text>
    );
  }, [isMobile]);

  // 监听窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  // 重置图表缩放
  const handleReset = () => {
    setDisplayData(metrics);
  };
  
  // 处理缩放开始
  const handleMouseDown = (e) => {
    if (!e) return;
    setZoomState({
      x1: e.activeLabel,
      x2: e.activeLabel
    });
  };
  
  // 处理缩放进行中
  const handleMouseMove = (e) => {
    if (!zoomState || !e) return;
    setZoomState({
      ...zoomState,
      x2: e.activeLabel
    });
  };
  
  // 处理缩放结束
  const handleMouseUp = () => {
    if (!zoomState) return;
    
    // 确保 x1 <= x2 (日期排序)
    const { x1, x2 } = zoomState;
    
    // 如果选择区域太小，视为点击，忽略缩放
    if (x1 === x2) {
      setZoomState(null);
      return;
    }
    
    // 过滤数据以实现缩放
    const filteredData = metrics.filter(
      item => {
        const itemTime = item.sortTime;
        const point1 = metrics.find(metric => metric.timeKey === x1)?.sortTime || 0;
        const point2 = metrics.find(metric => metric.timeKey === x2)?.sortTime || 0;
        const [smaller, larger] = point1 <= point2 ? [point1, point2] : [point2, point1];
        return itemTime >= smaller && itemTime <= larger;
      }
    );
    
    setDisplayData(filteredData.length ? filteredData : metrics);
    setZoomState(null);
  };
  
  // 处理指标切换
  const handleChartModeChange = (mode) => {
    setChartMode(mode);
  };

  // Render period quality tag (similar to CoinCard and OtcIndexTable implementation)
  const renderQualityTag = () => {
    if (!coin?.period_quality) return null;

    const meta = getPeriodQualityMeta(coin.period_quality);

    return (
      <AntTooltip title={meta.description}>
        <Tag color={meta.tagColor} className="text-sm">
          周期质量: {coin.period_quality}
        </Tag>
      </AntTooltip>
    );
  };
  
  // 数据一致性：确保最新数据与传入的coin对象一致
  useEffect(() => {
    if (coin && metrics.length > 0) {
      const lastIndex = metrics.length - 1;
      
      // 创建一个新的数组，避免直接修改原数组
      const updatedMetrics = [...metrics];
      
      // 始终使用传入的coin对象的当前值来更新最近的日期的数据
      if (coin.explosionIndex !== undefined) {
        updatedMetrics[lastIndex].blastIndex = coin.explosionIndex;
      }
      if (coin.otcIndex !== undefined) {
        updatedMetrics[lastIndex].otcIndex = coin.otcIndex;
      }
      if (coin.schellingPoint !== undefined) {
        updatedMetrics[lastIndex].schellingPoint = coin.schellingPoint;
      }
      if (coin.period_quality !== undefined) {
        updatedMetrics[lastIndex].periodQuality = coin.period_quality;
      }
      
      // 更新状态
      setMetrics(updatedMetrics);
      
      // 如果当前显示的是原始数据的子集（缩放状态），也更新displayData
      if (displayData.length > 0 && displayData[displayData.length - 1].timeKey === updatedMetrics[lastIndex].timeKey) {
        const updatedDisplayData = [...displayData];
        updatedDisplayData[updatedDisplayData.length - 1] = updatedMetrics[lastIndex];
        setDisplayData(updatedDisplayData);
      } else {
        setDisplayData(updatedMetrics);
      }
    }
  }, [coin]);

  // 处理选中日期变化，过滤显示数据
  useEffect(() => {
    console.log('[CoinDetailChart] Date filter effect triggered:', {
      selectedDate: effectiveEndDateStr,
      metricsLength: metrics.length,
      coinSymbol: coin?.symbol
    });

    if (effectiveEndDateStr && metrics.length > 0) {
      const filteredMetrics = metrics.filter(metric => {
        return metric.date <= effectiveEndDateStr;
      });

      console.log('[CoinDetailChart] Filtered metrics:', {
        originalLength: metrics.length,
        filteredLength: filteredMetrics.length,
        selectedDate: effectiveEndDateStr,
        firstDate: metrics[0]?.date,
        lastDate: metrics[metrics.length - 1]?.date
      });

      if (filteredMetrics.length > 0) {
        setDisplayData(filteredMetrics);
      } else {
        // 如果没有数据在选中日期之前，显示所有数据
        console.log('[CoinDetailChart] No data before selected date, showing all data');
        setDisplayData(metrics);
      }
    } else {
      // 如果没有选中日期，显示所有数据
      console.log('[CoinDetailChart] No selected date or no metrics, showing all data');
      setDisplayData(metrics);
    }
  }, [effectiveEndDateStr, metrics]);

  // 加载币种历史指标数据
  useEffect(() => {
    const loadMetricsData = async () => {
      if (!coin || !coin.symbol) {
        setDisplayData([]);
        return;
      }
      
      setLoading(true);
      setError(null);
      
      try {
        // 计算日期范围 - 如果有选中日期，使用选中日期作为结束日期
        // 使用 dayjs 而不是 Date 对象来避免时区问题
        const endDateDayjs = dayjs(effectiveEndDateStr);
        const startDateDayjs = dayjs(effectiveStartDateStr);

        // 将日期转换为 YYYY-MM-DD 格式（避免时区问题）
        const formattedStartDate = startDateDayjs.format('YYYY-MM-DD');
        const formattedEndDate = endDateDayjs.format('YYYY-MM-DD');

        console.log(`[CoinDetailChart] 获取 ${coin.symbol} 从 ${formattedStartDate} 到 ${formattedEndDate} 的指标数据`, {
          selectedDate: effectiveEndDateStr,
          customDateRange: customDateRange
            ? customDateRange.map(date => date.format('YYYY-MM-DD'))
            : null,
          timeRange,
          endDateUsed: formattedEndDate
        });
        
        // 获取数据
        const data = await fetchCoinMetrics(coin.symbol, {
          startDate: formattedStartDate,
          endDate: formattedEndDate
        });
        
        if (!Array.isArray(data) || data.length === 0) {
          // 如果没有数据返回，创建一些模拟数据供显示
          console.log(`没有找到 ${coin.symbol} 的历史数据，创建模拟数据`);
          const mockData = createMockData(coin, startDateDayjs.toDate(), endDateDayjs.toDate());
          setMetrics(mockData);
          setDisplayData(mockData);
        } else {
        //  console.log(`获取到 ${data.length} 条历史指标数据`);
          
          // 处理数据 - 将API返回的格式转换为图表需要的格式
          const processedData = data.map((metric, index) => {
            const displayTime = formatMetricDisplayTime(metric);
            const timeKey = getMetricTimeKey(metric);
            const sortTime = getMetricSortTime(metric);

            // 如果是最后一条数据，使用传入的coin对象的当前值
            if (index === data.length - 1) {
              return {
                date: metric.date,
                displayTime,
                timeKey,
                sortTime,
                timestamp: metric.timestamp,
                timePrecision: metric.time_precision,
                blastIndex: coin.explosionIndex !== undefined ? coin.explosionIndex : metric.explosion_index || 0,
                otcIndex: coin.otcIndex !== undefined ? coin.otcIndex : metric.otc_index || 0,
                schellingPoint: coin.schellingPoint !== undefined ? coin.schellingPoint : metric.schelling_point || 0,
                actionType: coin.entryExitType || metric.entry_exit_type || 'neutral',
                actionDay: coin.entryExitDay !== undefined ? coin.entryExitDay : metric.entry_exit_day || 0,
                nearThreshold: coin.nearThreshold !== undefined ? coin.nearThreshold : metric.near_threshold || false,
                periodQuality: coin.period_quality || metric.period_quality || null,
              };
            }
            
            // 其他数据正常处理
            return {
              date: metric.date,
              displayTime,
              timeKey,
              sortTime,
              timestamp: metric.timestamp,
              timePrecision: metric.time_precision,
              blastIndex: metric.explosion_index || 0,
              otcIndex: metric.otc_index || 0,
              schellingPoint: metric.schelling_point || 0,
              actionType: metric.entry_exit_type === 'entry' ? '进场' : metric.entry_exit_type === 'exit' ? '退场' : '中性',
              actionDay: metric.entry_exit_day || 0,
              nearThreshold: metric.near_threshold || false,
              periodQuality: metric.period_quality || null,
            };
          });
          
          // 按发布时间排序
          processedData.sort((a, b) => a.sortTime - b.sortTime);
          
          setMetrics(processedData);
          setDisplayData(processedData);
        }
      } catch (error) {
        console.error('加载指标数据失败:', error);
        setError(`加载历史指标数据失败: ${error.message || '未知错误'}`);
        // 创建一些模拟数据供显示
        const mockData = createMockData(coin, 
          new Date(new Date().setDate(new Date().getDate() - 30)), 
          new Date());
        setMetrics(mockData);
        setDisplayData(mockData);
      } finally {
        setLoading(false);
      }
    };
    
    loadMetricsData();
  }, [coin?.symbol, timeRange, effectiveStartDateStr, effectiveEndDateStr]); // 在coin.symbol、timeRange或日期范围变化时重新加载

  useEffect(() => {
    const loadLiquidityHistory = async () => {
      setLiquidityLoading(true);
      try {
        const data = await fetchLiquidityHistory({
          startDate: effectiveStartDateStr,
          endDate: effectiveEndDateStr
        });
        setLiquidityHistory(data);
      } finally {
        setLiquidityLoading(false);
      }
    };

    loadLiquidityHistory();
  }, [effectiveStartDateStr, effectiveEndDateStr]);
  
  // 创建模拟数据函数 - 当API无法获取数据时使用
  const createMockData = (coin, startDate, endDate) => {
    const mockData = [];
    const dayCount = Math.floor((endDate - startDate) / (24 * 60 * 60 * 1000));
    
    // 直接使用传入的coin对象的当前值作为基准
    const baseExplosionIndex = coin.explosionIndex || 180;
    const baseOtcIndex = coin.otcIndex || 1200;
    const baseSchellingPoint = coin.schellingPoint || 1000;
    const entryExitType = coin.entryExitType === 'entry' ? '进场' : 
                          coin.entryExitType === 'exit' ? '退场' : '中性';
    const entryExitDay = coin.entryExitDay || 0;
    
    // 生成每天的数据
    for (let i = 0; i <= dayCount; i++) {
      const currentDate = new Date(startDate);
      currentDate.setDate(startDate.getDate() + i);
      const dateStr = currentDate.toISOString().split('T')[0];
      
      // 最后一天使用精确的传入值，确保一致性
      if (i === dayCount) {
        mockData.push({
          date: dateStr,
          displayTime: dateStr,
          timeKey: dateStr,
          sortTime: new Date(dateStr).getTime(),
          blastIndex: baseExplosionIndex,
          otcIndex: baseOtcIndex,
          schellingPoint: baseSchellingPoint,
          actionType: entryExitType,
          actionDay: entryExitDay,
          nearThreshold: coin.nearThreshold || false,
          periodQuality: coin.period_quality || null,
        });
        continue;
      }
      
      // 其他天生成合理的随机值
      const randomFactor = Math.sin(i / 10) * 20 + (Math.random() - 0.5) * 15;
      const explosionChange = i === 0 ? 0 : mockData[i-1].blastIndex - baseExplosionIndex + randomFactor;
      
      mockData.push({
        date: dateStr,
        displayTime: dateStr,
        timeKey: dateStr,
        sortTime: new Date(dateStr).getTime(),
        blastIndex: Math.max(100, Math.min(300, baseExplosionIndex + explosionChange * 0.2)),
        otcIndex: Math.max(500, Math.min(2000, baseOtcIndex + randomFactor * 5)),
        schellingPoint: Math.max(100, baseSchellingPoint * (1 + (randomFactor / 1000))),
        actionType: entryExitType,
        actionDay: entryExitType !== '中性' ? Math.max(0, entryExitDay - (dayCount - i)) : 0,
        nearThreshold: Math.random() > 0.8, // 模拟数据中随机生成nearThreshold
        periodQuality: coin.period_quality || null,
      });
    }
    
    return mockData;
  };
  
  // 获取Y轴域
  const getYAxisDomain = (dataKey) => {
    if (!displayData || displayData.length === 0) return [0, 100];
    
    const values = displayData.map(d => d[dataKey]).filter(v => v !== undefined && v !== null);
    if (values.length === 0) return [0, 100];
    
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = (max - min) * 0.1;
    
    return [
      Math.max(0, Math.floor(min - padding)), 
      Math.ceil(max + padding)
    ];
  };

  // 检查是否有有效的谢林点数据
  const hasSchellingData = () => {
    if (!displayData || displayData.length === 0) return false;
    const hasData = displayData.some(d => d.schellingPoint && d.schellingPoint > 0);
    //console.log('谢林点数据检查:', hasData, displayData.map(d => d.schellingPoint));
    return hasData;
  };

  const getAlignedLiquidityData = () => {
    const liquidityByTimeKey = new Map(
      liquidityHistory.map(item => [getMetricTimeKey(item), item])
    );
    const liquidityByDate = new Map(
      liquidityHistory.map(item => [item.date, item])
    );

    return displayData.map(item => {
      const liquidity = liquidityByTimeKey.get(item.timeKey) || liquidityByDate.get(item.date) || {};
      return {
        date: item.date,
        displayTime: item.displayTime,
        timeKey: item.timeKey,
        sortTime: item.sortTime,
        timePrecision: item.timePrecision,
        btc: liquidity.btc_fund_change ?? null,
        eth: liquidity.eth_fund_change ?? null,
        sol: liquidity.sol_fund_change ?? null
      };
    });
  };

  const liquidityChartData = getAlignedLiquidityData();
  const hasLiquidityChartData = selectedLiquiditySeries
    ? liquidityChartData.some(item => item[selectedLiquiditySeries.key] !== null)
    : false;

  const LiquidityTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;

    const visiblePayload = payload.filter(item => item.value !== null && item.value !== undefined);
    if (!visiblePayload.length) return null;

    return (
      <div className="bg-white p-3 border border-gray-200 shadow-lg rounded-md">
        <div className="text-gray-600 text-sm mb-2">{`时间: ${payload[0].payload.displayTime || label}`}</div>
        {visiblePayload.map(item => (
          <div key={item.dataKey} className="flex justify-between gap-4 text-sm">
            <span style={{ color: item.color }}>{item.name}</span>
            <span className="font-medium">{Number(item.value).toFixed(2)}亿</span>
          </div>
        ))}
      </div>
    );
  };
  
  // 自定义提示框
  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const schellingPointValue = Number(data.schellingPoint ?? 0);
      const isWarning = (data.blastIndex || 0) < 200;
      const qualityMeta = data.periodQuality ? getPeriodQualityMeta(data.periodQuality) : null;
      const actionInfo = data.actionType === '中性' ? 
        '中性期' : 
        `${data.actionType}期第${data.actionDay}天`;
      
      return (
        <div className="bg-white p-3 border border-gray-200 shadow-lg rounded-md">
          <div className="text-gray-600 text-sm mb-1">{`时间: ${data.displayTime || data.date}`}</div>

          {data.periodQuality && (
            <div className="mb-2">
              <Tag color={qualityMeta?.tagColor || 'default'}>{data.periodQuality}</Tag>
            </div>
          )}
          
          <div className={`text-sm font-bold p-1 mb-2 rounded text-center ${
            data.actionType === "进场" ? "bg-green-100 text-green-800" : 
            data.actionType === "退场" ? "bg-red-100 text-red-800" : 
            "bg-gray-100 text-gray-800"
          }`}>
            {actionInfo}
          </div>
          
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">爆破指数</span>
              <span className={`font-bold ${isWarning ? "text-red-600" : "text-green-600"}`}>
                {data.blastIndex}
              </span>
              {isWarning && (
                <span className="text-xs text-red-500">⚠️ 低于安全阈值(200)</span>
              )}
            </div>
            
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">场外指数</span>
              <span className="font-medium text-blue-600">
                {data.otcIndex}
              </span>
            </div>
          </div>
          
          <div className="mt-2 text-xs">
            <span className="text-purple-600 font-medium">谢林点: {schellingPointValue.toLocaleString()}</span>
          </div>
        </div>
      );
    }
    return null;
  };
  
  // 调试信息 - 展示数据一致性
  const renderDebugInfo = () => {
    if (!coin || !displayData.length) return null;
    
    const latestData = displayData[displayData.length - 1];
    const isConsistent = 
      latestData.blastIndex === coin.explosionIndex &&
      latestData.otcIndex === coin.otcIndex;
    
    if (!isConsistent) {
      // 数据不一致的调试信息（仅在开发环境显示）
      if (process.env.NODE_ENV === 'development') {
        console.warn('数据不一致检测:', {
          '图表爆破指数': latestData.blastIndex,
          '卡片爆破指数': coin.explosionIndex,
          '图表场外指数': latestData.otcIndex,
          '卡片场外指数': coin.otcIndex
        });
      }
    }
    
    return (
      <div className="text-xs text-gray-400 mt-1 mb-2">
        {isConsistent ? 
          '✓ 数据已同步' : 
          '⚠️ 警告: 数据不同步! 请刷新'}
      </div>
    );
  };
  
  return (
    <Card className="w-full mt-4 mb-4 overflow-hidden">
      {loading ? (
        <div className="flex flex-col items-center justify-center py-10">
          <Spin size="large" />
          <div className="mt-4">加载数据中...</div>
        </div>
      ) : error ? (
        <Alert
          message="加载图表数据失败"
          description={error}
          type="error"
          showIcon
          action={
            <Button size="small" type="primary" onClick={() => onRefresh?.()}>
              刷新数据
            </Button>
          }
        />
      ) : displayData.length === 0 ? (
        <Empty
          description="没有可用的历史数据"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap justify-between items-center">
            <div>
              <Title level={3} className="mb-0">
                {coin?.name || coin?.symbol} ({coin?.symbol})
                {coin?.entryExitType === 'entry' && (
                  <span className="ml-3 px-2 py-1 text-xs font-bold bg-green-100 text-green-800 rounded-full">
                    进场期第{coin.entryExitDay}天
                  </span>
                )}
                {coin?.entryExitType === 'exit' && (
                  <span className="ml-3 px-2 py-1 text-xs font-bold bg-red-100 text-red-800 rounded-full">
                    退场期第{coin.entryExitDay}天
                  </span>
                )}
              </Title>
              
              <div className="flex items-center mt-1">
                {coin && (
                  <Text className={`flex items-center ${
                    coin.explosionIndex < 200 ? 'text-red-600' : 'text-green-600'
                  } font-medium`}>
                    爆破指数: {coin.explosionIndex}
                    {coin.explosionIndex < 200 && (
                      <Text className="ml-2 text-amber-500">
                        ⚠️ 低于安全阈值(200)
                      </Text>
                    )}
                  </Text>
                )}
              </div>

              {/* Period quality display */}
              {coin?.period_quality && (
                <div className="flex items-center mt-2">
                  {renderQualityTag()}
                </div>
              )}
              
              {renderDebugInfo()}
            </div>
            
            <div className="flex flex-wrap items-center mt-2 sm:mt-0">
              <div className="flex p-2 rounded-lg bg-gray-100 space-x-2 mr-4 mb-2 sm:mb-0">
                <div className="flex items-center px-2 py-1 rounded bg-green-100 text-green-800 text-xs font-medium">
                  <span className="w-2 h-2 rounded-full bg-green-500 mr-1"></span>
                  进场期
                </div>
                <div className="flex items-center px-2 py-1 rounded bg-red-100 text-red-800 text-xs font-medium">
                  <span className="w-2 h-2 rounded-full bg-red-500 mr-1"></span>
                  退场期
                </div>
                <div className="flex items-center px-2 py-1 rounded bg-white text-green-700 text-xs font-medium">
                  <span className="w-2 h-4 rounded-sm bg-green-600 mr-1"></span>
                  高质量节点
                </div>
                <div className="flex items-center px-2 py-1 rounded bg-white text-red-700 text-xs font-medium">
                  <span className="w-2 h-4 rounded-sm bg-red-600 mr-1"></span>
                  低质量节点
                </div>
              </div>
              
              <Select 
                value={timeRange}
                style={{ width: 120 }} 
                onChange={value => {
                  setTimeRange(value);
                  setCustomDateRange(null);
                }}
              >
                <Option value="1W">1周</Option>
                <Option value="1M">1个月</Option>
                <Option value="3M">3个月</Option>
                <Option value="6M">6个月</Option>
                <Option value="1Y">1年</Option>
                <Option value="ALL">全部</Option>
              </Select>

              <RangePicker
                value={customDateRange}
                onChange={setCustomDateRange}
                format="YYYY-MM-DD"
                placeholder={['起始日期', '截止日期']}
                allowClear
                disabled={loading}
                style={{ width: isMobile ? '100%' : 260, marginLeft: isMobile ? 0 : 12, marginTop: isMobile ? 8 : 0 }}
              />
            </div>
          </div>
          
          {/* 指标选择与图表控制 */}
          <div className="mb-4 flex flex-wrap justify-between items-center bg-gray-50 p-3 rounded-lg">
            <div className="flex flex-wrap items-center gap-4 mb-2 sm:mb-0">
              <div className="font-medium flex items-center">
                <LineChartOutlined className="mr-1" />
                显示指标:
              </div>
              <Radio.Group 
                value={chartMode} 
                onChange={e => handleChartModeChange(e.target.value)}
                optionType="button"
                buttonStyle="solid"
              >
                <Radio.Button value="both">双指标对比</Radio.Button>
                <Radio.Button value="blast">爆破指数</Radio.Button>
                <Radio.Button value="otc">场外指数</Radio.Button>
              </Radio.Group>
            </div>
            
            <div className="flex flex-wrap gap-2">
              <Button 
                icon={<UndoOutlined />} 
                onClick={handleReset}
                size="small"
              >
                重置缩放
              </Button>
              <Button 
                icon={<ZoomInOutlined />} 
                size="small"
                onClick={() => {
                  if (!displayData.length) return;
                  // 缩小显示范围 (放大显示)
                  const mid = Math.floor(displayData.length / 2);
                  const quarter = Math.floor(displayData.length / 4);
                  setDisplayData(displayData.slice(mid - quarter, mid + quarter));
                }}
              >
                放大
              </Button>
              <Button 
                icon={<ZoomOutOutlined />} 
                size="small"
                onClick={() => {
                  // 重置到原始数据 (缩小显示)
                  setDisplayData(metrics);
                }}
              >
                缩小
              </Button>
              <Button
                icon={<ReloadOutlined />}
                size="small"
                onClick={() => {
                  // 刷新图表数据
                  if (onRefresh) onRefresh();
                }}
              >
                刷新数据
              </Button>
            </div>
          </div>
          
          {/* 爆破指数图表 */}
          <div style={{ height: isMobile ? '300px' : '400px', userSelect: 'none' }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={displayData}
                margin={chartMargin}
                syncId={chartSyncId}
                onMouseDown={handleMouseDown}
                onMouseMove={zoomState ? handleMouseMove : null}
                onMouseUp={zoomState ? handleMouseUp : null}
                ref={chartRef}
              >
                <defs>
                  <linearGradient id="colorBlast" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                  
                  <linearGradient id="colorOtc" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  
                  <pattern id="entrancePattern" patternUnits="userSpaceOnUse" width="10" height="10">
                    <rect width="10" height="10" fill="#dcfce7" />
                  </pattern>
                  
                  <pattern id="exitPattern" patternUnits="userSpaceOnUse" width="10" height="10">
                    <rect width="10" height="10" fill="#fee2e2" />
                  </pattern>

                  <pattern id="nearThresholdPattern" patternUnits="userSpaceOnUse" width="10" height="10">
                    <rect width="10" height="10" fill="#fef3c7" />
                  </pattern>

                  <linearGradient id="colorNearThreshold" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                
                <CartesianGrid strokeDasharray="3 3" />
                
                <XAxis
                  dataKey="timeKey"
                  tick={{ fontSize: isMobile ? 10 : 12 }}
                  tickMargin={isMobile ? 5 : 10}
                  interval={isMobile ? 'preserveStartEnd' : 'preserveStart'}
                  tickFormatter={(value) => {
                    const metric = displayData.find(item => item.timeKey === value);
                    return formatMetricAxisTick(metric || { date: value });
                  }}
                />
                
                {/* 爆破指数Y轴 - 只有在显示爆破指数时显示 */}
                {(chartMode === 'blast' || chartMode === 'both') && (
                  <YAxis
                    yAxisId="left"
                    domain={getYAxisDomain('blastIndex')}
                    label={isMobile ? undefined : {
                      value: '爆破指数',
                      angle: -90,
                      position: 'insideLeft',
                      offset: -5,
                      style: { fill: '#ef4444' }
                    }}
                    tick={{ fill: '#ef4444', fontSize: isMobile ? 10 : 12 }}
                    width={isMobile ? 35 : 60}
                  />
                )}
                
                {/* 场外指数Y轴 - 只有在显示场外指数时显示 */}
                {chartMode === 'otc' && (
                  <YAxis
                    yAxisId="left"
                    domain={getYAxisDomain('otcIndex')}
                    label={isMobile ? undefined : {
                      value: '场外指数',
                      angle: -90,
                      position: 'insideLeft',
                      offset: -5,
                      style: { fill: '#3b82f6' }
                    }}
                    tick={{ fill: '#3b82f6', fontSize: isMobile ? 10 : 12 }}
                    width={isMobile ? 35 : 60}
                  />
                )}
                
                {/* 双指标模式下的第二Y轴 */}
                {chartMode === 'both' && (
                  <YAxis 
                    yAxisId="right"
                    orientation="right"
                    domain={getYAxisDomain('otcIndex')}
                    label={{ 
                      value: '场外指数', 
                      angle: 90, 
                      position: 'insideRight',
                      offset: -5,
                      style: { fill: '#3b82f6' }
                    }}
                    tick={{ fill: '#3b82f6' }}
                  />
                )}
                
                {/* 谢林点独立Y轴 - 只在双指标模式下且有数据时显示 */}
                {chartMode === 'both' && hasSchellingData() && (
                  <YAxis 
                    yAxisId="schelling"
                    orientation="right"
                    domain={getYAxisDomain('schellingPoint')}
                    axisLine={false}
                    tickLine={false}
                    tick={false}
                    width={0}
                  />
                )}
                
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{
                    fontSize: isMobile ? '11px' : '12px',
                    paddingTop: isMobile ? '5px' : '10px'
                  }}
                  iconSize={isMobile ? 12 : 14}
                />
                
                {/* 进场期区域 */}
                <Area
                  type="monotone"
                  dataKey={(entry) => (entry.actionType === "进场" ? 350 : 0)}
                  stroke="none"
                  fill="url(#entrancePattern)"
                  fillOpacity={0.2}
                  activeDot={false}
                  name="进场期"
                  yAxisId={chartMode === 'otc' ? 'left' : 'left'}
                />
                
                {/* 退场期区域 */}
                <Area
                  type="monotone"
                  dataKey={(entry) => (entry.actionType === "退场" ? 350 : 0)}
                  stroke="none"
                  fill="url(#exitPattern)"
                  fillOpacity={0.2}
                  activeDot={false}
                  name="退场期"
                  yAxisId={chartMode === 'otc' ? 'left' : 'left'}
                />

                {/* 逼近阈值区域 - 黄色背景 */}
                <Area
                  type="monotone"
                  dataKey={(entry) => (entry.nearThreshold ? 350 : 0)}
                  stroke="none"
                  fill="url(#colorNearThreshold)"
                  fillOpacity={0.4}
                  activeDot={false}
                  name="逼近阈值"
                  yAxisId={chartMode === 'otc' ? 'left' : 'left'}
                />
                
                {/* 安全阈值线 - 只在显示爆破指数时显示 */}
                {(chartMode === 'blast' || chartMode === 'both') && (
                  <ReferenceLine
                    y={200}
                    yAxisId="left"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    label={{
                      value: '安全阈值(200)',
                      position: 'insideBottomRight',
                      fill: '#f59e0b'
                    }}
                  />
                )}

                {periodQualityMarkers.map(marker => (
                  <ReferenceLine
                    key={`quality-${marker.type}-${marker.timeKey}`}
                    x={marker.timeKey}
                    yAxisId="left"
                    stroke={marker.color}
                    strokeWidth={2}
                    strokeDasharray="4 4"
                    ifOverflow="extendDomain"
                    label={(props) => renderPeriodQualityMarkerLabel({ ...props, marker })}
                  />
                ))}
                
                {/* 爆破指数线 */}
                {(chartMode === 'blast' || chartMode === 'both') && (
                  <Area 
                    type="monotone" 
                    dataKey="blastIndex" 
                    stroke="#ef4444" 
                    fillOpacity={0.5} 
                    fill="url(#colorBlast)" 
                    strokeWidth={2.5}
                    activeDot={{ r: 8, stroke: "#ef4444", strokeWidth: 2, fill: "white" }}
                    animationDuration={1000}
                    name="爆破指数"
                    yAxisId="left"
                  />
                )}
                
                {/* 场外指数线 */}
                {chartMode === 'otc' && (
                  <Area 
                    type="monotone" 
                    dataKey="otcIndex" 
                    stroke="#3b82f6" 
                    fillOpacity={0.5} 
                    fill="url(#colorOtc)" 
                    strokeWidth={2.5}
                    activeDot={{ r: 8, stroke: "#3b82f6", strokeWidth: 2, fill: "white" }}
                    animationDuration={1000}
                    name="场外指数"
                    yAxisId="left"
                  />
                )}
                
                {/* 双指标模式下的场外指数线 */}
                {chartMode === 'both' && (
                  <Area 
                    type="monotone" 
                    dataKey="otcIndex" 
                    stroke="#3b82f6" 
                    fillOpacity={0.5} 
                    fill="url(#colorOtc)" 
                    strokeWidth={2.5}
                    activeDot={{ r: 8, stroke: "#3b82f6", strokeWidth: 2, fill: "white" }}
                    animationDuration={1000}
                    name="场外指数"
                    yAxisId="right"
                  />
                )}
                
                {/* 谢林点虚线 - 只在双指标模式下显示且有数据时显示 */}
                {chartMode === 'both' && hasSchellingData() && (
                  <Line 
                    type="monotone" 
                    dataKey="schellingPoint" 
                    stroke="#722ed1" 
                    strokeWidth={2}
                    strokeDasharray="8 4"
                    dot={false}
                    activeDot={{ r: 6, stroke: "#722ed1", strokeWidth: 2, fill: "white" }}
                    name="谢林点"
                    yAxisId="schelling"
                  />
                )}
                
                {/* 缩放选择区域 */}
                {zoomState && (
                  <ReferenceArea 
                    x1={zoomState.x1} 
                    x2={zoomState.x2} 
                    strokeOpacity={0.3}
                    fill="#8884d8"
                    fillOpacity={0.1}
                    yAxisId={chartMode === 'otc' ? 'left' : 'left'}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {selectedLiquiditySeries && (
          <div className="mt-4">
            <div className="flex justify-between items-center mb-2">
              <Title level={5} className="mb-0">流动性概况</Title>
              <Text type="secondary" className="text-xs">{selectedLiquiditySeries.label}，单位：亿美元</Text>
            </div>
            <div style={{ height: isMobile ? '220px' : '260px', userSelect: 'none' }}>
              {liquidityLoading ? (
                <div className="h-full flex items-center justify-center">
                  <Spin />
                </div>
              ) : hasLiquidityChartData ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={liquidityChartData}
                    margin={chartMargin}
                    syncId={chartSyncId}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="timeKey"
                      tick={{ fontSize: isMobile ? 10 : 12 }}
                      tickMargin={isMobile ? 5 : 10}
                      interval={isMobile ? 'preserveStartEnd' : 'preserveStart'}
                      tickFormatter={(value) => {
                        const item = liquidityChartData.find(point => point.timeKey === value);
                        return formatMetricAxisTick(item || { date: value });
                      }}
                    />
                    <YAxis
                      yAxisId="left"
                      tick={{ fontSize: isMobile ? 10 : 12 }}
                      width={isMobile ? 35 : 60}
                      label={isMobile ? undefined : {
                        value: '资金变化',
                        angle: -90,
                        position: 'insideLeft',
                        offset: -5,
                        style: { fill: '#475569' }
                      }}
                    />
                    {chartMode === 'both' && (
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        axisLine={false}
                        tickLine={false}
                        tick={false}
                      />
                    )}
                    <Tooltip content={<LiquidityTooltip />} />
                    <Legend
                      wrapperStyle={{
                        fontSize: isMobile ? '11px' : '12px',
                        paddingTop: isMobile ? '5px' : '10px'
                      }}
                      iconSize={isMobile ? 12 : 14}
                    />
                    <ReferenceLine y={0} yAxisId="left" stroke="#94a3b8" strokeDasharray="4 4" />
                    <Bar
                      dataKey={selectedLiquiditySeries.key}
                      name={selectedLiquiditySeries.label}
                      yAxisId="left"
                      radius={[3, 3, 0, 0]}
                    >
                      {liquidityChartData.map((entry) => (
                        <Cell
                          key={`liquidity-${entry.timeKey}`}
                          fill={getLiquidityBarColor(entry[selectedLiquiditySeries.key])}
                        />
                      ))}
                    </Bar>
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <Empty description="当前日期范围暂无流动性数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </div>
          </div>
          )}
          
          {/* 指标数据 */}
          {coin && (
            <Card className="mt-4" bodyStyle={{ padding: '16px 24px' }}>
              <Row gutter={[32, 16]} align="middle" justify="space-around">
                <Col xs={24} sm={12} md={8} className="text-center sm:text-left">
                  <Statistic 
                    title={
                      <div className="flex items-center justify-center sm:justify-start">
                        <span>场外指数</span>
                        <Tooltip title="反映场外交易活跃度的指标">
                          <InfoCircleOutlined className="ml-1 text-gray-400 cursor-help" />
                        </Tooltip>
                      </div>
                    }
                    value={coin.otcIndex} 
                    valueStyle={{ color: '#1677ff', fontSize: '22px' }} // Slightly smaller font
                  />
                </Col>
                <Col xs={24} sm={12} md={8} className="text-center sm:text-left">
                  <Statistic 
                    title={
                      <div className="flex items-center justify-center sm:justify-start">
                        <span>爆破指数</span>
                        <Tooltip title="值低于200表示市场风险较高">
                           <InfoCircleOutlined className="ml-1 text-gray-400 cursor-help" />
                        </Tooltip>
                      </div>
                    }
                    value={coin.explosionIndex}
                    valueStyle={{ 
                      color: coin.explosionIndex < 200 ? '#ff6b6b' : '#52c41a',
                      fontSize: '22px' // Slightly smaller font
                    }}
                    suffix={
                      coin.explosionIndex < 200 ? 
                      <Text type="danger" style={{fontSize: '14px', marginLeft: '4px'}}>风险</Text> : 
                      <Text type="success" style={{fontSize: '14px', marginLeft: '4px'}}>安全</Text>
                    }
                  />
                </Col>
                <Col xs={24} sm={24} md={8} className="text-center sm:text-left"> {/* Schelling point can take full width on small if needed */}
                  <Statistic 
                    title={
                      <div className="flex items-center justify-center sm:justify-start">
                        <span>谢林点</span>
                        <Tooltip title="市场共识价格水平">
                           <InfoCircleOutlined className="ml-1 text-gray-400 cursor-help" />
                        </Tooltip>
                      </div>
                    }
                    value={coin.schellingPoint}
                    valueStyle={{ color: '#722ed1', fontSize: '22px' }} // Slightly smaller font
                    formatter={(value) => { // Custom formatter for better readability
                        if (typeof value !== 'number') return '-';
                        if (value === 0 && coin.symbol !== "BTC" && coin.symbol !== "ETH") return '-'; // Show '-' for 0 for non-majors unless it's actually 0
                        if (value > 10000) return value.toLocaleString(undefined, {notation: 'compact', compactDisplay: 'short'});
                        if (value > 1000) return value.toLocaleString();
                        if (value > 100) return value.toFixed(1);
                        if (value > 10) return value.toFixed(2);
                        if (value >= 0) return value.toFixed(4); // For very small values
                        return '-';
                    }}
                  />
                </Col>
              </Row>
            </Card>
          )}
        </>
      )}
    </Card>
  );
}

export default CoinDetailChart;
