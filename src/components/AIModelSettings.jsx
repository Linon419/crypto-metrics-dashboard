import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Input,
  Popconfirm,
  Radio,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  DeleteOutlined,
  ReloadOutlined,
  RollbackOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import {
  fetchOpenAIModelSettings,
  resetOpenAIModelSettings,
  updateOpenAIModelSettings,
} from '../services/api';

const { Paragraph, Text, Title } = Typography;

const PROVIDER_PRESETS = {
  openai: {
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o',
  },
  deepseek: {
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
  },
};

const SOURCE_LABELS = {
  database: { color: 'green', label: 'Admin 数据库' },
  env: { color: 'blue', label: 'Docker 环境变量' },
  default: { color: 'default', label: '项目默认值' },
};

function SourceTag({ value }) {
  const source = SOURCE_LABELS[value] || { color: 'default', label: value || '未配置' };
  return <Tag color={source.color}>{source.label}</Tag>;
}

function AIModelSettings() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [clearingKey, setClearingKey] = useState(false);
  const [provider, setProvider] = useState('openai');
  const [baseURL, setBaseURL] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [sources, setSources] = useState({});

  const applySettings = useCallback((settings = {}) => {
    setProvider(settings.provider || 'openai');
    setBaseURL(settings.baseURL || PROVIDER_PRESETS.openai.baseURL);
    setModel(settings.model || PROVIDER_PRESETS.openai.model);
    setApiKey('');
    setApiKeyConfigured(Boolean(settings.apiKeyConfigured));
    setSources(settings.sources || {});
  }, []);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchOpenAIModelSettings();
      applySettings(response.settings || {});
    } catch (error) {
      message.error(`加载AI模型设置失败：${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [applySettings]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleProviderChange = useCallback(event => {
    const nextProvider = event.target.value;
    setProvider(nextProvider);
    const preset = PROVIDER_PRESETS[nextProvider];
    if (preset) {
      setBaseURL(preset.baseURL);
      setModel(preset.model);
    }
  }, []);

  const validateForm = useCallback(() => {
    if (!baseURL.trim()) {
      message.error('Base URL 不能为空');
      return false;
    }
    try {
      const url = new URL(baseURL);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid protocol');
    } catch (error) {
      message.error('Base URL 需要使用有效的 HTTP 或 HTTPS 地址');
      return false;
    }
    if (!model.trim()) {
      message.error('模型名称不能为空');
      return false;
    }
    return true;
  }, [baseURL, model]);

  const buildPayload = useCallback(() => {
    const payload = {
      provider,
      baseURL: baseURL.trim(),
      model: model.trim(),
    };
    if (apiKey.trim()) payload.apiKey = apiKey.trim();
    return payload;
  }, [apiKey, baseURL, model, provider]);

  const handleSave = useCallback(async () => {
    if (!validateForm()) return;
    setSaving(true);
    try {
      const response = await updateOpenAIModelSettings(buildPayload());
      applySettings(response.settings || {});
      message.success('AI模型设置已保存并立即生效');
    } catch (error) {
      message.error(`保存失败：${error.message}`);
    } finally {
      setSaving(false);
    }
  }, [applySettings, buildPayload, validateForm]);

  const handleClearApiKey = useCallback(async () => {
    if (!validateForm()) return;
    setClearingKey(true);
    try {
      const response = await updateOpenAIModelSettings({
        ...buildPayload(),
        apiKey: undefined,
        clearApiKey: true,
      });
      applySettings(response.settings || {});
      message.success('数据库 API Key 已清除');
    } catch (error) {
      message.error(`清除失败：${error.message}`);
    } finally {
      setClearingKey(false);
    }
  }, [applySettings, buildPayload, validateForm]);

  const handleReset = useCallback(async () => {
    setResetting(true);
    try {
      const response = await resetOpenAIModelSettings();
      applySettings(response.settings || {});
      message.success('已恢复 Docker 环境变量或项目默认值');
    } catch (error) {
      message.error(`恢复失败：${error.message}`);
    } finally {
      setResetting(false);
    }
  }, [applySettings]);

  return (
    <div className="ai-model-settings">
      <Card>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Space align="start" justify="space-between" wrap style={{ width: '100%' }}>
            <div>
              <Text type="secondary">ADMIN SETTINGS</Text>
              <Title level={3}>AI 模型</Title>
              <Paragraph type="secondary">
                配置数据解析使用的供应商、兼容接口和模型。保存后立即应用到新的解析请求。
              </Paragraph>
            </div>
            <Space wrap>
              <Button icon={<ReloadOutlined />} onClick={loadSettings} loading={loading}>
                刷新
              </Button>
              <Popconfirm
                title="恢复环境配置？"
                description="会清除数据库模型设置和数据库 API Key，随后读取 Docker 环境变量。"
                okText="恢复"
                cancelText="取消"
                onConfirm={handleReset}
              >
                <Button icon={<RollbackOutlined />} loading={resetting}>
                  恢复环境配置
                </Button>
              </Popconfirm>
              <Button
                aria-label="保存AI模型设置"
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSave}
                loading={saving}
              >
                保存
              </Button>
            </Space>
          </Space>

          <Alert
            type="info"
            showIcon
            message="Admin 数据库配置优先于 Docker 环境变量。API Key 由服务端保存，管理接口仅返回配置状态。"
          />

          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Space>
              <Text strong>供应商</Text>
              <SourceTag value={sources.provider} />
            </Space>
            <Radio.Group value={provider} onChange={handleProviderChange} optionType="button">
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
              onChange={event => setBaseURL(event.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </Space>

          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Space>
              <Text strong>模型名称</Text>
              <SourceTag value={sources.model} />
            </Space>
            <Input
              aria-label="模型名称"
              value={model}
              onChange={event => setModel(event.target.value)}
              placeholder={provider === 'deepseek' ? 'deepseek-v4-flash' : 'gpt-4o'}
            />
            {provider === 'deepseek' && (
              <Text type="secondary">DeepSeek 可用预设：deepseek-v4-flash、deepseek-v4-pro</Text>
            )}
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
                onChange={event => setApiKey(event.target.value)}
                placeholder={apiKeyConfigured ? '留空会保留当前有效密钥' : '输入供应商 API Key'}
                autoComplete="new-password"
              />
              {sources.apiKey === 'database' && (
                <Popconfirm
                  title="清除数据库 API Key？"
                  description="清除后会读取对应供应商的 Docker 环境变量。"
                  okText="清除"
                  cancelText="取消"
                  onConfirm={handleClearApiKey}
                >
                  <Button danger icon={<DeleteOutlined />} loading={clearingKey}>
                    清除密钥
                  </Button>
                </Popconfirm>
              )}
            </Space.Compact>
            <Text type="secondary">输入新密钥会覆盖数据库中的旧值，页面不会读取或展示密钥内容。</Text>
          </Space>
        </Space>
      </Card>
    </div>
  );
}

export default AIModelSettings;
