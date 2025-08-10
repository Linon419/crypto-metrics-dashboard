// src/components/MobileOptimizedChart.jsx
// 移动端优化的图表组件

import React, { useState, useEffect } from 'react';
import { Card, Button, Space, Typography, Row, Col, Statistic, Tabs } from 'antd';
import { FullscreenOutlined, FullscreenExitOutlined } from '@ant-design/icons';
import { ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from 'recharts';

const { Title, Text } = Typography;
const { TabPane } = Tabs;

function MobileOptimizedChart({ coin, metrics = [], loading = false }) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  // 移动端图表配置
  const mobileChartConfig = {
    margin: { top: 10, right: 10, left: 10, bottom: 10 },
    height: isFullscreen ? window.innerHeight - 200 : 250,
  };

  // 处理全屏切换
  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  // 移动端友好的工具提示
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-2 border border-gray-300 rounded shadow-lg text-xs">
          <p className="font-medium">{`日期: ${label}`}</p>
          {payload.map((entry, index) => (
            <p key={index} style={{ color: entry.color }}>
              {`${entry.name}: ${entry.value}`}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  // 移动端统计卡片
  const MobileStatCard = ({ title, value, color, suffix = '' }) => (
    <div className="bg-white p-3 rounded-lg border border-gray-200 text-center">
      <div className="text-xs text-gray-500 mb-1">{title}</div>
      <div className={`text-lg font-bold ${color}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}{suffix}
      </div>
    </div>
  );

  // 概览标签页内容
  const OverviewTab = () => (
    <div className="space-y-3">
      {/* 关键指标网格 */}
      <div className="grid grid-cols-2 gap-2">
        <MobileStatCard
          title="场外指数"
          value={coin?.otcIndex || 0}
          color="text-blue-600"
        />
        <MobileStatCard
          title="爆破指数"
          value={coin?.explosionIndex || 0}
          color={coin?.explosionIndex >= 200 ? "text-green-600" : "text-red-600"}
        />
        <MobileStatCard
          title="谢林点"
          value={coin?.schellingPoint || 0}
          color="text-purple-600"
        />
        <MobileStatCard
          title="进退场"
          value={
            coin?.entryExitType === 'entry' ? '进场' :
            coin?.entryExitType === 'exit' ? '退场' : '中性'
          }
          color={
            coin?.entryExitType === 'entry' ? "text-green-600" :
            coin?.entryExitType === 'exit' ? "text-red-600" : "text-gray-600"
          }
        />
      </div>

      {/* 变化百分比 */}
      {(coin?.otcIndexChangePercent || coin?.explosionIndexChangePercent) && (
        <div className="bg-gray-50 p-3 rounded-lg">
          <div className="text-xs text-gray-600 mb-2">24小时变化</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {coin?.otcIndexChangePercent && (
              <div>
                <span className="text-gray-500">场外: </span>
                <span className={coin.otcIndexChangePercent >= 0 ? "text-green-600" : "text-red-600"}>
                  {coin.otcIndexChangePercent >= 0 ? '+' : ''}{coin.otcIndexChangePercent.toFixed(1)}%
                </span>
              </div>
            )}
            {coin?.explosionIndexChangePercent && (
              <div>
                <span className="text-gray-500">爆破: </span>
                <span className={coin.explosionIndexChangePercent >= 0 ? "text-green-600" : "text-red-600"}>
                  {coin.explosionIndexChangePercent >= 0 ? '+' : ''}{coin.explosionIndexChangePercent.toFixed(1)}%
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  // 图表标签页内容
  const ChartTab = () => (
    <div style={{ height: mobileChartConfig.height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={metrics}
          margin={mobileChartConfig.margin}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis 
            dataKey="date" 
            tick={{ fontSize: 10 }}
            interval="preserveStartEnd"
          />
          <YAxis 
            yAxisId="left"
            tick={{ fontSize: 10 }}
            width={40}
          />
          <YAxis 
            yAxisId="right" 
            orientation="right"
            tick={{ fontSize: 10 }}
            width={40}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend 
            wrapperStyle={{ fontSize: '10px' }}
            iconSize={8}
          />
          
          {/* 爆破指数 */}
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="explosionIndex"
            stroke="#ef4444"
            fill="url(#colorBlast)"
            strokeWidth={2}
            name="爆破指数"
          />
          
          {/* 场外指数 */}
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="otcIndex"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={false}
            name="场外指数"
          />
          
          {/* 安全线 */}
          <ReferenceLine 
            yAxisId="left" 
            y={200} 
            stroke="#22c55e" 
            strokeDasharray="5 5"
            label={{ value: "安全线", fontSize: 10 }}
          />
          
          {/* 临界线 */}
          <ReferenceLine 
            yAxisId="right" 
            y={1000} 
            stroke="#f59e0b" 
            strokeDasharray="5 5"
            label={{ value: "临界线", fontSize: 10 }}
          />

          <defs>
            <linearGradient id="colorBlast" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
          </defs>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );

  if (!coin) {
    return (
      <Card className="mb-4">
        <div className="text-center py-8 text-gray-500">
          请选择一个币种查看详情
        </div>
      </Card>
    );
  }

  return (
    <Card 
      className={`mb-4 ${isFullscreen ? 'fixed inset-0 z-50 m-0 rounded-none' : ''}`}
      title={
        <div className="flex justify-between items-center">
          <div>
            <Title level={5} className="mb-0">{coin.symbol}</Title>
            <Text type="secondary" className="text-xs">{coin.name}</Text>
          </div>
          <Button
            type="text"
            icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
            onClick={toggleFullscreen}
            size="small"
          />
        </div>
      }
      bodyStyle={{ padding: isFullscreen ? '16px' : '12px' }}
    >
      <Tabs 
        activeKey={activeTab} 
        onChange={setActiveTab}
        size="small"
        tabBarStyle={{ marginBottom: '12px' }}
      >
        <TabPane tab="概览" key="overview">
          <OverviewTab />
        </TabPane>
        <TabPane tab="图表" key="chart">
          <ChartTab />
        </TabPane>
      </Tabs>
    </Card>
  );
}

export default MobileOptimizedChart;
