import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import { PictureOutlined } from '@ant-design/icons';
import { getLogoSettings, updateLogoSettings } from '../services/api';

const { Paragraph, Text, Title } = Typography;

// 与后端校验一致：Client ID 会被拼进 logo 图片 URL
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const SOURCE_TAGS = {
  settings: <Tag color="green">网页配置</Tag>,
  env: <Tag color="blue">环境变量</Tag>,
  none: <Tag>未配置</Tag>,
};

// 保存后立即写回运行时配置，看板里的 logo 不用刷新页面就改用新 ID
function applyRuntimeClientId(clientId) {
  window.runtimeConfig = { ...(window.runtimeConfig || {}), BRANDFETCH_CLIENT_ID: clientId || '' };
}

function LogoSettings() {
  const [form] = Form.useForm();
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getLogoSettings();
      setSettings(result?.settings || null);
      form.setFieldsValue({ brandfetchClientId: result?.settings?.brandfetchClientId || '' });
    } catch (loadError) {
      setError(loadError.displayMessage || loadError.message || '获取 Logo 设置失败');
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const save = async (brandfetchClientId) => {
    setSaving(true);
    try {
      const result = await updateLogoSettings({ brandfetchClientId });
      const nextSettings = result?.settings || null;
      setSettings(nextSettings);
      form.setFieldsValue({ brandfetchClientId: nextSettings?.brandfetchClientId || '' });
      applyRuntimeClientId(nextSettings?.effectiveBrandfetchClientId);
      message.success(brandfetchClientId ? 'Logo 设置已保存' : '已清空，改用环境变量');
    } catch (saveError) {
      message.error(saveError.displayMessage || saveError.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleFinish = ({ brandfetchClientId = '' }) => save(brandfetchClientId.trim());

  return (
    <Card>
      <Title level={4}>
        <PictureOutlined className="mr-2" />
        Logo 设置
      </Title>
      <Paragraph type="secondary">
        新增的股票等标的会用 Brandfetch 在浏览器端查找官方 logo，需要填写
        Brandfetch 的 Client ID（在 brandfetch.com 开发者后台获取）。这里填写的优先于服务端环境变量
        BRANDFETCH_CLIENT_ID；留空则继续使用环境变量。加密货币和内置标的的 logo 由服务端提供，不受影响。
      </Paragraph>

      {error && <Alert type="error" showIcon message="加载失败" description={error} className="mb-4" />}

      {loading ? (
        <Spin className="mb-4" />
      ) : (
        <Paragraph>
          <Text>当前生效：</Text>
          {SOURCE_TAGS[settings?.source] || SOURCE_TAGS.none}
          {settings?.effectiveBrandfetchClientId && (
            <Text code>{settings.effectiveBrandfetchClientId}</Text>
          )}
          {settings?.source === 'settings' && settings?.envConfigured && (
            <Text type="secondary">（环境变量也已配置，当前被网页配置覆盖）</Text>
          )}
        </Paragraph>
      )}

      {/* 表单始终挂载：加载完成时要 setFieldsValue，卸载状态下会连不上 form 实例 */}
      <Form
        form={form}
        layout="vertical"
        onFinish={handleFinish}
        disabled={loading}
        style={{ maxWidth: 480 }}
      >
        <Form.Item
          label="Brandfetch Client ID"
          name="brandfetchClientId"
          rules={[{
            validator: (_, value) => {
              const trimmed = String(value || '').trim();
              if (!trimmed || CLIENT_ID_PATTERN.test(trimmed)) return Promise.resolve();
              return Promise.reject(new Error('只能包含字母、数字、下划线和短横线，最长 128 位'));
            },
          }]}
        >
          <Input placeholder="例如 1idXXXXXXXXXXXX" allowClear autoComplete="off" />
        </Form.Item>
        <Space>
          <Button type="primary" htmlType="submit" loading={saving}>
            保存
          </Button>
          {settings?.brandfetchClientId && (
            <Button disabled={saving} onClick={() => save('')}>
              清空并使用环境变量
            </Button>
          )}
        </Space>
      </Form>
    </Card>
  );
}

export default LogoSettings;
