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
      
      // 从localStorage获取缓存数据以快速显示，同时异步获取最新数据
      const cachedFavorites = JSON.parse(localStorage.getItem('favoriteCrypto') || '[]');
      setFavorites(cachedFavorites);
      
      // 从服务器获取最新数据
      const serverFavorites = await fetchFavorites(forceRefresh);
      setFavorites(serverFavorites);
    } catch (err) {
      // 如果API请求失败，使用本地缓存
      const cachedFavorites = JSON.parse(localStorage.getItem('favoriteCrypto') || '[]');
      setFavorites(cachedFavorites);
      
      // 设置错误信息
      setError(err.displayMessage || err.message || '获取收藏失败');
      console.error('Error loading favorites:', err);
    } finally {
      setLoading(false);
    }
  }, []);
  
  // 切换收藏状态
  const handleToggleFavorite = useCallback(async (symbol) => {
    if (!symbol) return;

    const isCurrentlyFavorited = favorites.includes(symbol);

    console.log(`[收藏操作] 开始切换 ${symbol}, 当前状态: ${isCurrentlyFavorited ? '已收藏' : '未收藏'}`);

    // 乐观更新UI
    const newFavorites = isCurrentlyFavorited
      ? favorites.filter(s => s !== symbol)
      : [...favorites, symbol];

    console.log(`[收藏操作] 乐观更新UI: ${symbol} -> ${!isCurrentlyFavorited ? '已收藏' : '未收藏'}`);

    setFavorites(newFavorites);
    localStorage.setItem('favoriteCrypto', JSON.stringify(newFavorites));

    // 异步更新服务器，但不等待结果
    toggleFavorite(symbol)
      .then(() => {
        console.log(`[收藏操作] 服务器API调用成功: ${symbol}`);
      })
      .catch((err) => {
        console.error(`[收藏操作] 服务器API调用失败，但UI已更新: ${symbol}`, err);
        // 不回滚UI，因为用户已经看到了变化
      });

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