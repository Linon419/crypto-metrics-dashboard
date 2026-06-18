import React from 'react';
import { Tabs, Typography } from 'antd';
import {
  BarChartOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import CoinManagement from './CoinManagement';
import KlineCleanupSettings from './KlineCleanupSettings';
import KlineMappingSettings from './KlineMappingSettings';

const { Title, Text } = Typography;

function AdminSettings() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <Text type="secondary">ADMIN SETTINGS</Text>
        <Title level={2}>
          <SettingOutlined className="mr-2" />
          Admin 设置
        </Title>
      </div>

      <Tabs
        defaultActiveKey="coins"
        items={[
          {
            key: 'coins',
            label: (
              <span>
                <DatabaseOutlined />
                币种管理
              </span>
            ),
            children: <CoinManagement />,
          },
          {
            key: 'kline-mappings',
            label: (
              <span>
                <BarChartOutlined />
                K线映射
              </span>
            ),
            children: <KlineMappingSettings />,
          },
          {
            key: 'kline-cleanup',
            label: (
              <span>
                <DeleteOutlined />
                K线清理
              </span>
            ),
            children: <KlineCleanupSettings />,
          },
        ]}
      />
    </div>
  );
}

export default AdminSettings;
