import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Input,
  Popconfirm,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  ReloadOutlined,
  RollbackOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import {
  fetchOpenAIPromptSettings,
  resetOpenAIPromptSettings,
  updateOpenAIPromptSettings,
} from '../services/api';

const { Paragraph, Text, Title } = Typography;
const { TextArea } = Input;

const SOURCE_LABELS = {
  database: { color: 'green', label: '数据库' },
  env: { color: 'blue', label: '环境变量' },
  default: { color: 'default', label: '默认' },
};

function SourceTag({ value }) {
  const source = SOURCE_LABELS[value] || { color: 'default', label: value || '未知' };
  return <Tag color={source.color}>{source.label}</Tag>;
}

function PromptSettings() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [userPromptTemplate, setUserPromptTemplate] = useState('');
  const [sources, setSources] = useState({});

  const applySettings = useCallback((settings = {}) => {
    setSystemPrompt(settings.systemPrompt || '');
    setUserPromptTemplate(settings.userPromptTemplate || '');
    setSources(settings.sources || {});
  }, []);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchOpenAIPromptSettings();
      applySettings(response.settings || {});
    } catch (error) {
      message.error(`加载AI解析Prompt失败：${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [applySettings]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const validateForm = useCallback(() => {
    if (!systemPrompt.trim()) {
      message.error('System Prompt 不能为空');
      return false;
    }
    if (!userPromptTemplate.trim()) {
      message.error('用户 Prompt 模板不能为空');
      return false;
    }
    if (!userPromptTemplate.includes('{{processedText}}')) {
      message.error('用户 Prompt 模板必须包含 {{processedText}}');
      return false;
    }
    return true;
  }, [systemPrompt, userPromptTemplate]);

  const handleSave = useCallback(async () => {
    if (!validateForm()) return;

    setSaving(true);
    try {
      const response = await updateOpenAIPromptSettings({
        systemPrompt,
        userPromptTemplate,
      });
      applySettings(response.settings || {});
      message.success('AI解析Prompt已保存');
    } catch (error) {
      message.error(`保存失败：${error.message}`);
    } finally {
      setSaving(false);
    }
  }, [applySettings, systemPrompt, userPromptTemplate, validateForm]);

  const handleReset = useCallback(async () => {
    setResetting(true);
    try {
      const response = await resetOpenAIPromptSettings();
      applySettings(response.settings || {});
      message.success('AI解析Prompt已恢复默认');
    } catch (error) {
      message.error(`恢复失败：${error.message}`);
    } finally {
      setResetting(false);
    }
  }, [applySettings]);

  return (
    <div className="prompt-settings">
      <Card>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Space align="start" justify="space-between" style={{ width: '100%' }}>
            <div>
              <Text type="secondary">ADMIN SETTINGS</Text>
              <Title level={3}>AI解析 Prompt</Title>
              <Paragraph type="secondary">
                这里控制数据输入页的 AI 解析规则。新增币种、别名和特殊板块处理都可以写在用户 Prompt 模板里。
              </Paragraph>
            </div>
            <Space>
              <Button icon={<ReloadOutlined />} onClick={loadSettings} loading={loading}>
                刷新
              </Button>
              <Popconfirm
                title="恢复默认 Prompt？"
                description="会清除数据库中的自定义 Prompt，并重新使用默认或环境变量配置。"
                okText="恢复"
                cancelText="取消"
                onConfirm={handleReset}
              >
                <Button icon={<RollbackOutlined />} loading={resetting}>
                  恢复默认
                </Button>
              </Popconfirm>
              <Button
                aria-label="保存AI解析Prompt"
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
            message="用户 Prompt 模板必须保留 {{processedText}}，系统会把原始输入填到这个位置。{{currentDate}} 可用于插入当天日期。"
          />

          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Space>
              <Text strong>System Prompt</Text>
              <SourceTag value={sources.systemPrompt} />
            </Space>
            <TextArea
              aria-label="System Prompt"
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
              autoSize={{ minRows: 3, maxRows: 8 }}
              placeholder="系统角色和总体要求"
            />
          </Space>

          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Space>
              <Text strong>用户 Prompt 模板</Text>
              <SourceTag value={sources.userPromptTemplate} />
            </Space>
            <TextArea
              aria-label="用户 Prompt 模板"
              value={userPromptTemplate}
              onChange={(event) => setUserPromptTemplate(event.target.value)}
              autoSize={{ minRows: 18, maxRows: 36 }}
              placeholder="把币种映射、解析规则和输出格式写在这里"
            />
          </Space>
        </Space>
      </Card>
    </div>
  );
}

export default PromptSettings;
