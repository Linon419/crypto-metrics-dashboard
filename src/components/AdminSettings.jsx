import React from 'react';
import { Tabs, Typography } from 'antd';
import { useSearchParams } from 'react-router-dom';
import {
  BarChartOutlined,
  ApiOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  FileTextOutlined,
  SettingOutlined,
  UserOutlined,
} from '@ant-design/icons';
import AIModelSettings from './AIModelSettings';
import CoinManagement from './CoinManagement';
import KlineCleanupSettings from './KlineCleanupSettings';
import KlineMappingSettings from './KlineMappingSettings';
import PromptSettings from './PromptSettings';
import UserManagement from './UserManagement';

const { Title, Text } = Typography;

function AdminSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const activeTab = [
    'coins',
    'users',
    'kline-mappings',
    'kline-cleanup',
    'ai-model-settings',
    'prompt-settings',
  ].includes(requestedTab) ? requestedTab : 'coins';

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
        activeKey={activeTab}
        onChange={tab => setSearchParams(tab === 'coins' ? {} : { tab })}
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
            key: 'users',
            label: (
              <span>
                <UserOutlined />
                用户管理
              </span>
            ),
            children: <UserManagement />,
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
          {
            key: 'ai-model-settings',
            label: (
              <span>
                <ApiOutlined />
                AI模型
              </span>
            ),
            children: <AIModelSettings />,
          },
          {
            key: 'prompt-settings',
            label: (
              <span>
                <FileTextOutlined />
                AI解析 Prompt
              </span>
            ),
            children: <PromptSettings />,
          },
        ]}
      />
    </div>
  );
}

export default AdminSettings;
