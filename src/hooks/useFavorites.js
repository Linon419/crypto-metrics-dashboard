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
    
    try {
      // 乐观更新UI
      const isCurrentlyFavorited = favorites.includes(symbol);
      const newFavorites = isCurrentlyFavorited
        ? favorites.filter(s => s !== symbol)
        : [...favorites, symbol];
      
      setFavorites(newFavorites);
      localStorage.setItem('favoriteCrypto', JSON.stringify(newFavorites));
      
      // 更新服务器
      await toggleFavorite(symbol);
    } catch (err) {
      console.error('Error toggling favorite:', err);
      // 发生错误时回滚UI并重新加载数据
      loadFavorites(true);
      throw err;
    }
  }, [favorites, loadFavorites]);
  
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