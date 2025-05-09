// src/components/OtcIndexTable.jsx
import React from 'react';
import { Table, Typography, Tag } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';

const { Title } = Typography;

function OtcIndexTable({ coins }) {
  // 表格列定义
  const columns = [
    {
      title: '币种',
      dataIndex: 'symbol',
      key: 'symbol',
      render: (text, record) => (
        <div className="flex items-center">
          <span className="font-medium">{text}</span>
          {record.entryExitType && (
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
      render: (value) => (
        <span className="text-blue-600 font-medium">{value}</span>
      ),
      sorter: (a, b) => a.otcIndex - b.otcIndex,
      defaultSortOrder: 'descend'
    },
    {
      title: '爆破指数',
      dataIndex: 'explosionIndex',
      key: 'explosionIndex',
      render: (value) => (
        <span className={value > 200 ? 'text-green-600' : 'text-red-600'}>
          {value}
          {value > 200 ? 
            <ArrowUpOutlined className="ml-1" /> : 
            <ArrowDownOutlined className="ml-1" />
          }
        </span>
      ),
      sorter: (a, b) => a.explosionIndex - b.explosionIndex
    },
    {
      title: '谢林点',
      dataIndex: 'schellingPoint',
      key: 'schellingPoint',
      render: (value) => (
        <span className="text-purple-600">{value.toLocaleString()}</span>
      )
    }
  ];

  // 准备表格数据
  const tableData = coins.map((coin, index) => ({
    key: index,
    symbol: coin.symbol,
    otcIndex: coin.otcIndex,
    explosionIndex: coin.explosionIndex,
    schellingPoint: coin.schellingPoint,
    entryExitType: coin.entryExitType,
    entryExitDay: coin.entryExitDay
  }));

  return (
    <div className="mt-6 bg-white rounded-lg shadow p-4">
      <Title level={4} className="mb-4">场外指数表</Title>
      <Table 
        columns={columns} 
        dataSource={tableData} 
        pagination={false} 
        size="middle"
        className="overflow-x-auto"
      />
    </div>
  );
}

export default OtcIndexTable;