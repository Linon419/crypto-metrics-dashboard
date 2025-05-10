// src/components/OtcIndexTable.jsx
import React, { useState } from 'react';
import { Table, Typography, Tag, Tooltip, Badge, Button } from 'antd';
import { 
  ArrowUpOutlined, 
  ArrowDownOutlined, 
  InfoCircleOutlined,
  WarningOutlined 
} from '@ant-design/icons';

const { Title, Text } = Typography;

function OtcIndexTable({ coins, loading = false }) {
  const [sortedInfo, setSortedInfo] = useState({
    columnKey: 'otcIndex',
    order: 'descend',
  });

  // 处理表格排序变更
  const handleChange = (pagination, filters, sorter) => {
    setSortedInfo(sorter);
  };

  // 表格列定义
  const columns = [
    {
      title: '币种',
      dataIndex: 'symbol',
      key: 'symbol',
      fixed: 'left',
      width: 140,
      render: (text, record) => (
        <div className="flex items-center">
          <span className="font-medium">{text}</span>
          {record.entryExitType && record.entryExitType !== 'neutral' && (
            <Tag 
              color={record.entryExitType === 'entry' ? 'success' : 'error'} 
              className="ml-2"
            >
              {record.entryExitType === 'entry' ? '进' : '退'}{record.entryExitDay}
            </Tag>
          )}
        </div>
      )
    },
    {
      title: '场外指数',
      dataIndex: 'otcIndex',
      key: 'otcIndex',
      width: 170,
      sorter: (a, b) => a.otcIndex - b.otcIndex,
      sortOrder: sortedInfo.columnKey === 'otcIndex' ? sortedInfo.order : null,
      render: (value, record) => {
        const isNear1000 = value > 950 && value < 1050;
        // 显示前一天对比数据
        const prevData = record.previousDayData;
        
        return (
          <div className="flex items-center">
            <span className={`text-blue-600 font-medium ${isNear1000 ? 'text-orange-500' : ''}`}>
              {value}
            </span>
            
            {/* 显示与前一天的对比 */}
            {prevData && prevData.otc_index !== undefined && (
              <Tooltip title={`前一天: ${prevData.otc_index}`}>
                <span className="ml-2">
                  {value > prevData.otc_index ? (
                    <Badge 
                      count={<ArrowUpOutlined style={{ fontSize: '12px', color: '#52c41a' }} />} 
                      style={{ backgroundColor: '#f6ffed', boxShadow: 'none' }} 
                    />
                  ) : value < prevData.otc_index ? (
                    <Badge 
                      count={<ArrowDownOutlined style={{ fontSize: '12px', color: '#ff4d4f' }} />} 
                      style={{ backgroundColor: '#fff1f0', boxShadow: 'none' }} 
                    />
                  ) : null}
                </span>
              </Tooltip>
            )}
            
            {/* 场外指数超过1000指示器 */}
            {value >= 1000 && (
              <Tooltip title="场外指数超过1000，最后加仓时机">
                <Tag color="gold" className="ml-2">1000+</Tag>
              </Tooltip>
            )}
          </div>
        );
      }
    },
    {
      title: '爆破指数',
      dataIndex: 'explosionIndex',
      key: 'explosionIndex',
      width: 180,
      sorter: (a, b) => a.explosionIndex - b.explosionIndex,
      sortOrder: sortedInfo.columnKey === 'explosionIndex' ? sortedInfo.order : null,
      render: (value, record) => {
        const isWarning = value < 200;
        // 从前一天爆破指数对比
        const prevData = record.previousDayData;
        const wasNegative = prevData && prevData.explosion_index !== undefined && prevData.explosion_index < 0;
        const turnedPositive = wasNegative && value > 0;
        const brokeThreshold = prevData && prevData.explosion_index >= 200 && value < 200;
        
        return (
          <div className="flex items-center">
            <span className={isWarning ? 'text-red-600' : 'text-green-600'}>
              {value}
            </span>
            
            {/* 显示前一天对比 */}
            {prevData && prevData.explosion_index !== undefined && (
              <Tooltip title={`前一天: ${prevData.explosion_index}`}>
                <span className="ml-2">
                  {turnedPositive ? (
                    <Tag color="success" className="ml-1">负转正</Tag>
                  ) : brokeThreshold ? (
                    <Tag color="error" className="ml-1">跌破200</Tag>
                  ) : value > prevData.explosion_index ? (
                    <Badge 
                      count={<ArrowUpOutlined style={{ fontSize: '12px', color: '#52c41a' }} />} 
                      style={{ backgroundColor: '#f6ffed', boxShadow: 'none' }} 
                    />
                  ) : value < prevData.explosion_index ? (
                    <Badge 
                      count={<ArrowDownOutlined style={{ fontSize: '12px', color: '#ff4d4f' }} />} 
                      style={{ backgroundColor: '#fff1f0', boxShadow: 'none' }} 
                    />
                  ) : null}
                </span>
              </Tooltip>
            )}
            
            {/* 爆破指数小于200警告 */}
            {isWarning && (
              <Tooltip title="爆破指数低于200，处于风险区域">
                <WarningOutlined className="ml-2 text-amber-500" />
              </Tooltip>
            )}
          </div>
        );
      }
    },
    {
      title: '谢林点',
      dataIndex: 'schellingPoint',
      key: 'schellingPoint',
      width: 150,
      sorter: (a, b) => a.schellingPoint - b.schellingPoint,
      sortOrder: sortedInfo.columnKey === 'schellingPoint' ? sortedInfo.order : null,
      render: (value) => (
        <span className="text-purple-600">
          {typeof value === 'number' ? (
            value > 1000 ? 
              value.toLocaleString() : 
              value.toFixed(value < 1 ? 3 : value < 10 ? 2 : 0)
          ) : '-'}
        </span>
      )
    },
    {
      title: '交易建议',
      key: 'suggestion',
      width: 200,
      render: (_, record) => {
        // 根据爆破指数与前一天的对比，提供交易建议
        const prevData = record.previousDayData;
        if (!prevData) return <Text type="secondary">数据不足</Text>;
        
        const currExplosionIndex = record.explosionIndex;
        const prevExplosionIndex = prevData.explosion_index;
        
        // 做多建议: 爆破指数由负转正或新进场
        if (prevExplosionIndex < 0 && currExplosionIndex > 0) {
          return (
            <Tag color="success" className="px-2 py-1">
              做多：爆破指数由负转正
            </Tag>
          );
        }
        
        if (record.entryExitType === 'entry' && record.entryExitDay <= 3) {
          return (
            <Tag color="success" className="px-2 py-1">
              做多：进场期初期
            </Tag>
          );
        }
        
        // 做空建议: 爆破指数跌破200或新退场
        if (prevExplosionIndex >= 200 && currExplosionIndex < 200) {
          return (
            <Tag color="error" className="px-2 py-1">
              做空：爆破指数跌破200
            </Tag>
          );
        }
        
        if (record.entryExitType === 'exit' && record.entryExitDay === 1) {
          return (
            <Tag color="error" className="px-2 py-1">
              做空：退场期第一天
            </Tag>
          );
        }
        
        // 默认建议
        return (
          <Text type="secondary">
            {currExplosionIndex >= 200 ? "观望" : "风险注意"}
          </Text>
        );
      }
    }
  ];

  // 准备表格数据
  const tableData = coins.map((coin, index) => ({
    key: `${coin.symbol}-${index}`,
    symbol: coin.symbol,
    otcIndex: coin.otcIndex,
    explosionIndex: coin.explosionIndex,
    schellingPoint: coin.schellingPoint,
    entryExitType: coin.entryExitType,
    entryExitDay: coin.entryExitDay,
    previousDayData: coin.previousDayData,
    explosionIndexChangePercent: coin.explosionIndexChangePercent,
    otcIndexChangePercent: coin.otcIndexChangePercent
  }));

  return (
    <div className="mt-6 bg-white rounded-lg shadow p-4">
      <div className="flex justify-between items-center mb-4">
        <Title level={4} className="mb-0">场外指数表</Title>
        <Tooltip title="点击表头可以对数据进行排序">
          <Button 
            type="text" 
            icon={<InfoCircleOutlined />} 
            className="text-gray-400"
          />
        </Tooltip>
      </div>
      
      <Table 
        columns={columns} 
        dataSource={tableData} 
        pagination={tableData.length > 10 ? { pageSize: 10 } : false}
        size="middle"
        className="overflow-x-auto"
        loading={loading}
        onChange={handleChange}
        scroll={{ x: 650 }}
      />
      
      {/* 表格说明 */}
      <div className="mt-3 text-xs text-gray-500 flex flex-col md:flex-row gap-2 md:gap-6">
        <div>
          <Badge 
            count={<ArrowUpOutlined style={{ fontSize: '10px', color: '#52c41a' }} />} 
            style={{ backgroundColor: '#f6ffed', boxShadow: 'none' }} 
          />
          <Text className="ml-1">高于前一天</Text>
        </div>
        <div>
          <Badge 
            count={<ArrowDownOutlined style={{ fontSize: '10px', color: '#ff4d4f' }} />} 
            style={{ backgroundColor: '#fff1f0', boxShadow: 'none' }} 
          />
          <Text className="ml-1">低于前一天</Text>
        </div>
        <div>
          <Tag color="success" className="text-xs">负转正</Tag>
          <Text className="ml-1">爆破指数由负转正</Text>
        </div>
        <div>
          <Tag color="error" className="text-xs">跌破200</Tag>
          <Text className="ml-1">爆破指数跌破200</Text>
        </div>
      </div>
    </div>
  );
}

export default OtcIndexTable;