// src/components/CoinDetailChart.jsx
import React, { useState, useEffect, useRef } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, 
  Tooltip, Area, AreaChart, ResponsiveContainer, 
  ReferenceArea, ReferenceLine 
} from 'recharts';
import { Card, Button, Typography, Row, Col, Statistic, Spin, Select } from 'antd';
import { ZoomInOutlined, ZoomOutOutlined, UndoOutlined } from '@ant-design/icons';
import { fetchCoinMetrics } from '../services/api';

const { Title, Text } = Typography;
const { Option } = Select;

function CoinDetailChart({ coin }) {
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(false);
  const [timeRange, setTimeRange] = useState('1M'); // 默认显示1个月
  const [zoomState, setZoomState] = useState(null);
  const [displayData, setDisplayData] = useState([]);
  const chartRef = useRef(null);
  
  // 重置图表缩放
  const handleReset = () => {
    setDisplayData(metrics);
  };
  
  // 处理缩放开始
  const handleMouseDown = (e) => {
    if (!e) return;
    const { xValue } = e;
    setZoomState({
      x1: xValue,
      x2: xValue
    });
  };
  
  // 处理缩放进行中
  const handleMouseMove = (e) => {
    if (!zoomState || !e) return;
    const { xValue } = e;
    setZoomState({
      ...zoomState,
      x2: xValue
    });
  };
  
  // 处理缩放结束
  const handleMouseUp = () => {
    if (!zoomState) return;
    
    // 确保 x1 <= x2
    const { x1, x2 } = zoomState;
    const [smaller, larger] = x1 <= x2 ? [x1, x2] : [x2, x1];
    
    // 如果选择区域太小，视为点击，忽略缩放
    if (Math.abs(smaller - larger) < 1) {
      setZoomState(null);
      return;
    }
    
    // 过滤数据以实现缩放
    const filteredData = metrics.filter(
      item => item.date >= smaller && item.date <= larger
    );
    
    setDisplayData(filteredData.length ? filteredData : metrics);
    setZoomState(null);
  };
  
  // 加载币种历史指标数据
  useEffect(() => {
    const loadMetricsData = async () => {
      if (!coin || !coin.symbol) return;
      
      setLoading(true);
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
        
        // 获取数据
        const data = await fetchCoinMetrics(coin.symbol, {
          startDate: formattedStartDate,
          endDate: formattedEndDate
        });
        
        // 处理数据 - 将API返回的格式转换为图表需要的格式
        const processedData = data.map(metric => ({
          date: metric.date,
          blastIndex: metric.explosion_index,
          otcIndex: metric.otc_index,
          schellingPoint: metric.schelling_point,
          actionType: metric.entry_exit_type === 'entry' ? '进场' : '退场',
          actionDay: metric.entry_exit_day
        }));
        
        // 按日期排序
        processedData.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        setMetrics(processedData);
        setDisplayData(processedData);
      } catch (error) {
        console.error('Error loading metrics:', error);
      } finally {
        setLoading(false);
      }
    };
    
    loadMetricsData();
  }, [coin, timeRange]);
  
  // 自定义提示框
  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const isWarning = data.blastIndex < 200;
      const actionInfo = `${data.actionType}期第${data.actionDay}天`;
      
      return (
        <div className="bg-white p-3 border border-gray-200 shadow-lg rounded-md">
          <div className="text-gray-600 text-sm mb-1">{`日期: ${data.date}`}</div>
          
          <div className={`text-sm font-bold p-1 mb-2 rounded text-center ${
            data.actionType === "进场" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
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
            <span className="text-purple-600 font-medium">谢林点: {data.schellingPoint}</span>
          </div>
        </div>
      );
    }
    return null;
  };
  
  return (
    <Card className="w-full mt-4 overflow-hidden">
      {loading ? (
        <div className="flex flex-col items-center justify-center py-10">
          <Spin size="large" />
          <div className="mt-4">加载数据中...</div>
        </div>
      ) : (
        <>
          <div className="mb-4 flex justify-between items-center">
            <div>
              <Title level={3} className="mb-0">
                {coin?.name || coin?.symbol} ({coin?.symbol})
                {displayData.length > 0 && displayData[displayData.length - 1].actionType === '进场' && (
                  <span className="ml-3 px-2 py-1 text-xs font-bold bg-green-100 text-green-800 rounded-full">
                    进场期第{displayData[displayData.length - 1].actionDay}天
                  </span>
                )}
                {displayData.length > 0 && displayData[displayData.length - 1].actionType === '退场' && (
                  <span className="ml-3 px-2 py-1 text-xs font-bold bg-red-100 text-red-800 rounded-full">
                    退场期第{displayData[displayData.length - 1].actionDay}天
                  </span>
                )}
              </Title>
              
              <div className="flex items-center mt-1">
                {displayData.length > 0 && (
                  <Text className="flex items-center text-red-600 font-medium">
                    爆破指数: {displayData[displayData.length - 1].blastIndex}
                    {displayData[displayData.length - 1].blastIndex < 200 && (
                      <Text className="ml-2 text-amber-500">
                        ⚠️ 低于安全阈值(200)
                      </Text>
                    )}
                  </Text>
                )}
              </div>
            </div>
            
            <div className="flex items-center">
              <div className="flex p-2 rounded-lg bg-gray-100 space-x-2 mr-4">
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
          
          <div className="mb-2 flex space-x-2">
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
            <Text type="secondary" className="ml-2 text-sm">
              提示: 在图表上拖拽可以放大查看特定时间范围
            </Text>
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
                
                <YAxis 
                  domain={[100, 350]} 
                  label={{ 
                    value: '爆破指数', 
                    angle: -90, 
                    position: 'insideLeft',
                    offset: -5
                  }}
                />
                
                <Tooltip content={<CustomTooltip />} />
                
                {/* 进场期区域 */}
                <Area
                  type="monotone"
                  dataKey={(entry) => (entry.actionType === "进场" ? 350 : 0)}
                  stroke="none"
                  fill="url(#entrancePattern)"
                  fillOpacity={0.2}
                  activeDot={false}
                  name="进场期"
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
                />
                
                {/* 安全阈值线 */}
                <ReferenceLine
                  y={200}
                  stroke="#f59e0b"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  label={{
                    value: '安全阈值(200)',
                    position: 'insideBottomRight',
                    fill: '#f59e0b'
                  }}
                />
                
                {/* 爆破指数线 */}
                <Area 
                  type="monotone" 
                  dataKey="blastIndex" 
                  stroke="#ef4444" 
                  fillOpacity={1} 
                  fill="url(#colorBlast)" 
                  strokeWidth={2.5}
                  activeDot={{ r: 8, stroke: "#ef4444", strokeWidth: 2, fill: "white" }}
                  animationDuration={1000}
                  name="爆破指数"
                />
                
                {/* 缩放选择区域 */}
                {zoomState && (
                  <ReferenceArea 
                    x1={zoomState.x1} 
                    x2={zoomState.x2} 
                    strokeOpacity={0.3}
                    fill="#8884d8"
                    fillOpacity={0.1}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          
          {/* 指标数据 */}
          {displayData.length > 0 && (
            <Row gutter={16} className="mt-4">
              <Col span={8}>
                <Statistic 
                  title="场外指数" 
                  value={displayData[displayData.length - 1].otcIndex} 
                  valueStyle={{ color: '#1677ff' }}
                />
              </Col>
              <Col span={8}>
                <Statistic 
                  title="爆破指数" 
                  value={displayData[displayData.length - 1].blastIndex}
                  valueStyle={{ color: '#ff6b6b' }}
                />
              </Col>
              <Col span={8}>
                <Statistic 
                  title="谢林点" 
                  value={displayData[displayData.length - 1].schellingPoint}
                  valueStyle={{ color: '#722ed1' }}
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