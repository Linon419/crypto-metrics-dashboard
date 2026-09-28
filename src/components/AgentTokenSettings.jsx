import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Modal,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import { KeyOutlined, StopOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  createAgentToken,
  getAgentTokenStatus,
  revokeAgentToken,
} from '../services/api';

const { Paragraph, Text, Title } = Typography;

// 同一时间只允许一个确认弹窗：重新生成 / 吊销
const CONFIRM_COPY = {
  rotate: {
    title: '确认重新生成 Agent Token',
    content: '旧 Token 会立即失效，已配置在本机 skill 里的 Token 需要一并替换。',
    okText: '确认重新生成',
  },
  revoke: {
    title: '确认吊销 Agent Token',
    content: '吊销后本机 skill 将无法再读取数据，直到重新生成。',
    okText: '确认吊销',
  },
};

function AgentTokenSettings() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [newToken, setNewToken] = useState('');
  const [pendingAction, setPendingAction] = useState(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getAgentTokenStatus();
      setStatus(result?.status || { active: false });
    } catch (loadError) {
      setError(loadError.displayMessage || loadError.message || '获取状态失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      const result = await createAgentToken();
      setNewToken(result?.token || '');
      setStatus(result?.status || null);
      message.success('Agent Token 已生成');
    } catch (createError) {
      message.error(createError.displayMessage || createError.message || '生成失败');
    } finally {
      setSubmitting(false);
      setPendingAction(null);
    }
  };

  const handleRevoke = async () => {
    setSubmitting(true);
    try {
      const result = await revokeAgentToken();
      setNewToken('');
      setStatus(result?.status || { active: false });
      message.success('Agent Token 已吊销');
    } catch (revokeError) {
      message.error(revokeError.displayMessage || revokeError.message || '吊销失败');
    } finally {
      setSubmitting(false);
      setPendingAction(null);
    }
  };

  const confirmCopy = pendingAction ? CONFIRM_COPY[pendingAction] : null;

  return (
    <Card>
      <Title level={4}>
        <KeyOutlined className="mr-2" />
        Agent 只读访问
      </Title>
      <Paragraph type="secondary">
        给本机 Claude Code / Codex 的 crypto-metrics skill 使用。Token 只能读取行情、指标和
        你这个账号的通知，不能写入、不能访问用户与管理接口，也不能触发外部数据刷新。
        Token 跟随生成它的管理员账号，账号被封禁、降级或删除后自动失效。
      </Paragraph>

      {error && <Alert type="error" showIcon message="加载失败" description={error} className="mb-4" />}

      {loading ? (
        <Spin />
      ) : (
        <>
          <Descriptions column={1} size="small" bordered className="mb-4">
            <Descriptions.Item label="状态">
              {status?.active ? <Tag color="green">已启用</Tag> : <Tag>未启用</Tag>}
            </Descriptions.Item>
            {status?.active && (
              <>
                <Descriptions.Item label="Token 尾号">…{status.last4}</Descriptions.Item>
                <Descriptions.Item label="生成时间">
                  {status.createdAt ? dayjs(status.createdAt).format('YYYY-MM-DD HH:mm') : '-'}
                  {status.createdBy ? `（${status.createdBy}）` : ''}
                </Descriptions.Item>
              </>
            )}
          </Descriptions>

          {newToken && (
            <Alert
              type="warning"
              showIcon
              className="mb-4"
              message="新 Token 只显示这一次，请立即复制保存"
              description={(
                <>
                  <Paragraph copyable={{ text: newToken }} className="mb-2">
                    <Text code>{newToken}</Text>
                  </Paragraph>
                  <Text type="secondary">
                    在本机 shell 配置里设置 CRYPTO_METRICS_URL 与 CRYPTO_METRICS_TOKEN，详见仓库 agent-skills/crypto-metrics/SKILL.md。
                  </Text>
                </>
              )}
            />
          )}

          <Space>
            <Button
              type="primary"
              icon={<KeyOutlined />}
              loading={submitting && pendingAction !== 'revoke'}
              onClick={() => (status?.active ? setPendingAction('rotate') : handleCreate())}
            >
              {status?.active ? '重新生成 Token' : '生成 Token'}
            </Button>
            {status?.active && (
              <Button danger icon={<StopOutlined />} onClick={() => setPendingAction('revoke')}>
                吊销
              </Button>
            )}
          </Space>
        </>
      )}

      <Modal
        title={confirmCopy?.title}
        open={Boolean(confirmCopy)}
        okText={confirmCopy?.okText}
        cancelText="取消"
        okButtonProps={{ danger: true, loading: submitting }}
        onOk={pendingAction === 'revoke' ? handleRevoke : handleCreate}
        onCancel={() => setPendingAction(null)}
      >
        {confirmCopy?.content}
      </Modal>
    </Card>
  );
}

export default AgentTokenSettings;
