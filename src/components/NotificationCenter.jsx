import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Drawer, Empty, Spin, Tag, Tooltip, Typography } from 'antd';
import {
  BellOutlined,
  CheckOutlined,
  InboxOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/api';

const { Text } = Typography;
const POLL_INTERVAL_MS = 60 * 1000;

const CATEGORY_META = {
  market: { label: '市场', tone: 'gold' },
  quality: { label: '周期质量', tone: 'green' },
  strategy: { label: '策略', tone: 'blue' },
  momentum: { label: '动能', tone: 'volcano' },
  favorite: { label: '收藏', tone: 'magenta' },
  system: { label: '系统', tone: 'default' },
};

function getNotificationBody(notification) {
  const content = String(notification.content || '').trim();
  const title = String(notification.title || '').trim();
  return content.startsWith(title) ? content.slice(title.length).trim() : content;
}

function formatNotificationTime(value) {
  const timestamp = dayjs(value);
  if (!timestamp.isValid()) return '';
  return timestamp.format('MM-DD HH:mm');
}

function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState('');

  const loadNotifications = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    try {
      const result = await fetchNotifications({ limit: 40 });
      setNotifications(Array.isArray(result.notifications) ? result.notifications : []);
      setUnreadCount(Number(result.unreadCount) || 0);
      setError('');
    } catch {
      setError('通知暂时无法加载');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
    const timer = window.setInterval(() => loadNotifications({ silent: true }), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loadNotifications]);

  const ariaLabel = unreadCount > 0
    ? `打开通知中心，${unreadCount} 条未读`
    : '打开通知中心';
  const hasNotifications = notifications.length > 0;
  const timelineLabel = useMemo(() => (
    unreadCount > 0 ? `${unreadCount} 条信号待确认` : '当前信号已全部确认'
  ), [unreadCount]);

  const handleRead = async (notification) => {
    if (notification.readAt) return;

    const readAt = new Date().toISOString();
    setNotifications(current => current.map(item => (
      item.id === notification.id ? { ...item, readAt } : item
    )));
    setUnreadCount(current => Math.max(0, current - 1));

    try {
      await markNotificationRead(notification.id);
    } catch {
      await loadNotifications({ silent: true });
    }
  };

  const handleReadAll = async () => {
    const readAt = new Date().toISOString();
    setNotifications(current => current.map(item => ({ ...item, readAt: item.readAt || readAt })));
    setUnreadCount(0);

    try {
      await markAllNotificationsRead();
    } catch {
      await loadNotifications({ silent: true });
    }
  };

  return (
    <>
      <Tooltip title="通知中心">
        <Badge count={unreadCount} overflowCount={99} size="small" offset={[-2, 4]}>
          <Button
            type="text"
            className="notification-center__trigger"
            icon={<BellOutlined />}
            aria-label={ariaLabel}
            onClick={() => {
              setOpen(true);
              loadNotifications({ silent: true });
            }}
          />
        </Badge>
      </Tooltip>

      <Drawer
        className="notification-drawer"
        width="min(430px, 100vw)"
        placement="right"
        open={open}
        onClose={() => setOpen(false)}
        title={(
          <div className="notification-drawer__heading">
            <span className="notification-drawer__eyebrow">SIGNAL INBOX</span>
            <span>通知中心</span>
          </div>
        )}
      >
        <div className="notification-drawer__status">
          <div>
            <span className="notification-drawer__pulse" />
            <Text>{timelineLabel}</Text>
          </div>
          <div className="notification-drawer__actions">
            <Tooltip title="刷新通知">
              <Button
                type="text"
                icon={<ReloadOutlined spin={refreshing} />}
                aria-label="刷新通知"
                onClick={() => loadNotifications({ silent: true })}
              />
            </Tooltip>
            <Button
              type="text"
              icon={<CheckOutlined />}
              aria-label="全部已读"
              onClick={handleReadAll}
            >
              全部已读
            </Button>
          </div>
        </div>

        {error && <div className="notification-drawer__error">{error}</div>}

        {loading ? (
          <div className="notification-drawer__loading"><Spin /></div>
        ) : hasNotifications ? (
          <div className="notification-ledger">
            {notifications.map((notification, index) => {
              const category = CATEGORY_META[notification.category] || CATEGORY_META.market;
              const unread = !notification.readAt;
              return (
                <button
                  type="button"
                  className={`notification-ledger__item${unread ? ' is-unread' : ''}${notification.priority === 'high' ? ' is-high' : ''}`}
                  style={{ '--notification-index': index }}
                  key={notification.id}
                  aria-label={`标记 ${notification.title} 为已读`}
                  onClick={() => handleRead(notification)}
                >
                  <span className="notification-ledger__rail" aria-hidden="true" />
                  <span className="notification-ledger__content">
                    <span className="notification-ledger__meta">
                      <Tag color={category.tone}>{category.label}</Tag>
                      {notification.coinSymbol && <span>{notification.coinSymbol}</span>}
                      <time>{formatNotificationTime(notification.createdAt)}</time>
                    </span>
                    <strong>{notification.title}</strong>
                    <span className="notification-ledger__body">{getNotificationBody(notification)}</span>
                  </span>
                  {unread && <span className="notification-ledger__unread" aria-label="未读" />}
                </button>
              );
            })}
          </div>
        ) : (
          <Empty
            className="notification-drawer__empty"
            image={<InboxOutlined />}
            description="暂无 TG 通知"
          />
        )}
      </Drawer>
    </>
  );
}

export default NotificationCenter;
