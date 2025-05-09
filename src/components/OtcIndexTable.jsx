// src/components/OtcIndexTable.jsx - 改进版
import React, { useState } from 'react';
import { Table, Typography, Tag, Input, Button } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, SearchOutlined, ReloadOutlined } from '@ant-design/icons';

const { Title } = Typography;
const { Search } = Input;

function OtcIndexTable({ coins, loading = false, onRefresh }) {
  const [searchText, setSearchText] = useState('');
  const [sortedInfo, setSortedInfo] = useState({
    columnKey: 'otcIndex',
    order: 'descend',
  });

  // 处理表格排序变化
  const handleChange = (pagination, filters, sorter) => {
    setSortedInfo(sorter);
  };

  // 处理搜索
  const filteredCoins = coins.filter(coin => 
    coin.symbol.toLowerCase().includes(searchText.toLowerCase()) ||
    (coin.name && coin.name.toLowerCase().includes(searchText.toLowerCase()))
  );

  // 表格列定义
  const columns = [
    {
      title: '币种',
      dataIndex: 'symbol',
      key: 'symbol',
      render: (text, record) => (
        <div className="flex items-center">
          <div 
            className="w-6 h-6 rounded-full flex items-center justify-center mr-2 text-white"
            style={{ 
              backgroundColor: 
                record.symbol === 'BTC' ? '#F7931A' : 
                record.symbol === 'ETH' ? '#627EEA' : 
                record.symbol === 'USDT' ? '#26A17B' : 
                record.symbol === 'BNB' ? '#F3BA2F' : 
                record.symbol === 'SOL' ? '#14F195' : '#6366f1'
            }}
          >
            {text.charAt(0)}
          </div>
          <span className="font-medium">{text}</span>
          {record.name && text !== record.name && (
            <span className="text-gray-500 text-xs ml-1">({record.name})</span>
          )}
          {record.entryExitType && (
            <Tag 
              color={record.entryExitType === 'entry' ? 'success' : record.entryExitType === 'exit' ? 'error' : 'default'} 
              className="ml-2"
            >
              {record.entryExitType === 'entry' ? '进' : record.entryExitType === 'exit' ? '退' : '中'}
              {record.entryExitDay || 0}
            </Tag>
          )}
        </div>
      ),
      sorter: (a, b) => a.symbol.localeCompare(b.symbol),
    },
    {
      title: '场外指数',
      dataIndex: 'otcIndex',
      key: 'otcIndex',
      render: (value) => (
        <span className="text-blue-600 font-medium">{value || '-'}</span>
      ),
      sorter: (a, b) => (a.otcIndex || 0) - (b.otcIndex || 0),
      defaultSortOrder: 'descend',
      sortOrder: sortedInfo.columnKey === 'otcIndex' && sortedInfo.order,
    },
    {
      title: '爆破指数',
      dataIndex: 'explosionIndex',
      key: 'explosionIndex',
      render: (value) => {
        if (!value && value !== 0) return <span>-</span>;
        
        return (
          <span className={value > 200 ? 'text-green-600' : 'text-red-600'}>
            {value}
            {value > 200 ? 
              <ArrowUpOutlined className="ml-1" /> : 
              <ArrowDownOutlined className="ml-1" />
            }
          </span>
        );
      },
      sorter: (a, b) => (a.explosionIndex || 0) - (b.explosionIndex || 0),
      sortOrder: sortedInfo.columnKey === 'explosionIndex' && sortedInfo.order,
    },
    {
      title: '谢林点',
      dataIndex: 'schellingPoint',
      key: 'schellingPoint',
      render: (value) => {
        if (!value && value !== 0) return <span>-</span>;
        return (
          <span className="text-purple-600">{value.toLocaleString()}</span>
        );
      },
      sorter: (a, b) => (a.schellingPoint || 0) - (b.schellingPoint || 0),
      sortOrder: sortedInfo.columnKey === 'schellingPoint' && sortedInfo.order,
    }
  ];

  // 准备表格数据
  const tableData = filteredCoins.map((coin, index) => ({
    key: index,
    symbol: coin.symbol,
    name: coin.name,
    otcIndex: coin.otcIndex,
    explosionIndex: coin.explosionIndex,
    schellingPoint: coin.schellingPoint,
    entryExitType: coin.entryExitType,
    entryExitDay: coin.entryExitDay
  }));

  return (
    <div className="mt-6 bg-white rounded-lg shadow p-4">
      <div className="flex justify-between items-center mb-4">
        <Title level={4} className="mb-0">场外指数表</Title>
        <div className="flex items-center space-x-2">
          <Search
            placeholder="搜索币种"
            allowClear
            onChange={e => setSearchText(e.target.value)}
            style={{ width: 200 }}
          />
          <Button 
            icon={<ReloadOutlined />} 
            onClick={onRefresh}
            loading={loading}
          >
            刷新
          </Button>
        </div>
      </div>
      
      <Table 
        columns={columns} 
        dataSource={tableData} 
        pagination={{
          defaultPageSize: 10,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50', '100'],
          showTotal: (total) => `共 ${total} 条数据`
        }}
        onChange={handleChange}
        size="middle"
        className="overflow-x-auto"
        loading={loading}
        scroll={{ x: 'max-content' }}
      />
    </div>
  );
}

export default OtcIndexTable;