import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import PromptSettings from '../PromptSettings';
import {
  fetchOpenAIPromptSettings,
  resetOpenAIPromptSettings,
  updateOpenAIPromptSettings,
} from '../../services/api';

jest.mock('../../services/api', () => ({
  fetchOpenAIPromptSettings: jest.fn(),
  resetOpenAIPromptSettings: jest.fn(),
  updateOpenAIPromptSettings: jest.fn(),
}));

describe('PromptSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchOpenAIPromptSettings.mockResolvedValue({
      settings: {
        systemPrompt: '系统默认',
        userPromptTemplate: '输入：{{processedText}}',
        sources: {
          systemPrompt: 'default',
          userPromptTemplate: 'database',
        },
      },
    });
    updateOpenAIPromptSettings.mockResolvedValue({
      settings: {
        systemPrompt: '系统修改',
        userPromptTemplate: '新规则 {{processedText}}',
        sources: {
          systemPrompt: 'database',
          userPromptTemplate: 'database',
        },
      },
    });
    resetOpenAIPromptSettings.mockResolvedValue({
      settings: {
        systemPrompt: '系统默认',
        userPromptTemplate: '输入：{{processedText}}',
        sources: {
          systemPrompt: 'default',
          userPromptTemplate: 'default',
        },
      },
    });
  });

  test('loads and saves prompt settings', async () => {
    render(<PromptSettings />);

    expect(await screen.findByDisplayValue('系统默认')).toBeInTheDocument();
    expect(screen.getByDisplayValue('输入：{{processedText}}')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('System Prompt'), {
      target: { value: '系统修改' },
    });
    fireEvent.change(screen.getByLabelText('用户 Prompt 模板'), {
      target: { value: '新规则 {{processedText}}' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存AI解析Prompt' }));

    await waitFor(() => {
      expect(updateOpenAIPromptSettings).toHaveBeenCalledWith({
        systemPrompt: '系统修改',
        userPromptTemplate: '新规则 {{processedText}}',
      });
    });
  });
});
