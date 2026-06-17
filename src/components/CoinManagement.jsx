import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  createAdminCoin,
  deleteAdminCoin,
  fetchAdminCoins,
  updateAdminCoin,
} from '../services/api';

const { Text } = Typography;

function normalizeCoinRows(rows = []) {
  return rows.map(row => ({
    ...row,
    key: row.id,
    symbol: String(row.symbol || '').toUpperCase(),
    name: row.name || '',
    current_price: row.current_price ?? null,
    logo_url: row.logo_url || '',
    latestMetricDate: row.latestMetricDate || null,
    globalLatestMetricDate: row.globalLatestMetricDate || null,
    isLatestMetricMissing: Boolean(row.isLatestMetricMissing),
  }));
}

function formatDependencyLines(dependencies = {}) {
  return [
    ['场外/爆破指标', dependencies.otcAndExplosionMetrics || dependencies.dailyMetrics || 0],
    ['K线', dependencies.coinKlines || 0],
    ['K线映射', dependencies.coinKlineMappings || 0],
    ['收藏', dependencies.userFavorites || 0],
    ['BTC价格点', dependencies.btcPricePoints || 0],
  ].filter(([, count]) => count > 0);
}

function CoinManagement() {
  const [coins, setCoins] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCoin, setEditingCoin] = useState(null);
  const [saving, setSaving] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [metricDateFilter, setMetricDateFilter] = useState('all');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [forceDeleting, setForceDeleting] = useState(false);
  const [form] = Form.useForm();

  const loadCoins = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchAdminCoins();
      setCoins(normalizeCoinRows(response.coins || []));
    } catch (error) {
      message.error(`加载币种失败：${error.displayMessage || error.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCoins();
  }, [loadCoins]);

  const filteredCoins = useMemo(() => {
    const keyword = searchText.trim().toUpperCase();
    return coins.filter(coin => (
      (metricDateFilter === 'all' || coin.isLatestMetricMissing)
      && (
        !keyword
        || coin.symbol.includes(keyword)
        || String(coin.name || '').toUpperCase().includes(keyword)
      )
    ));
  }, [coins, metricDateFilter, searchText]);

  const openModal = useCallback((coin = null) => {
    setEditingCoin(coin);
    setModalOpen(true);
    if (coin) {
      form.setFieldsValue({
        symbol: coin.symbol,
        name: coin.name,
        current_price: coin.current_price,
        logo_url: coin.logo_url,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        current_price: null,
        logo_url: '',
      });
    }
  }, [form]);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setEditingCoin(null);
    form.resetFields();
  }, [form]);

  const handleSubmit = useCallback(async (values) => {
    setSaving(true);
    try {
      if (editingCoin) {
        await updateAdminCoin(editingCoin.id, values);
        message.success(`${values.symbol || editingCoin.symbol} 已更新`);
      } else {
        await createAdminCoin(values);
        message.success(`${values.symbol} 已创建`);
      }
      closeModal();
      await loadCoins();
    } catch (error) {
      message.error(`保存失败：${error.displayMessage || error.message}`);
    } finally {
      setSaving(false);
    }
  }, [closeModal, editingCoin, loadCoins]);

  const handleDelete = useCallback(async (coin) => {
    try {
      await deleteAdminCoin(coin.id);
      message.success(`${coin.symbol} 已删除`);
      await loadCoins();
    } catch (error) {
      const data = error.response?.data;
      if (error.response?.status === 409 && data?.requiresConfirmation) {
        setPendingDelete({
          coin: data.coin || coin,
          dependencies: data.dependencies || {},
        });
        return;
      }
      message.error(`删除失败：${error.displayMessage || error.message}`);
    }
  }, [loadCoins]);

  const handleForceDelete = useCallback(async () => {
    if (!pendingDelete?.coin?.id) return;
    setForceDeleting(true);
    try {
      await deleteAdminCoin(pendingDelete.coin.id, { force: true });
      message.success(`${pendingDelete.coin.symbol} 已连同关联数据删除`);
      setPendingDelete(null);
      await loadCoins();
    } catch (error) {
      message.error(`强制删除失败：${error.displayMessage || error.message}`);
    } finally {
      setForceDeleting(false);
    }
  }, [loadCoins, pendingDelete]);

  const columns = useMemo(() => [
    {
      title: '币种',
      dataIndex: 'symbol',
      key: 'symbol',
      width: 160,
      sorter: (a, b) => a.symbol.localeCompare(b.symbol),
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{record.symbol}</Text>
          <Text type="secondary">{record.name}</Text>
        </Space>
      ),
    },
    {
      title: '指标日期',
      key: 'metricDate',
      width: 180,
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Tag color={record.isLatestMetricMissing ? 'orange' : 'green'}>
            {record.isLatestMetricMissing ? '缺最新' : '最新'}
          </Tag>
          <Text type="secondary">
            {record.latestMetricDate || '无指标'}
          </Text>
        </Space>
      ),
    },
    {
      title: '当前价格',
      dataIndex: 'current_price',
      key: 'current_price',
      width: 140,
      render: value => (value === null || value === undefined ? '-' : Number(value).toLocaleString()),
    },
    {
      title: 'Logo',
      dataIndex: 'logo_url',
      key: 'logo_url',
      ellipsis: true,
      render: value => (value ? <Text copyable>{value}</Text> : '-'),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 160,
      render: value => (value ? new Date(value).toLocaleString() : '-'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      render: (_, record) => (
        <Space>
          <Button
            aria-label={`编辑 ${record.symbol}`}
            type="link"
            icon={<EditOutlined />}
            onClick={() => openModal(record)}
          />
          <Button
            aria-label={`删除 ${record.symbol}`}
            type="link"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record)}
          />
        </Space>
      ),
    },
  ], [handleDelete, openModal]);

  const dependencyLines = formatDependencyLines(pendingDelete?.dependencies);

  return (
    <Card>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Space align="center" justify="space-between" style={{ width: '100%' }}>
          <div>
            <Text type="secondary">COIN DATABASE</Text>
            <Typography.Title level={3}>币种管理</Typography.Title>
          </div>
          <Space>
            <Input.Search
              allowClear
              placeholder="搜索 symbol / name"
              value={searchText}
              onChange={event => setSearchText(event.target.value)}
              style={{ width: 260 }}
            />
            <Radio.Group
              aria-label="指标日期筛选"
              value={metricDateFilter}
              onChange={event => setMetricDateFilter(event.target.value)}
              optionType="button"
              buttonStyle="solid"
            >
              <Radio.Button value="all">全部</Radio.Button>
              <Radio.Button value="missingLatest">最新日期缺失</Radio.Button>
            </Radio.Group>
            <Button icon={<ReloadOutlined />} onClick={loadCoins} loading={loading}>
              刷新
            </Button>
            <Button
              aria-label="新增币种"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => openModal()}
            >
              新增币种
            </Button>
          </Space>
        </Space>

        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={filteredCoins}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          scroll={{ x: 900 }}
        />
      </Space>

      <Modal
        title={editingCoin ? '编辑币种' : '新增币种'}
        open={modalOpen}
        onCancel={closeModal}
        footer={null}
        width={560}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            label="Symbol"
            name="symbol"
            rules={[
              { required: true, message: '请输入币种代码' },
              { max: 30, message: '最多30个字符' },
            ]}
          >
            <Input placeholder="例如 BTC" />
          </Form.Item>
          <Form.Item
            label="名称"
            name="name"
            rules={[
              { required: true, message: '请输入币种名称' },
              { max: 100, message: '最多100个字符' },
            ]}
          >
            <Input placeholder="例如 Bitcoin" />
          </Form.Item>
          <Form.Item label="当前价格" name="current_price">
            <InputNumber style={{ width: '100%' }} min={0} placeholder="可留空" />
          </Form.Item>
          <Form.Item label="Logo URL" name="logo_url">
            <Input placeholder="可留空" />
          </Form.Item>
          <Form.Item className="mb-0">
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button onClick={closeModal}>取消</Button>
              <Button type="primary" htmlType="submit" loading={saving}>
                保存
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`确认删除 ${pendingDelete?.coin?.symbol || ''}`}
        open={Boolean(pendingDelete)}
        onCancel={() => setPendingDelete(null)}
        okText="确认删除全部关联数据"
        cancelText="取消"
        okButtonProps={{ danger: true, loading: forceDeleting }}
        onOk={handleForceDelete}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Text>
            确认后会删除该币种的场外指数、爆破指数、进退场记录、K线和映射数据。
          </Text>
          <Space wrap>
            {dependencyLines.map(([label, count]) => (
              <Tag key={label} color="red">{label}: {count}</Tag>
            ))}
          </Space>
        </Space>
      </Modal>
    </Card>
  );
}

export default CoinManagement;
