import React from 'react';
import {
  AutoComplete,
  Button,
  Input,
  Popconfirm,
  Radio,
  Space,
  Tag,
  Typography,
} from 'antd';
import { CloudSyncOutlined, DeleteOutlined } from '@ant-design/icons';

const { Text } = Typography;

const SOURCE_LABELS = {
  database: { color: 'green', label: 'Admin 数据库' },
  env: { color: 'blue', label: 'Docker 环境变量' },
  default: { color: 'default', label: '项目默认值' },
};

function SourceTag({ value }) {
  const source = SOURCE_LABELS[value] || { color: 'default', label: value || '未配置' };
  return <Tag color={source.color}>{source.label}</Tag>;
}

function AIModelConfigurationFields({
  apiKey,
  apiKeyConfigured,
  availableModels,
  baseURL,
  clearingKey,
  loadingModels,
  model,
  onApiKeyChange,
  onBaseURLChange,
  onClearApiKey,
  onLoadModels,
  onModelChange,
  onProviderChange,
  provider,
  sources,
}) {
  return (
    <>
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Space>
          <Text strong>供应商</Text>
          <SourceTag value={sources.provider} />
        </Space>
        <Radio.Group value={provider} onChange={onProviderChange} optionType="button">
          <Radio.Button value="openai">OpenAI</Radio.Button>
          <Radio.Button value="deepseek">DeepSeek</Radio.Button>
          <Radio.Button value="custom">OpenAI 兼容接口</Radio.Button>
        </Radio.Group>
      </Space>

      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Space>
          <Text strong>Base URL</Text>
          <SourceTag value={sources.baseURL} />
        </Space>
        <Input
          aria-label="Base URL"
          value={baseURL}
          onChange={event => onBaseURLChange(event.target.value)}
          placeholder="https://api.openai.com/v1"
        />
      </Space>

      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Space>
          <Text strong>API Key</Text>
          <SourceTag value={sources.apiKey} />
          <Tag color={apiKeyConfigured ? 'success' : 'warning'}>
            {apiKeyConfigured ? '已配置' : '待配置'}
          </Tag>
        </Space>
        <Space.Compact style={{ width: '100%' }}>
          <Input.Password
            aria-label="API Key"
            value={apiKey}
            onChange={event => onApiKeyChange(event.target.value)}
            placeholder={apiKeyConfigured ? '留空会保留当前有效密钥' : '输入供应商 API Key'}
            autoComplete="new-password"
          />
          {sources.apiKey === 'database' && (
            <Popconfirm
              title="清除数据库 API Key？"
              description="清除后会读取对应供应商的 Docker 环境变量。"
              okText="清除"
              cancelText="取消"
              onConfirm={onClearApiKey}
            >
              <Button danger icon={<DeleteOutlined />} loading={clearingKey}>
                清除密钥
              </Button>
            </Popconfirm>
          )}
        </Space.Compact>
        <Text type="secondary">输入新密钥会覆盖数据库中的旧值，页面不会读取或展示密钥内容。</Text>
      </Space>

      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Space>
          <Text strong>模型名称</Text>
          <SourceTag value={sources.model} />
        </Space>
        <Space.Compact style={{ width: '100%' }}>
          <AutoComplete
            value={model}
            options={availableModels.map(item => ({ value: item, label: item }))}
            onChange={onModelChange}
            filterOption={(inputValue, option) => (
              option.value.toLowerCase().includes(inputValue.toLowerCase())
            )}
            style={{ width: '100%' }}
          >
            <Input
              aria-label="模型名称"
              placeholder={provider === 'deepseek' ? 'deepseek-v4-flash' : 'gpt-4o'}
            />
          </AutoComplete>
          <Button
            aria-label="同步模型列表"
            icon={<CloudSyncOutlined />}
            loading={loadingModels}
            onClick={onLoadModels}
          >
            同步模型
          </Button>
        </Space.Compact>
        {availableModels.length > 0 ? (
          <Text type="success">已加载 {availableModels.length} 个可用模型</Text>
        ) : (
          <Text type="secondary">可同步供应商模型列表，也可以直接输入模型名称。</Text>
        )}
      </Space>
    </>
  );
}

export default AIModelConfigurationFields;
