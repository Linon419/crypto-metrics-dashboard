import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  fetchUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/api';

const { Text } = Typography;
const POLL_INTERVAL_MS = 60 * 1000;
const PAGE_SIZE = 40;

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

// 一期摘要合并为一条，命中了哪些分组就各显示一个分类标签
function getNotificationCategories(notification) {
  const groups = Array.isArray(notification.metadata?.groups) ? notification.metadata.groups : [];
  const categories = groups.map(group => group.category).filter(category => CATEGORY_META[category]);
  return categories.length > 0 ? [...new Set(categories)] : [notification.category];
}

function getNotificationCoins(notification) {
  if (notification.coinSymbol) return notification.coinSymbol;
  const coins = Array.isArray(notification.metadata?.coins) ? notification.metadata.coins : [];
  return coins.join('、');
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
  const [loadingMore, setLoadingMore] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState('');
  const openRef = useRef(false);
  const unreadCountRef = useRef(0);

  const applyUnreadCount = useCallback((value) => {
    const count = Number(value) || 0;
    unreadCountRef.current = count;
    setUnreadCount(count);
  }, []);

  // 列表只在抽屉打开时拉取第一页
  const loadNotifications = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    try {
      const result = await fetchNotifications({ limit: PAGE_SIZE });
      setNotifications(Array.isArray(result.notifications) ? result.notifications : []);
      setHasMore(Boolean(result.hasMore));
      applyUnreadCount(result.unreadCount);
      setError('');
    } catch {
      setError('通知暂时无法加载');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [applyUnreadCount]);

  const loadMore = async () => {
    const lastId = notifications[notifications.length - 1]?.id;
    if (!lastId) return;

    setLoadingMore(true);
    try {
      const result = await fetchNotifications({ limit: PAGE_SIZE, beforeId: lastId });
      const olderItems = Array.isArray(result.notifications) ? result.notifications : [];
      setNotifications(current => [...current, ...olderItems]);
      setHasMore(Boolean(result.hasMore));
      setError('');
    } catch {
      setError('更早的通知暂时无法加载');
    } finally {
      setLoadingMore(false);
    }
  };

  // 抽屉关着时只轮询未读数；打开时未读数变了才重拉列表
  const refreshUnreadCount = useCallback(async () => {
    try {
      const result = await fetchUnreadNotificationCount();
      const nextCount = Number(result.unreadCount) || 0;
      const changed = nextCount !== unreadCountRef.current;
      applyUnreadCount(nextCount);
      if (openRef.current && changed) loadNotifications({ silent: true });
    } catch {
      // 未读数刷新失败不打扰用户，下一轮再试
    }
  }, [applyUnreadCount, loadNotifications]);

  // 标签页隐藏时不轮询；切回前台立即刷新一次
  useEffect(() => {
    refreshUnreadCount();
    const timer = window.setInterval(() => {
      if (!document.hidden) refreshUnreadCount();
    }, POLL_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (!document.hidden) refreshUnreadCount();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshUnreadCount]);

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
    applyUnreadCount(Math.max(0, unreadCountRef.current - 1));

    try {
      await markNotificationRead(notification.id);
    } catch {
      await loadNotifications({ silent: true });
    }
  };

  const handleReadAll = async () => {
    const readAt = new Date().toISOString();
    setNotifications(current => current.map(item => ({ ...item, readAt: item.readAt || readAt })));
    applyUnreadCount(0);

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
              openRef.current = true;
              setOpen(true);
              loadNotifications({ silent: notifications.length > 0 });
            }}
          />
        </Badge>
      </Tooltip>

      <Drawer
        className="notification-drawer"
        width="min(430px, 100vw)"
        placement="right"
        open={open}
        onClose={() => {
          openRef.current = false;
          setOpen(false);
        }}
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
              const categories = getNotificationCategories(notification)
                .map(key => ({ key, ...(CATEGORY_META[key] || CATEGORY_META.market) }));
              const coins = getNotificationCoins(notification);
              const unread = !notification.readAt;
              return (
                <button
                  type="button"
                  className={`notification-ledger__item${unread ? ' is-unread' : ''}${notification.priority === 'high' ? ' is-high' : ''}${notification.priority === 'critical' ? ' is-critical' : ''}`}
                  style={{ '--notification-index': index }}
                  key={notification.id}
                  aria-label={`标记 ${notification.title} 为已读`}
                  onClick={() => handleRead(notification)}
                >
                  <span className="notification-ledger__rail" aria-hidden="true" />
                  <span className="notification-ledger__content">
                    <span className="notification-ledger__meta">
                      {categories.map(category => (
                        <Tag color={category.tone} key={category.key}>{category.label}</Tag>
                      ))}
                      {coins && <span>{coins}</span>}
                      <time>{formatNotificationTime(notification.createdAt)}</time>
                    </span>
                    <strong>{notification.title}</strong>
                    <span className="notification-ledger__body">{getNotificationBody(notification)}</span>
                  </span>
                  {unread && <span className="notification-ledger__unread" aria-label="未读" />}
                </button>
              );
            })}
            {hasMore && (
              <Button block type="text" loading={loadingMore} onClick={loadMore}>
                加载更多
              </Button>
            )}
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
