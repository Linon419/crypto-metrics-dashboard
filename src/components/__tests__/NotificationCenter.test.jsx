import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import NotificationCenter from '../NotificationCenter';
import {
  fetchNotifications,
  fetchUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../services/api';

jest.mock('../../services/api', () => ({
  fetchNotifications: jest.fn(),
  fetchUnreadNotificationCount: jest.fn(),
  markAllNotificationsRead: jest.fn(),
  markNotificationRead: jest.fn(),
}));

const firstPage = {
  notifications: [
    {
      id: 7,
      title: '高质量进场期初期',
      content: 'BTC · Bitcoin\n场外：1080\n质量：高质量进场',
      category: 'quality',
      priority: 'high',
      coinSymbol: 'BTC',
      readAt: null,
      createdAt: '2026-07-26T08:30:00.000Z',
    },
    {
      id: 6,
      title: '⭐ 收藏币种提醒 · 2026-07-26',
      content: 'SOL · Solana\n触发：进入退场期',
      category: 'favorite',
      priority: 'critical',
      coinSymbol: 'SOL',
      readAt: null,
      createdAt: '2026-07-26T08:00:00.000Z',
    },
  ],
  unreadCount: 2,
  hasMore: true,
};

function setDocumentHidden(hidden) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setDocumentHidden(false);
  fetchUnreadNotificationCount.mockResolvedValue({ success: true, unreadCount: 2 });
  fetchNotifications.mockResolvedValue(firstPage);
  markNotificationRead.mockResolvedValue({ success: true });
  markAllNotificationsRead.mockResolvedValue({ success: true, updatedCount: 1 });
});

test('shows Telegram notification content and supports read actions', async () => {
  render(<NotificationCenter />);

  const trigger = await screen.findByRole('button', { name: '打开通知中心，2 条未读' });
  // 抽屉关着时只查未读数，不拉整份列表
  expect(fetchNotifications).not.toHaveBeenCalled();

  fireEvent.click(trigger);

  expect(await screen.findByText('高质量进场期初期')).toBeInTheDocument();
  expect(fetchNotifications).toHaveBeenCalledWith({ limit: 40 });
  expect(screen.getByText(/场外：1080/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '标记 高质量进场期初期 为已读' }));
  await waitFor(() => expect(markNotificationRead).toHaveBeenCalledWith(7));

  fireEvent.click(screen.getByRole('button', { name: '全部已读' }));
  await waitFor(() => expect(markAllNotificationsRead).toHaveBeenCalledTimes(1));
});

test('marks critical notifications and loads older pages on demand', async () => {
  render(<NotificationCenter />);
  fireEvent.click(await screen.findByRole('button', { name: '打开通知中心，2 条未读' }));

  const critical = await screen.findByRole('button', { name: '标记 ⭐ 收藏币种提醒 · 2026-07-26 为已读' });
  expect(critical).toHaveClass('is-critical');

  fetchNotifications.mockResolvedValueOnce({
    notifications: [{
      id: 3,
      title: '更早的通知',
      content: 'ETH · Ethereum',
      category: 'market',
      priority: 'normal',
      readAt: '2026-07-20T00:00:00.000Z',
      createdAt: '2026-07-20T00:00:00.000Z',
    }],
    unreadCount: 2,
    hasMore: false,
  });
  fireEvent.click(screen.getByRole('button', { name: '加载更多' }));

  expect(await screen.findByText('更早的通知')).toBeInTheDocument();
  expect(fetchNotifications).toHaveBeenLastCalledWith({ limit: 40, beforeId: 6 });
  expect(screen.getByText('高质量进场期初期')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument();
});

test('shows one tag per group for a merged period summary', async () => {
  fetchNotifications.mockResolvedValueOnce({
    notifications: [{
      id: 11,
      title: '数据摘要 · 2026-07-26',
      content: '📊 市场重要变化\nBTC · Bitcoin\n\n⭐ 收藏币种提醒\nSOL · Solana',
      category: 'favorite',
      priority: 'critical',
      coinSymbol: null,
      readAt: null,
      createdAt: '2026-07-26T08:30:00.000Z',
      metadata: {
        dataDate: '2026-07-26',
        coins: ['BTC', 'SOL'],
        groups: [
          { type: 'market_changes', category: 'market', priority: 'high', coins: ['BTC'] },
          { type: 'favorite_alerts', category: 'favorite', priority: 'critical', coins: ['SOL'] },
          { type: 'strategy_signals', category: 'strategy', priority: 'normal', coins: ['BTC'] },
        ],
      },
    }],
    unreadCount: 1,
    hasMore: false,
  });

  render(<NotificationCenter />);
  fireEvent.click(await screen.findByRole('button', { name: '打开通知中心，2 条未读' }));

  const item = await screen.findByRole('button', { name: '标记 数据摘要 · 2026-07-26 为已读' });
  ['市场', '收藏', '策略'].forEach(label => {
    expect(within(item).getByText(label)).toBeInTheDocument();
  });
  expect(within(item).getByText('BTC、SOL')).toBeInTheDocument();
});

test('pauses unread polling while the tab is hidden and refreshes when it returns', async () => {
  jest.useFakeTimers();
  try {
    render(<NotificationCenter />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchUnreadNotificationCount).toHaveBeenCalledTimes(1);

    setDocumentHidden(true);
    await act(async () => {
      jest.advanceTimersByTime(5 * 60 * 1000);
      await Promise.resolve();
    });
    expect(fetchUnreadNotificationCount).toHaveBeenCalledTimes(1);

    setDocumentHidden(false);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(fetchUnreadNotificationCount).toHaveBeenCalledTimes(2);

    await act(async () => {
      jest.advanceTimersByTime(60 * 1000);
      await Promise.resolve();
    });
    expect(fetchUnreadNotificationCount).toHaveBeenCalledTimes(3);
  } finally {
    jest.useRealTimers();
  }
});
