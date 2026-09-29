import React from 'react';
import { Tabs, Typography } from 'antd';
import { useSearchParams } from 'react-router-dom';
import {
  BarChartOutlined,
  ApiOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  FileTextOutlined,
  KeyOutlined,
  PictureOutlined,
  SettingOutlined,
  UserOutlined,
} from '@ant-design/icons';
import AIModelSettings from './AIModelSettings';
import AgentTokenSettings from './AgentTokenSettings';
import CoinManagement from './CoinManagement';
import KlineCleanupSettings from './KlineCleanupSettings';
import KlineMappingSettings from './KlineMappingSettings';
import LogoSettings from './LogoSettings';
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
    'agent-token',
    'logo-settings',
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
            label: '币种管理',
            icon: <DatabaseOutlined />,
            children: <CoinManagement />,
          },
          {
            key: 'users',
            label: '用户管理',
            icon: <UserOutlined />,
            children: <UserManagement />,
          },
          {
            key: 'kline-mappings',
            label: 'K线映射',
            icon: <BarChartOutlined />,
            children: <KlineMappingSettings />,
          },
          {
            key: 'kline-cleanup',
            label: 'K线清理',
            icon: <DeleteOutlined />,
            children: <KlineCleanupSettings />,
          },
          {
            key: 'ai-model-settings',
            label: 'AI模型',
            icon: <ApiOutlined />,
            children: <AIModelSettings />,
          },
          {
            key: 'prompt-settings',
            label: 'AI解析 Prompt',
            icon: <FileTextOutlined />,
            children: <PromptSettings />,
          },
          {
            key: 'agent-token',
            label: 'Agent 访问',
            icon: <KeyOutlined />,
            children: <AgentTokenSettings />,
          },
          {
            key: 'logo-settings',
            label: 'Logo',
            icon: <PictureOutlined />,
            children: <LogoSettings />,
          },
        ]}
      />
    </div>
  );
}

export default AdminSettings;
