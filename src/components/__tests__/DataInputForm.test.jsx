import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
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

describe('DataInputForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
