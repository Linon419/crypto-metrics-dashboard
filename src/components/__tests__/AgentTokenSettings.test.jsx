import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AgentTokenSettings from '../AgentTokenSettings';
import {
  createAgentToken,
  listAgentTokens,
  revokeAgentToken,
} from '../../services/api';

jest.mock('../../services/api', () => ({
  createAgentToken: jest.fn(),
  listAgentTokens: jest.fn(),
  revokeAgentToken: jest.fn(),
}));

const readerToken = {
  id: 'r1',
  name: 'MacBook',
  last4: 'wxyz',
  canWrite: false,
  createdAt: '2026-09-28T04:00:00.000Z',
  createdBy: 'admin',
};

describe('AgentTokenSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('creates an additional write-enabled token and shows the plaintext once', async () => {
    listAgentTokens.mockResolvedValue({ success: true, tokens: [readerToken] });
    createAgentToken.mockResolvedValue({
      success: true,
      token: 'cmagent_secret-value-abcd',
      tokenInfo: {
        id: 'w1',
        name: 'Codex',
        last4: 'abcd',
        canWrite: true,
        createdAt: '2026-11-01T04:00:00.000Z',
        createdBy: 'admin',
      },
    });

    render(<AgentTokenSettings />);

    expect(await screen.findByText('MacBook')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/名称/), { target: { value: ' Codex ' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '允许写入数据' }));
    fireEvent.click(screen.getByRole('button', { name: /生成 Token/ }));

    await waitFor(() => expect(createAgentToken).toHaveBeenCalledWith({ name: 'Codex', canWrite: true }));
    expect(await screen.findByText('cmagent_secret-value-abcd')).toBeInTheDocument();
    expect(screen.getByText(/只显示这一次/)).toBeInTheDocument();
    // 原有 Token 保留，新 Token 追加到列表
    expect(screen.getByText('MacBook')).toBeInTheDocument();
    expect(screen.getByText('Codex')).toBeInTheDocument();
    expect(screen.getByText('读取 + 写入数据')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '允许写入数据' })).not.toBeChecked();
  });

  test('confirms before revoking one token and keeps the others', async () => {
    listAgentTokens.mockResolvedValue({
      success: true,
      tokens: [readerToken, { ...readerToken, id: 'r2', name: 'iMac', last4: 'mnop' }],
    });
    revokeAgentToken.mockResolvedValue({ success: true, tokenInfo: readerToken });

    render(<AgentTokenSettings />);

    expect(await screen.findByText('MacBook')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /吊销/ })[0]);
    expect(await screen.findByText('确认吊销 Agent Token')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认吊销' }));

    await waitFor(() => expect(revokeAgentToken).toHaveBeenCalledWith('r1'));
    await waitFor(() => expect(screen.queryByText('MacBook')).not.toBeInTheDocument());
    expect(screen.getByText('iMac')).toBeInTheDocument();
  });
});
