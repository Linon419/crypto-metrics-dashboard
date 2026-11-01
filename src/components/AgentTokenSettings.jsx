import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { KeyOutlined, StopOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  createAgentToken,
  listAgentTokens,
  revokeAgentToken,
} from '../services/api';

const { Paragraph, Text, Title } = Typography;

function AgentTokenSettings() {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState('');
  const [canWrite, setCanWrite] = useState(false);
  const [newToken, setNewToken] = useState('');
  const [pendingRevoke, setPendingRevoke] = useState(null);

  const loadTokens = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listAgentTokens();
      setTokens(result?.tokens || []);
    } catch (loadError) {
      setError(loadError.displayMessage || loadError.message || '获取 Token 列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTokens();
  }, [loadTokens]);

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      const result = await createAgentToken({ name: name.trim(), canWrite });
      setNewToken(result?.token || '');
      if (result?.tokenInfo) setTokens(current => [...current, result.tokenInfo]);
      setName('');
      setCanWrite(false);
      message.success('Agent Token 已生成');
    } catch (createError) {
      message.error(createError.displayMessage || createError.message || '生成失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async () => {
    setSubmitting(true);
    try {
      await revokeAgentToken(pendingRevoke.id);
      setTokens(current => current.filter(item => item.id !== pendingRevoke.id));
      message.success('Agent Token 已吊销');
    } catch (revokeError) {
      message.error(revokeError.displayMessage || revokeError.message || '吊销失败');
    } finally {
      setSubmitting(false);
      setPendingRevoke(null);
    }
  };

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      render: value => value || <Text type="secondary">未命名</Text>,
    },
    {
      title: '尾号',
      dataIndex: 'last4',
      render: value => `…${value}`,
    },
    {
      title: '权限',
      dataIndex: 'canWrite',
      render: value => (value ? <Tag color="orange">读取 + 写入数据</Tag> : <Tag color="green">只读</Tag>),
    },
    {
      title: '生成时间',
      dataIndex: 'createdAt',
      render: (value, record) => (
        <>
          {value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-'}
          {record.createdBy ? `（${record.createdBy}）` : ''}
        </>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_, record) => (
        <Button danger size="small" icon={<StopOutlined />} onClick={() => setPendingRevoke(record)}>
          吊销
        </Button>
      ),
    },
  ];

  return (
    <Card>
      <Title level={4}>
        <KeyOutlined className="mr-2" />
        Agent 访问
      </Title>
      <Paragraph type="secondary">
        给本机 Claude Code / Codex 的 crypto-metrics skill 使用，可以为不同设备或用途分别生成 Token。
        默认只读：只能读取行情、指标和你这个账号的通知，不能访问用户与管理接口，也不能触发外部数据刷新。
        勾选「允许写入数据」的 Token 额外可以提交原始数据，由 AI 解析后入库，和数据录入页效果相同。
        Token 跟随生成它的管理员账号，账号被封禁、降级或删除后自动失效。
      </Paragraph>

      {error && <Alert type="error" showIcon message="加载失败" description={error} className="mb-4" />}

      {newToken && (
        <Alert
          type="warning"
          showIcon
          closable
          onClose={() => setNewToken('')}
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

      <Space wrap className="mb-4">
        <Input
          placeholder="名称（可选），如 MacBook / Codex"
          value={name}
          maxLength={50}
          onChange={event => setName(event.target.value)}
          style={{ width: 260 }}
        />
        <Checkbox checked={canWrite} onChange={event => setCanWrite(event.target.checked)}>
          允许写入数据
        </Checkbox>
        <Button type="primary" icon={<KeyOutlined />} loading={submitting && !pendingRevoke} onClick={handleCreate}>
          生成 Token
        </Button>
      </Space>

      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={tokens}
        pagination={false}
        locale={{ emptyText: '还没有 Token' }}
      />

      <Modal
        title="确认吊销 Agent Token"
        open={Boolean(pendingRevoke)}
        okText="确认吊销"
        cancelText="取消"
        okButtonProps={{ danger: true, loading: submitting }}
        onOk={handleRevoke}
        onCancel={() => setPendingRevoke(null)}
      >
        吊销「{pendingRevoke?.name || `…${pendingRevoke?.last4}`}」后，使用它的 skill 将立即无法访问，其他 Token 不受影响。
      </Modal>
    </Card>
  );
}

export default AgentTokenSettings;
