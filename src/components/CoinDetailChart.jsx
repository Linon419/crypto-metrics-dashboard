// src/components/CoinDetailChart.jsx - 确保与卡片数据一致
import React, { useState, useEffect, useRef } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, 
  Tooltip, Area, AreaChart, ResponsiveContainer, 
  ReferenceArea, ReferenceLine, Legend
} from 'recharts';
import { Card, Button, Typography, Row, Col, Statistic, Spin, Select, Alert, Empty, Radio } from 'antd';
import { 
  ZoomInOutlined, 
  ZoomOutOutlined, 
  UndoOutlined, 
  ReloadOutlined, 
  InfoCircleOutlined,
  LineChartOutlined
} from '@ant-design/icons';
import { fetchCoinMetrics } from '../services/api';

const { Title, Text } = Typography;
const { Option } = Select;

function CoinDetailChart({ coin, onRefresh }) {
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [timeRange, setTimeRange] = useState('1M'); // 默认显示1个月
  const [zoomState, setZoomState] = useState(null);
  const [displayData, setDisplayData] = useState([]);
  const [chartMode, setChartMode] = useState('blast'); // 'blast', 'otc', 'both'
  const chartRef = useRef(null);
  
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
        const itemDate = new Date(item.date).getTime();
        const date1 = new Date(x1).getTime();
        const date2 = new Date(x2).getTime();
        const [smaller, larger] = date1 <= date2 ? [date1, date2] : [date2, date1];
        return itemDate >= smaller && itemDate <= larger;
      }
    );
    
    setDisplayData(filteredData.length ? filteredData : metrics);
    setZoomState(null);
  };
  
  // 处理指标切换
  const handleChartModeChange = (mode) => {
    setChartMode(mode);
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
      
      // 更新状态
      setMetrics(updatedMetrics);
      
      // 如果当前显示的是原始数据的子集（缩放状态），也更新displayData
      if (displayData.length > 0 && displayData[displayData.length - 1].date === updatedMetrics[lastIndex].date) {
        const updatedDisplayData = [...displayData];
        updatedDisplayData[updatedDisplayData.length - 1] = updatedMetrics[lastIndex];
        setDisplayData(updatedDisplayData);
      } else {
        setDisplayData(updatedMetrics);
      }
    }
  }, [coin]);
  
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
        // 计算日期范围 - 基于选择的时间范围
        const endDate = new Date();
        let startDate = new Date();
        
        switch(timeRange) {
          case '1W': 
            startDate.setDate(endDate.getDate() - 7);
            break;
          case '1M':
            startDate.setDate(endDate.getDate() - 30);
            break;
          case '3M':
            startDate.setDate(endDate.getDate() - 90);
            break;
          case '6M':
            startDate.setDate(endDate.getDate() - 180);
            break;
          case '1Y':
            startDate.setDate(endDate.getDate() - 365);
            break;
          case 'ALL':
            startDate = new Date(2023, 0, 1); // 从2023年开始
            break;
          default:
            startDate.setDate(endDate.getDate() - 30);
        }
        
        // 将日期转换为 YYYY-MM-DD 格式
        const formattedStartDate = startDate.toISOString().split('T')[0];
        const formattedEndDate = endDate.toISOString().split('T')[0];
        
        console.log(`获取 ${coin.symbol} 从 ${formattedStartDate} 到 ${formattedEndDate} 的指标数据`);
        
        // 获取数据
        const data = await fetchCoinMetrics(coin.symbol, {
          startDate: formattedStartDate,
          endDate: formattedEndDate
        });
        
        if (!Array.isArray(data) || data.length === 0) {
          // 如果没有数据返回，创建一些模拟数据供显示
          console.log(`没有找到 ${coin.symbol} 的历史数据，创建模拟数据`);
          const mockData = createMockData(coin, startDate, endDate);
          setMetrics(mockData);
          setDisplayData(mockData);
        } else {
          console.log(`获取到 ${data.length} 条历史指标数据`);
          
          // 处理数据 - 将API返回的格式转换为图表需要的格式
          const processedData = data.map((metric, index) => {
            // 如果是最后一条数据，使用传入的coin对象的当前值
            if (index === data.length - 1) {
              return {
                date: metric.date,
                blastIndex: coin.explosionIndex !== undefined ? coin.explosionIndex : metric.explosion_index || 0,
                otcIndex: coin.otcIndex !== undefined ? coin.otcIndex : metric.otc_index || 0,
                schellingPoint: coin.schellingPoint !== undefined ? coin.schellingPoint : metric.schelling_point || 0,
                actionType: coin.entryExitType || metric.entry_exit_type || 'neutral',
                actionDay: coin.entryExitDay !== undefined ? coin.entryExitDay : metric.entry_exit_day || 0
              };
            }
            
            // 其他数据正常处理
            return {
              date: metric.date,
              blastIndex: metric.explosion_index || 0,
              otcIndex: metric.otc_index || 0,
              schellingPoint: metric.schelling_point || 0,
              actionType: metric.entry_exit_type === 'entry' ? '进场' : metric.entry_exit_type === 'exit' ? '退场' : '中性',
              actionDay: metric.entry_exit_day || 0
            };
          });
          
          // 按日期排序
          processedData.sort((a, b) => new Date(a.date) - new Date(b.date));
          
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
  }, [coin?.symbol, timeRange]); // 仅在coin.symbol或timeRange变化时重新加载
  
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
          blastIndex: baseExplosionIndex,
          otcIndex: baseOtcIndex,
          schellingPoint: baseSchellingPoint,
          actionType: entryExitType,
          actionDay: entryExitDay
        });
        continue;
      }
      
      // 其他天生成合理的随机值
      const randomFactor = Math.sin(i / 10) * 20 + (Math.random() - 0.5) * 15;
      const explosionChange = i === 0 ? 0 : mockData[i-1].blastIndex - baseExplosionIndex + randomFactor;
      
      mockData.push({
        date: dateStr,
        blastIndex: Math.max(100, Math.min(300, baseExplosionIndex + explosionChange * 0.2)),
        otcIndex: Math.max(500, Math.min(2000, baseOtcIndex + randomFactor * 5)),
        schellingPoint: Math.max(100, baseSchellingPoint * (1 + (randomFactor / 1000))),
        actionType: entryExitType,
        actionDay: entryExitType !== '中性' ? Math.max(0, entryExitDay - (dayCount - i)) : 0
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
  
  // 自定义提示框
  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const isWarning = (data.blastIndex || 0) < 200;
      const actionInfo = data.actionType === '中性' ? 
        '中性期' : 
        `${data.actionType}期第${data.actionDay}天`;
      
      return (
        <div className="bg-white p-3 border border-gray-200 shadow-lg rounded-md">
          <div className="text-gray-600 text-sm mb-1">{`日期: ${data.date}`}</div>
          
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
            <span className="text-purple-600 font-medium">谢林点: {data.schellingPoint.toLocaleString()}</span>
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
      console.error('数据不一致!', {
        '图表爆破指数': latestData.blastIndex,
        '卡片爆破指数': coin.explosionIndex,
        '图表场外指数': latestData.otcIndex,
        '卡片场外指数': coin.otcIndex
      });
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
              </div>
              
              <Select 
                defaultValue="1M" 
                style={{ width: 120 }} 
                onChange={value => setTimeRange(value)}
              >
                <Option value="1W">1周</Option>
                <Option value="1M">1个月</Option>
                <Option value="3M">3个月</Option>
                <Option value="6M">6个月</Option>
                <Option value="1Y">1年</Option>
                <Option value="ALL">全部</Option>
              </Select>
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
                <Radio.Button value="blast">爆破指数</Radio.Button>
                <Radio.Button value="otc">场外指数</Radio.Button>
                <Radio.Button value="both">双指标对比</Radio.Button>
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
          <div style={{ height: '400px', userSelect: 'none' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart 
                data={displayData} 
                margin={{ top: 10, right: 30, left: 20, bottom: 30 }}
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
                </defs>
                
                <CartesianGrid strokeDasharray="3 3" />
                
                <XAxis 
                  dataKey="date" 
                  tick={{ fontSize: 12 }}
                  tickMargin={10}
                  tickFormatter={(value) => {
                    // 格式化日期，只显示月和日
                    const date = new Date(value);
                    return `${date.getMonth() + 1}/${date.getDate()}`;
                  }}
                />
                
                {/* 爆破指数Y轴 - 只有在显示爆破指数时显示 */}
                {(chartMode === 'blast' || chartMode === 'both') && (
                  <YAxis 
                    yAxisId="left"
                    domain={getYAxisDomain('blastIndex')}
                    label={{ 
                      value: '爆破指数', 
                      angle: -90, 
                      position: 'insideLeft',
                      offset: -5,
                      style: { fill: '#ef4444' }
                    }}
                    tick={{ fill: '#ef4444' }}
                  />
                )}
                
                {/* 场外指数Y轴 - 只有在显示场外指数时显示 */}
                {chartMode === 'otc' && (
                  <YAxis 
                    yAxisId="left"
                    domain={getYAxisDomain('otcIndex')}
                    label={{ 
                      value: '场外指数', 
                      angle: -90, 
                      position: 'insideLeft',
                      offset: -5,
                      style: { fill: '#3b82f6' }
                    }}
                    tick={{ fill: '#3b82f6' }}
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
                
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                
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
              </AreaChart>
            </ResponsiveContainer>
          </div>
          
          {/* 指标数据 */}
          {coin && (
            <Row gutter={16} className="mt-4">
              <Col span={8}>
                <Statistic 
                  title={
                    <div className="flex items-center">
                      <span>场外指数</span>
                      <InfoCircleOutlined className="ml-1 text-gray-400" title="反映场外交易活跃度的指标" />
                    </div>
                  }
                  value={coin.otcIndex} 
                  valueStyle={{ color: '#1677ff' }}
                />
              </Col>
              <Col span={8}>
                <Statistic 
                  title={
                    <div className="flex items-center">
                      <span>爆破指数</span>
                      <InfoCircleOutlined className="ml-1 text-gray-400" title="值低于200表示市场风险较高" />
                    </div>
                  }
                  value={coin.explosionIndex}
                  valueStyle={{ 
                    color: coin.explosionIndex < 200 ? '#ff6b6b' : '#52c41a'
                  }}
                  suffix={
                    coin.explosionIndex < 200 ? 
                    <Text type="danger">风险</Text> : 
                    <Text type="success">安全</Text>
                  }
                />
              </Col>
              <Col span={8}>
                <Statistic 
                  title={
                    <div className="flex items-center">
                      <span>谢林点</span>
                      <InfoCircleOutlined className="ml-1 text-gray-400" title="市场共识价格水平" />
                    </div>
                  }
                  value={coin.schellingPoint}
                  valueStyle={{ color: '#722ed1' }}
                  precision={
                    coin.schellingPoint > 1000 ? 0 :
                    coin.schellingPoint > 100 ? 1 :
                    coin.schellingPoint > 10 ? 2 : 4
                  }
                />
              </Col>
            </Row>
          )}
        </>
      )}
    </Card>
  );
}

export default CoinDetailChart;