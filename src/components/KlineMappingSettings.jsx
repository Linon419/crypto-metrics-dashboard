import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Flex,
  Input,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CloudSyncOutlined,
  ReloadOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import {
  fetchKlineMappings,
  seedDefaultKlineMappings,
  updateKlineMapping,
} from '../services/api';

const { Text, Title } = Typography;

const MARKET_OPTIONS = [
  { value: 'binance_usdm_perpetual', label: 'Binance U 本位' },
  { value: 'binance_spot', label: 'Binance 现货' },
  { value: 'yahoo_finance', label: 'Yahoo Finance' },
  { value: 'deribit_btc_dvol', label: 'Deribit BTC DVOL' },
  { value: 'china_futures_sina', label: '新浪国内期货' },
];

const MARKET_LABELS = MARKET_OPTIONS.reduce((labels, option) => ({
  ...labels,
  [option.value]: option.label,
}), {});

const BINANCE_MARKETS = new Set(['binance_usdm_perpetual', 'binance_spot']);

function isBinanceMarket(market) {
  return BINANCE_MARKETS.has(market);
}

export function normalizeBinanceTradingSymbol(symbol) {
  const normalized = String(symbol || '').trim().toUpperCase();
  if (!normalized) return '';
  return normalized.endsWith('USDT') ? normalized : `${normalized}USDT`;
}

export function getTradingSymbolForMarket(row, market) {
  if (!isBinanceMarket(market)) {
    return row.tradingSymbol || '';
  }

  const baseSymbol = isBinanceMarket(row.market) && row.tradingSymbol
    ? row.tradingSymbol
    : row.coinSymbol;
  return normalizeBinanceTradingSymbol(baseSymbol);
}

function buildSavePayload(row) {
  const tradingSymbol = isBinanceMarket(row.market)
    ? normalizeBinanceTradingSymbol(row.tradingSymbol || row.coinSymbol)
    : row.tradingSymbol;

  return {
    market: row.market,
    trading_symbol: tradingSymbol,
    enabled: row.enabled,
    notes: row.notes,
  };
}

function normalizeRows(rows = []) {
  return rows.map(row => ({
    ...row,
    key: row.coinId,
    tradingSymbol: row.tradingSymbol || '',
    notes: row.notes || '',
    enabled: row.enabled !== false,
  }));
}

function KlineMappingSettings() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  // 用 Set 跟踪在途保存：单槽位会让先保存的 BTC 的 finally 清掉后保存的 ETH 的 spinner
  const [savingCoinIds, setSavingCoinIds] = useState(() => new Set());
  const [savingAll, setSavingAll] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const loadMappings = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchKlineMappings();
      setRows(normalizeRows(response.mappings || []));
    } catch (error) {
      message.error(`加载K线映射失败：${error.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMappings();
  }, [loadMappings]);

  const updateRow = useCallback((coinId, patch) => {
    setRows(currentRows => currentRows.map(row => (
      row.coinId === coinId ? { ...row, ...patch } : row
    )));
  }, []);

  const handleMarketChange = useCallback((row, market) => {
    updateRow(row.coinId, {
      market,
      tradingSymbol: getTradingSymbolForMarket(row, market),
    });
  }, [updateRow]);

  const markSaving = useCallback((coinId, busy) => {
    setSavingCoinIds((current) => {
      const next = new Set(current);
      if (busy) next.add(coinId);
      else next.delete(coinId);
      return next;
    });
  }, []);

  const handleSave = useCallback(async (row) => {
    markSaving(row.coinId, true);
    try {
      const response = await updateKlineMapping(row.coinId, buildSavePayload(row));
      const updated = normalizeRows([response.mapping])[0];
      updateRow(row.coinId, updated);
      message.success(`${row.coinSymbol} K线映射已保存`);
    } catch (error) {
      message.error(`保存失败：${error.message}`);
    } finally {
      markSaving(row.coinId, false);
    }
  }, [markSaving, updateRow]);

  const handleSaveAll = useCallback(async () => {
    setSavingAll(true);
    const snapshot = rows;
    const savedByCoinId = new Map();
    const failures = [];

    try {
      for (const row of snapshot) {
        try {
          const response = await updateKlineMapping(row.coinId, buildSavePayload(row));
          savedByCoinId.set(row.coinId, response.mapping);
        } catch (error) {
          // 单行失败会记录错误，同时保留前面已经保存成功的行
          failures.push(`${row.coinSymbol}：${error.message}`);
        }
      }

      // 成功的行用服务端返回值覆盖，失败的行保留用户当前输入
      setRows(currentRows => normalizeRows(currentRows.map(row => (
        savedByCoinId.has(row.coinId) ? { ...row, ...savedByCoinId.get(row.coinId) } : row
      ))));

      if (failures.length === 0) {
        message.success(`已保存 ${savedByCoinId.size} 条K线映射`);
      } else {
        message.warning(
          `已保存 ${savedByCoinId.size} 条，${failures.length} 条失败：${failures.join('；')}`,
          8,
        );
      }
    } finally {
      setSavingAll(false);
    }
  }, [rows]);

  const handleSeedDefaults = useCallback(async () => {
    setSeeding(true);
    try {
      const response = await seedDefaultKlineMappings();
      message.success(`已补齐 ${response.created || 0} 条默认映射`);
      await loadMappings();
    } catch (error) {
      message.error(`补齐失败：${error.message}`);
    } finally {
      setSeeding(false);
    }
  }, [loadMappings]);

  const columns = useMemo(() => [
    {
      title: '币种',
      dataIndex: 'coinSymbol',
      key: 'coinSymbol',
      width: 180,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Text strong>{row.coinSymbol}</Text>
          <Text type="secondary">{row.coinName}</Text>
        </Space>
      ),
    },
    {
      title: '来源',
      dataIndex: 'market',
      key: 'market',
      width: 210,
      render: (_, row) => (
        <Select
          aria-label={`${row.coinSymbol} 来源`}
          value={row.market}
          options={MARKET_OPTIONS}
          disabled={savingAll}
          onChange={(market) => handleMarketChange(row, market)}
          style={{ width: 180 }}
        />
      ),
    },
    {
      title: '映射代码',
      dataIndex: 'tradingSymbol',
      key: 'tradingSymbol',
      width: 220,
      render: (_, row) => (
        <Input
          value={row.tradingSymbol}
          disabled={savingAll}
          onChange={(event) => updateRow(row.coinId, { tradingSymbol: event.target.value })}
          placeholder="例如 159819.SZ"
        />
      ),
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 100,
      render: (_, row) => (
        <Switch
          checked={row.enabled}
          disabled={savingAll}
          onChange={(enabled) => updateRow(row.coinId, { enabled })}
        />
      ),
    },
    {
      title: '备注',
      dataIndex: 'notes',
      key: 'notes',
      render: (_, row) => (
        <Input
          value={row.notes}
          disabled={savingAll}
          onChange={(event) => updateRow(row.coinId, { notes: event.target.value })}
          placeholder="备注"
        />
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 180,
      render: (_, row) => (
        <Space direction="vertical" size={4}>
          <Tag color={row.isDefault ? 'blue' : 'green'}>
            {row.isDefault ? '默认' : '已配置'}
          </Tag>
          <Text type="secondary">{MARKET_LABELS[row.market] || row.market}</Text>
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      fixed: 'right',
      render: (_, row) => (
        <Button
          aria-label={`保存 ${row.coinSymbol}`}
          type="primary"
          icon={<SaveOutlined />}
          loading={savingCoinIds.has(row.coinId)}
          disabled={savingAll}
          onClick={() => handleSave(row)}
        >
          保存
        </Button>
      ),
    },
  ], [handleMarketChange, handleSave, savingAll, savingCoinIds, updateRow]);

  return (
    <div className="kline-mapping-settings">
      <Card>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          {/* Space 没有 justify，属性会直接漏到 DOM 上；右对齐要用 Flex */}
          <Flex align="start" justify="space-between" gap="middle" wrap style={{ width: '100%' }}>
            <div>
              <Text type="secondary">ADMIN SETTINGS</Text>
              <Title level={3}>K线映射设置</Title>
            </div>
            <Space>
              <Button icon={<ReloadOutlined />} onClick={loadMappings} loading={loading}>
                刷新
              </Button>
              <Button
                aria-label="保存全部K线映射"
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSaveAll}
                loading={savingAll}
                disabled={rows.length === 0}
              >
                保存全部
              </Button>
              <Button
                aria-label="补齐默认映射"
                icon={<CloudSyncOutlined />}
                onClick={handleSeedDefaults}
                loading={seeding}
              >
                补齐默认映射
              </Button>
            </Space>
          </Flex>

          <Alert
            type="info"
            showIcon
            message="这里设置 dashboard 币种和实际 K 线交易代码的关系。保存后会影响后续 K 线刷新和回补。"
          />

          <Table
            rowKey="coinId"
            loading={loading}
            dataSource={rows}
            columns={columns}
            pagination={{ pageSize: 20, showSizeChanger: true }}
            scroll={{ x: 1180 }}
          />
        </Space>
      </Card>
    </div>
  );
}

export default KlineMappingSettings;
