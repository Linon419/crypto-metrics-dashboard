import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { message } from 'antd';
import DataInputForm from '../DataInputForm';
import {
  fetchOpenAIModelSettings,
  submitRawData,
} from '../../services/api';

jest.mock('../../services/api', () => ({
  exportAllData: jest.fn(),
  fetchOpenAIModelSettings: jest.fn(),
  importDatabaseDump: jest.fn(),
  submitRawData: jest.fn(),
}));

jest.mock('../DateDataManagement', () => () => <div>日期数据管理</div>);

function importJsonFile(jsonData) {
  const fileInput = screen.getByLabelText('导入 JSON 文件');
  const file = new File([JSON.stringify(jsonData)], 'backup.json', { type: 'application/json' });
  fireEvent.change(fileInput, { target: { files: [file] } });
}

describe('DataInputForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(message, 'success').mockImplementation(() => {});
    jest.spyOn(message, 'warning').mockImplementation(() => {});
    jest.spyOn(message, 'error').mockImplementation(() => {});
    fetchOpenAIModelSettings.mockResolvedValue({
      settings: {
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        sources: { model: 'database' },
      },
    });
    submitRawData.mockResolvedValue({ success: true });
  });

  test('uses the Admin model configuration for data parsing', async () => {
    render(<DataInputForm />);

    expect(await screen.findByText('deepseek-v4-flash')).toBeInTheDocument();
    expect(screen.getByText('DeepSeek')).toBeInTheDocument();
    expect(screen.queryByText('选择AI解析模型')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('原始数据粘贴区'), {
      target: { value: '5.9\nBTC 场外指数1200' },
    });
    fireEvent.click(screen.getByRole('button', { name: /处理并提交数据/ }));

    await waitFor(() => expect(submitRawData).toHaveBeenCalledTimes(1));
    expect(submitRawData.mock.calls[0]).toHaveLength(1);
  });

  // 回归：导出写的是 latestProcessedData，旧代码却读 latestData，导致这个按钮永远走不通
  test('extracts the latest sample from a database backup into the form', async () => {
    render(<DataInputForm />);
    await screen.findByText('deepseek-v4-flash');

    importJsonFile({
      metadata: { exportDate: '2026-06-18T00:00:00.000Z' },
      allCoinsInfo: [{ symbol: 'BTC' }],
      allHistoricalMetricsRaw: [{ date: '2026-06-18' }],
      latestProcessedData: {
        date: '2026-06-18',
        coins: [
          {
            symbol: 'BTC',
            otcIndex: 1627,
            explosionIndex: 195,
            schellingPoint: 98500,
            entryExitType: 'entry',
            entryExitDay: 26,
          },
        ],
      },
    });

    expect(await screen.findByText('数据库备份文件预览')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '仅提取最新示例到表单' }));

    await waitFor(() => expect(screen.getByLabelText('原始数据粘贴区')).toHaveValue(
      '2026-06-18\nBTC 场外指数1627场外进场期第26天\n爆破指数195\n谢林点 98500'
    ));
    expect(message.success).toHaveBeenCalledWith('已导入最新示例数据到表单。');
  });

  // 回归：antd 5 已移除 message.warn，旧代码在这里抛 TypeError，预览模态框再也关不掉
  test('warns instead of crashing when the backup has no importable sample', async () => {
    render(<DataInputForm />);
    await screen.findByText('deepseek-v4-flash');

    importJsonFile({
      metadata: { exportDate: '2026-06-18T00:00:00.000Z' },
      allCoinsInfo: [],
      allHistoricalMetricsRaw: [],
    });

    expect(await screen.findByText('数据库备份文件预览')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '仅提取最新示例到表单' }));

    expect(message.warning).toHaveBeenCalledWith('无法从该文件导入示例数据到表单。');
    expect(screen.getByLabelText('原始数据粘贴区')).toHaveValue('');
  });

  test('extracts a simple-format json into the form', async () => {
    render(<DataInputForm />);
    await screen.findByText('deepseek-v4-flash');

    importJsonFile({
      date: '2026-06-18',
      coins: [
        {
          symbol: 'ETH',
          otcIndex: 1200,
          explosionIndex: 210,
          schellingPoint: 3200,
          entryExitType: 'exit',
          entryExitDay: 3,
        },
      ],
    });

    expect(await screen.findByText('简化格式JSON预览')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '提取数据到表单' }));

    await waitFor(() => expect(screen.getByLabelText('原始数据粘贴区')).toHaveValue(
      '2026-06-18\nETH 场外指数1200场外退场期第3天\n爆破指数210\n谢林点 3200'
    ));
  });
});
