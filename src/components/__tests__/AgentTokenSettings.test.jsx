import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AgentTokenSettings from '../AgentTokenSettings';
import {
  createAgentToken,
  getAgentTokenStatus,
  revokeAgentToken,
} from '../../services/api';

jest.mock('../../services/api', () => ({
  createAgentToken: jest.fn(),
  getAgentTokenStatus: jest.fn(),
  revokeAgentToken: jest.fn(),
}));

describe('AgentTokenSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('generates a token and shows the plaintext once', async () => {
    getAgentTokenStatus.mockResolvedValue({ success: true, status: { active: false } });
    createAgentToken.mockResolvedValue({
      success: true,
      token: 'cmagent_secret-value-abcd',
      status: { active: true, last4: 'abcd', createdAt: '2026-09-28T04:00:00.000Z', createdBy: 'admin' },
    });

    render(<AgentTokenSettings />);

    expect(await screen.findByText('未启用')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /生成 Token/ }));

    await waitFor(() => expect(createAgentToken).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('cmagent_secret-value-abcd')).toBeInTheDocument();
    expect(screen.getByText(/只显示这一次/)).toBeInTheDocument();
    expect(screen.getByText(/已启用/)).toBeInTheDocument();
  });

  test('confirms before revoking an active token', async () => {
    getAgentTokenStatus.mockResolvedValue({
      success: true,
      status: { active: true, last4: 'wxyz', createdAt: '2026-09-28T04:00:00.000Z', createdBy: 'admin' },
    });
    revokeAgentToken.mockResolvedValue({ success: true, status: { active: false } });

    render(<AgentTokenSettings />);

    expect(await screen.findByText(/wxyz/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /吊销/ }));
    expect(await screen.findByText('确认吊销 Agent Token')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认吊销' }));

    await waitFor(() => expect(revokeAgentToken).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('未启用')).toBeInTheDocument();
  });
});
