// src/components/LiquidityRadialChart.jsx - Mobile-friendly version
import React, { useState, useEffect } from 'react';
import { Card, Typography, Spin, Empty, Row, Col, Statistic, Tooltip, Collapse } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { RadialBarChart, RadialBar, ResponsiveContainer, Legend, PolarAngleAxis, PolarGrid } from 'recharts';

const { Title, Text, Paragraph } = Typography;
const { Panel } = Collapse;

function LiquidityRadialChart({ liquidity, loading }) {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  // Listen for window resize to adjust for mobile
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (loading) {
    return (
      <Card className="mt-4 bg-white rounded-lg shadow p-4 mb-4">
        <div className="flex justify-center items-center p-6">
          <Spin size="large" />
        </div>
      </Card>
    );
  }

  if (!liquidity || (!liquidity.btc_fund_change && !liquidity.eth_fund_change && !liquidity.sol_fund_change)) {
    return (
      <Card className="mt-4 bg-white rounded-lg shadow p-4 mb-4">
        <Title level={4} className="mb-4">流动性概况</Title>
        <Empty description="暂无流动性数据" />
      </Card>
    );
  }

  // Prepare data
  const chartData = [
    {
      name: 'BTC',
      value: Math.abs(liquidity.btc_fund_change || 0),
      fill: '#F7931A',
      direction: (liquidity.btc_fund_change || 0) >= 0 ? 'inflow' : 'outflow'
    },
    {
      name: 'ETH',
      value: Math.abs(liquidity.eth_fund_change || 0),
      fill: '#627EEA',
      direction: (liquidity.eth_fund_change || 0) >= 0 ? 'inflow' : 'outflow'
    },
    {
      name: 'SOL',
      value: Math.abs(liquidity.sol_fund_change || 0),
      fill: '#14F195',
      direction: (liquidity.sol_fund_change || 0) >= 0 ? 'inflow' : 'outflow'
    }
  ].sort((a, b) => b.value - a.value); // Sort by fund change magnitude

  // Calculate maximum value for chart scaling
  const maxValue = Math.max(...chartData.map(item => item.value), 2); // Min value of 2 for visibility

  // Custom formatter with safety checks
  const customFormatter = (value, entry) => {
    // Safety check
    if (!entry || !entry.payload) {
      return <span>数据加载中...</span>;
    }
    
    return (
      <span style={{ color: entry.payload.fill || '#000' }}>
        {`${entry.payload.name || 'Unknown'} (${(entry.payload.value || 0).toFixed(2)}亿)`}
      </span>
    );
  };

  return (
    <Card className="mt-4 bg-white rounded-lg shadow p-4 mb-4">
      <div className="flex justify-between items-center mb-4">
        <Title level={4} className="mb-0">流动性概况</Title>
        <Tooltip title="资金流入流出情况，单位：亿美元">
          <InfoCircleOutlined className="text-gray-400" />
        </Tooltip>
      </div>

      {isMobile ? (
        // Mobile layout - stacked with collapsible sections
        <div>
          {/* Total market fund change - always visible */}
          <Statistic 
            title="总市场资金变化"
            value={liquidity.total_market_fund_change || 0}
            precision={2}
            valueStyle={{ 
              color: (liquidity.total_market_fund_change || 0) >= 0 ? '#3f8600' : '#cf1322',
              fontSize: '24px'
            }}
            prefix={(liquidity.total_market_fund_change || 0) >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
            suffix="亿美元"
            className="mb-4"
          />
          
          {/* Fund flow tags */}
          <div className="flex flex-wrap gap-2 mb-4">
            {chartData.map(item => (
              <div 
                key={item.name}
                className={`inline-flex items-center px-3 py-1 rounded-full ${
                  item.direction === 'inflow' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}
              >
                {item.name}
                {item.direction === 'inflow' ? <ArrowUpOutlined className="ml-1" /> : <ArrowDownOutlined className="ml-1" />}
                <span className="ml-1">{item.value.toFixed(2)}亿</span>
              </div>
            ))}
          </div>
          
          {/* Chart in collapsible panel */}
          <Collapse ghost className="mb-3">
            <Panel header="查看详细图表" key="1">
              <div style={{ height: '250px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <RadialBarChart 
                    cx="50%" 
                    cy="50%" 
                    innerRadius="20%" 
                    outerRadius="90%" 
                    data={chartData} 
                    startAngle={90} 
                    endAngle={-270}
                  >
                    <PolarAngleAxis type="number" domain={[0, maxValue]} angleAxisId={0} tick={false} />
                    <PolarGrid gridType="circle" />
                    <RadialBar
                      background
                      dataKey="value"
                      cornerRadius={10}
                      label={false} // Disable inner labels on mobile
                    />
                    <Legend 
                      iconSize={10} 
                      layout="vertical" 
                      verticalAlign="middle" 
                      align="right"
                      formatter={customFormatter}
                    />
                  </RadialBarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </Collapse>
          
          {/* Analysis section */}
          {liquidity.comments && (
            <Paragraph className="text-gray-700">
              <Text strong>分析: </Text>
              {liquidity.comments}
            </Paragraph>
          )}
        </div>
      ) : (
        // Desktop layout with side-by-side chart and stats
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12}>
            <div style={{ height: '300px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart 
                  cx="50%" 
                  cy="50%" 
                  innerRadius="20%" 
                  outerRadius="90%" 
                  data={chartData} 
                  startAngle={90} 
                  endAngle={-270}
                >
                  <PolarAngleAxis type="number" domain={[0, maxValue]} angleAxisId={0} tick={false} />
                  <PolarGrid gridType="circle" />
                  <RadialBar
                    background
                    dataKey="value"
                    cornerRadius={10}
                    label={{
                      position: 'insideStart',
                      fill: '#fff',
                      formatter: (value, entry) => {
                        if (!entry || !entry.payload) return '';
                        return `${entry.payload.name}: ${value.toFixed(2)}`;
                      }
                    }}
                  />
                  <Legend 
                    iconSize={10} 
                    layout="vertical" 
                    verticalAlign="middle" 
                    align="right"
                    formatter={customFormatter}
                  />
                </RadialBarChart>
              </ResponsiveContainer>
            </div>
          </Col>
          <Col xs={24} md={12}>
            <div className="flex flex-col justify-center h-full">
              <Statistic 
                title="总市场资金变化"
                value={liquidity.total_market_fund_change || 0}
                precision={2}
                valueStyle={{ 
                  color: (liquidity.total_market_fund_change || 0) >= 0 ? '#3f8600' : '#cf1322',
                  fontSize: '24px'
                }}
                prefix={(liquidity.total_market_fund_change || 0) >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
                suffix="亿美元"
                className="mb-6"
              />
              
              <div>
                <Title level={5}>资金流向分析</Title>
                <div className="flex flex-wrap gap-2 mb-4">
                  {chartData.map(item => (
                    <div 
                      key={item.name}
                      className={`inline-flex items-center px-3 py-1 rounded-full ${
                        item.direction === 'inflow' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {item.name}
                      {item.direction === 'inflow' ? <ArrowUpOutlined className="ml-1" /> : <ArrowDownOutlined className="ml-1" />}
                    </div>
                  ))}
                </div>
                
                {liquidity.comments && (
                  <Paragraph className="text-gray-700">
                    <Text strong>分析: </Text>
                    {liquidity.comments}
                  </Paragraph>
                )}
              </div>
            </div>
          </Col>
        </Row>
      )}
    </Card>
  );
}

export default LiquidityRadialChart;