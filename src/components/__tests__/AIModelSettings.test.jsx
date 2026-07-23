import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AIModelSettings from '../AIModelSettings';
import {
  fetchOpenAIModelSettings,
  resetOpenAIModelSettings,
  updateOpenAIModelSettings,
} from '../../services/api';

jest.mock('../../services/api', () => ({
  fetchOpenAIModelSettings: jest.fn(),
  resetOpenAIModelSettings: jest.fn(),
  updateOpenAIModelSettings: jest.fn(),
}));

describe('AIModelSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchOpenAIModelSettings.mockResolvedValue({
      settings: {
        provider: 'openai',
        baseURL: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        apiKeyConfigured: true,
        sources: {
          provider: 'default',
          baseURL: 'default',
          model: 'default',
          apiKey: 'env',
        },
      },
    });
    updateOpenAIModelSettings.mockImplementation(async payload => ({
      settings: {
        ...payload,
        apiKey: undefined,
        apiKeyConfigured: Boolean(payload.apiKey),
        sources: {
          provider: 'database',
          baseURL: 'database',
          model: 'database',
          apiKey: 'database',
        },
      },
    }));
    resetOpenAIModelSettings.mockResolvedValue({ settings: {} });
  });

  test('switches to DeepSeek presets and saves a database override', async () => {
    render(<AIModelSettings />);

    expect(await screen.findByDisplayValue('https://api.openai.com/v1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'DeepSeek' }));

    expect(screen.getByDisplayValue('https://api.deepseek.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('deepseek-v4-flash')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('API Key'), {
      target: { value: 'sk-deepseek-secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存AI模型设置' }));

    await waitFor(() => {
      expect(updateOpenAIModelSettings).toHaveBeenCalledWith({
        provider: 'deepseek',
        baseURL: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash',
        apiKey: 'sk-deepseek-secret',
      });
    });
  });
});
