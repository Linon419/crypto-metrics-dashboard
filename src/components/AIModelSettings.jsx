import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Popconfirm,
  Space,
  Typography,
  message,
} from 'antd';
import {
  ReloadOutlined,
  RollbackOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import {
  fetchAvailableAIModels,
  fetchOpenAIModelSettings,
  resetOpenAIModelSettings,
  updateOpenAIModelSettings,
} from '../services/api';
import AIModelConfigurationFields from './AIModelConfigurationFields';

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

function AIModelSettings() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [clearingKey, setClearingKey] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [provider, setProvider] = useState('openai');
  const [baseURL, setBaseURL] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [sources, setSources] = useState({});
  const [availableModels, setAvailableModels] = useState([]);

  const applySettings = useCallback((settings = {}) => {
    setProvider(settings.provider || 'openai');
    setBaseURL(settings.baseURL || PROVIDER_PRESETS.openai.baseURL);
    setModel(settings.model || PROVIDER_PRESETS.openai.model);
    setApiKey('');
    setApiKeyConfigured(Boolean(settings.apiKeyConfigured));
    setSources(settings.sources || {});
    setAvailableModels([]);
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
    setAvailableModels([]);
  }, []);

  const validateConnection = useCallback(() => {
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
    return true;
  }, [baseURL]);

  const validateForm = useCallback(() => {
    if (!validateConnection()) return false;
    if (!model.trim()) {
      message.error('模型名称不能为空');
      return false;
    }
    return true;
  }, [model, validateConnection]);

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

  const handleLoadModels = useCallback(async () => {
    if (!validateConnection()) return;
    if (!apiKeyConfigured && !apiKey.trim()) {
      message.error('请先输入 API Key，再同步模型列表');
      return;
    }

    setLoadingModels(true);
    try {
      const payload = {
        provider,
        baseURL: baseURL.trim(),
      };
      if (apiKey.trim()) payload.apiKey = apiKey.trim();
      const response = await fetchAvailableAIModels(payload);
      const models = Array.isArray(response.models) ? response.models : [];
      setAvailableModels(models);
      message.success(`已同步 ${models.length} 个可用模型`);
    } catch (error) {
      message.error(`同步失败：${error.displayMessage || error.message}`);
    } finally {
      setLoadingModels(false);
    }
  }, [apiKey, apiKeyConfigured, baseURL, provider, validateConnection]);

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

          <AIModelConfigurationFields
            apiKey={apiKey}
            apiKeyConfigured={apiKeyConfigured}
            availableModels={availableModels}
            baseURL={baseURL}
            clearingKey={clearingKey}
            loadingModels={loadingModels}
            model={model}
            onApiKeyChange={setApiKey}
            onBaseURLChange={setBaseURL}
            onClearApiKey={handleClearApiKey}
            onLoadModels={handleLoadModels}
            onModelChange={setModel}
            onProviderChange={handleProviderChange}
            provider={provider}
            sources={sources}
          />
        </Space>
      </Card>
    </div>
  );
}

export default AIModelSettings;
