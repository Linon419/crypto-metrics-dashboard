import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import LogoSettings from '../LogoSettings';
import { getLogoSettings, updateLogoSettings } from '../../services/api';

jest.mock('../../services/api', () => ({
  getLogoSettings: jest.fn(),
  updateLogoSettings: jest.fn(),
}));

describe('LogoSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.runtimeConfig = { API_BASE_URL: '/api', BRANDFETCH_CLIENT_ID: 'env-client' };
  });

  afterEach(() => {
    delete window.runtimeConfig;
  });

  test('saves a Brandfetch client id and applies it without reloading', async () => {
    getLogoSettings.mockResolvedValue({
      success: true,
      settings: { brandfetchClientId: '', envConfigured: true, effectiveBrandfetchClientId: 'env-client', source: 'env' },
    });
    updateLogoSettings.mockResolvedValue({
      success: true,
      settings: { brandfetchClientId: '1idNew', envConfigured: true, effectiveBrandfetchClientId: '1idNew', source: 'settings' },
    });

    render(<LogoSettings />);

    expect(await screen.findByText('环境变量')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Brandfetch Client ID'), { target: { value: ' 1idNew ' } });
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => expect(updateLogoSettings).toHaveBeenCalledWith({ brandfetchClientId: '1idNew' }));
    expect(await screen.findByText('网页配置')).toBeInTheDocument();
    expect(window.runtimeConfig.BRANDFETCH_CLIENT_ID).toBe('1idNew');
    expect(window.runtimeConfig.API_BASE_URL).toBe('/api');
  });

  test('clearing falls back to the environment variable', async () => {
    getLogoSettings.mockResolvedValue({
      success: true,
      settings: { brandfetchClientId: '1idOld', envConfigured: true, effectiveBrandfetchClientId: '1idOld', source: 'settings' },
    });
    updateLogoSettings.mockResolvedValue({
      success: true,
      settings: { brandfetchClientId: '', envConfigured: true, effectiveBrandfetchClientId: 'env-client', source: 'env' },
    });

    render(<LogoSettings />);

    expect(await screen.findByDisplayValue('1idOld')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /清空并使用环境变量/ }));

    await waitFor(() => expect(updateLogoSettings).toHaveBeenCalledWith({ brandfetchClientId: '' }));
    expect(await screen.findByText('环境变量')).toBeInTheDocument();
    expect(window.runtimeConfig.BRANDFETCH_CLIENT_ID).toBe('env-client');
  });

  test('rejects invalid characters before calling the API', async () => {
    getLogoSettings.mockResolvedValue({
      success: true,
      settings: { brandfetchClientId: '', envConfigured: false, effectiveBrandfetchClientId: '', source: 'none' },
    });

    render(<LogoSettings />);

    expect(await screen.findByText('未配置')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Brandfetch Client ID'), { target: { value: 'abc?x=1' } });
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    expect(await screen.findByText(/只能包含字母、数字、下划线和短横线/)).toBeInTheDocument();
    expect(updateLogoSettings).not.toHaveBeenCalled();
  });
});
