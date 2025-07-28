// src/hooks/useFavorites.js
import { useState, useEffect, useCallback } from 'react';
import { fetchFavorites, toggleFavorite } from '../services/api';

/**
 * 收藏功能Hook，用于管理币种收藏状态
 * @returns {Object} 收藏状态和操作函数
 */
export const useFavorites = () => {
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // 加载收藏列表
  const loadFavorites = useCallback(async (forceRefresh = false) => {
    try {
      setLoading(true);
      setError(null);

      // 从localStorage获取缓存数据以快速显示
      const cachedFavorites = JSON.parse(localStorage.getItem('favoriteCrypto') || '[]');
      console.log('[收藏加载] 本地缓存数据:', cachedFavorites);
      setFavorites(cachedFavorites);

      // 从服务器获取最新数据
      console.log('[收藏加载] 开始从服务器获取数据...');
      const serverFavorites = await fetchFavorites(forceRefresh);
      console.log('[收藏加载] 服务器返回数据:', serverFavorites);

      // 只有当服务器数据有效时才更新
      if (Array.isArray(serverFavorites)) {
        setFavorites(serverFavorites);
        // 同步更新本地缓存
        localStorage.setItem('favoriteCrypto', JSON.stringify(serverFavorites));
      } else {
        console.warn('[收藏加载] 服务器返回无效数据，保持本地缓存');
      }
    } catch (err) {
      console.error('[收藏加载] 服务器请求失败:', err);

      // 如果API请求失败，使用本地缓存
      const cachedFavorites = JSON.parse(localStorage.getItem('favoriteCrypto') || '[]');
      setFavorites(cachedFavorites);

      // 设置错误信息
      setError(err.displayMessage || err.message || '获取收藏失败');
    } finally {
      setLoading(false);
    }
  }, []);
  
  // 切换收藏状态
  const handleToggleFavorite = useCallback(async (symbol) => {
    if (!symbol) return;

    const isCurrentlyFavorited = favorites.includes(symbol);
    const originalFavorites = [...favorites];

    console.log(`[收藏操作] 开始切换 ${symbol}, 当前状态: ${isCurrentlyFavorited ? '已收藏' : '未收藏'}`);

    // 乐观更新UI
    const newFavorites = isCurrentlyFavorited
      ? favorites.filter(s => s !== symbol)
      : [...favorites, symbol];

    console.log(`[收藏操作] 乐观更新UI: ${symbol} -> ${!isCurrentlyFavorited ? '已收藏' : '未收藏'}`);

    setFavorites(newFavorites);
    localStorage.setItem('favoriteCrypto', JSON.stringify(newFavorites));

    // 尝试更新服务器
    try {
      console.log(`[收藏操作] 开始调用服务器API: ${symbol}`);
      await toggleFavorite(symbol);
      console.log(`[收藏操作] 服务器API调用成功: ${symbol}`);

      // 成功后，确保本地缓存和UI状态一致
      localStorage.setItem('favoriteCrypto', JSON.stringify(newFavorites));

    } catch (err) {
      console.error(`[收藏操作] 服务器API调用失败: ${symbol}`, err);

      // 如果是网络错误或服务器错误，保持UI状态但显示警告
      if (err.message.includes('500') || err.message.includes('Network')) {
        console.warn(`[收藏操作] 服务器暂时不可用，收藏状态已保存到本地: ${symbol}`);
        // 保持UI状态，不回滚
      } else {
        // 其他错误，回滚UI状态
        console.log(`[收藏操作] 回滚UI状态: ${symbol}`);
        setFavorites(originalFavorites);
        localStorage.setItem('favoriteCrypto', JSON.stringify(originalFavorites));
        throw err;
      }
    }

  }, [favorites]);
  
  // 检查币种是否已收藏
  const isFavorite = useCallback((symbol) => {
    return favorites.includes(symbol);
  }, [favorites]);
  
  // 初始加载
  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);
  
  return {
    favorites,
    loading,
    error,
    toggleFavorite: handleToggleFavorite,
    isFavorite,
    refreshFavorites: () => loadFavorites(true)
  };
};

export default useFavorites;