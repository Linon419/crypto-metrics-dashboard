import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Statistic,
  Typography,
  message,
} from 'antd';
import {
  DeleteOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  deleteKlinesByCleanupFilters,
  previewKlineCleanup,
} from '../services/api';

const { RangePicker } = DatePicker;
const { Text, Title } = Typography;

const MARKET_OPTIONS = [
  { value: 'yahoo_finance', label: 'Yahoo Finance' },
  { value: 'binance_usdm_perpetual', label: 'Binance U 本位' },
  { value: 'binance_spot', label: 'Binance 现货' },
  { value: 'deribit_btc_dvol', label: 'Deribit BTC DVOL' },
];

const INTERVAL_OPTIONS = [
  { value: '', label: '全部周期' },
  { value: '15m', label: '15min' },
  { value: '1h', label: '1h' },
  { value: '4h', label: '4h' },
  { value: '1d', label: '日' },
];

function buildCleanupPayload(values = {}) {
  const dateRange = Array.isArray(values.dateRange) ? values.dateRange : [];
  return {
    coinSymbol: String(values.coinSymbol || '').trim().toUpperCase(),
    market: values.market || '',
    tradingSymbol: String(values.tradingSymbol || '').trim(),
    interval: values.interval || '',
    startDate: dateRange[0] ? dateRange[0].format('YYYY-MM-DD') : '',
    endDate: dateRange[1] ? dateRange[1].format('YYYY-MM-DD') : '',
  };
}

function KlineCleanupSettings() {
  const [form] = Form.useForm();
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);

  const previewCount = preview?.count || 0;
  const canDelete = previewCount > 0;
  const pendingDeleteFilterText = pendingDelete
    ? [
      pendingDelete.payload.coinSymbol || '-',
      pendingDelete.payload.market || '-',
      pendingDelete.payload.tradingSymbol || '-',
      pendingDelete.payload.interval || '全部周期',
    ].join(' / ')
    : '';

  const initialValues = useMemo(() => ({
    coinSymbol: 'GOLD',
    market: 'yahoo_finance',
    tradingSymbol: 'GLD',
    interval: '',
    dateRange: [],
  }), []);

  const handlePreview = useCallback(async () => {
    setPreviewing(true);
    try {
      const values = await form.validateFields();
      const result = await previewKlineCleanup(buildCleanupPayload(values));
      setPreview(result);
      message.success(`命中 ${result.count || 0} 根K线`);
    } catch (error) {
      if (!error.errorFields) {
        message.error(`预览失败：${error.displayMessage || error.message}`);
      }
    } finally {
      setPreviewing(false);
    }
  }, [form]);

  const handleDelete = useCallback(async () => {
    if (!canDelete) return;
    const values = await form.validateFields();
    const payload = buildCleanupPayload(values);

    setPendingDelete({
      payload,
      count: previewCount,
    });
  }, [canDelete, form, previewCount]);

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return;

    setDeleting(true);
    try {
      const result = await deleteKlinesByCleanupFilters(pendingDelete.payload);
      message.success(`已删除 ${result.deleted || 0} 根K线`);
      setPreview({
        ...result,
        count: 0,
      });
      setPendingDelete(null);
    } catch (error) {
      message.error(`删除失败：${error.displayMessage || error.message}`);
    } finally {
      setDeleting(false);
    }
  }, [pendingDelete]);

  return (
    <Card>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Text type="secondary">ADMIN SETTINGS</Text>
          <Title level={3}>K线清理</Title>
        </div>

        <Alert
          type="warning"
          showIcon
          message="先预览，再删除。至少填写币种或映射代码，适合清理 GOLD / GLD 这类旧映射 K 线。"
        />

        <Form
          form={form}
          layout="vertical"
          initialValues={initialValues}
          onValuesChange={() => setPreview(null)}
        >
          <Space wrap align="start">
            <Form.Item
              label="币种"
              name="coinSymbol"
              rules={[{ max: 30, message: '最多30个字符' }]}
            >
              <Input placeholder="例如 GOLD" style={{ width: 160 }} />
            </Form.Item>
            <Form.Item label="来源" name="market">
              <Select options={MARKET_OPTIONS} style={{ width: 190 }} allowClear />
            </Form.Item>
            <Form.Item
              label="映射代码"
              name="tradingSymbol"
              rules={[{
                validator: async (_, value) => {
                  const coinSymbol = form.getFieldValue('coinSymbol');
                  if (!String(coinSymbol || '').trim() && !String(value || '').trim()) {
                    throw new Error('币种和映射代码至少填一个');
                  }
                },
              }]}
            >
              <Input placeholder="例如 GLD" style={{ width: 190 }} />
            </Form.Item>
            <Form.Item label="周期" name="interval">
              <Select options={INTERVAL_OPTIONS} style={{ width: 140 }} />
            </Form.Item>
            <Form.Item label="日期范围" name="dateRange">
              <RangePicker
                allowEmpty={[true, true]}
                style={{ width: 260 }}
                presets={[
                  { label: '今年', value: [dayjs().startOf('year'), dayjs()] },
                  { label: '近一年', value: [dayjs().subtract(1, 'year'), dayjs()] },
                ]}
              />
            </Form.Item>
          </Space>

          <Space wrap>
            <Button
              type="primary"
              icon={<SearchOutlined />}
              loading={previewing}
              onClick={handlePreview}
            >
              预览命中数量
            </Button>
            <Button
              danger
              icon={<DeleteOutlined />}
              disabled={!canDelete}
              loading={deleting}
              onClick={handleDelete}
            >
              删除命中K线
            </Button>
          </Space>
        </Form>

        {preview && (
          <Statistic
            title="当前过滤条件命中"
            value={previewCount}
            suffix="根K线"
          />
        )}
      </Space>

      <Modal
        title="确认删除K线"
        open={Boolean(pendingDelete)}
        okText="确认删除"
        cancelText="取消"
        okButtonProps={{ danger: true, loading: deleting }}
        onOk={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      >
        <Space direction="vertical" size="small">
          <Text>将删除当前过滤条件命中的 {pendingDelete?.count || 0} 根K线。</Text>
          <Text type="secondary">
            {pendingDeleteFilterText}
          </Text>
        </Space>
      </Modal>
    </Card>
  );
}

export default KlineCleanupSettings;
