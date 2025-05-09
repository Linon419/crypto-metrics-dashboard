// src/components/SearchBar.jsx - 增强版
import React, { useState, useEffect, useRef } from 'react';
import { Input, Divider, Typography, Skeleton } from 'antd';
import { SearchOutlined, StarFilled, StarOutlined, LoadingOutlined } from '@ant-design/icons';

const { Text } = Typography;

function SearchBar({ coins, onSelect, favorites = [], onToggleFavorite, loading = false }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  
  // 处理点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);
  
  // 筛选币种 - 确保大小写不敏感
  const filteredCoins = coins.filter(coin => {
    const search = searchTerm.toLowerCase();
    return (
      coin.symbol.toLowerCase().includes(search) ||
      (coin.name && coin.name.toLowerCase().includes(search))
    );
  });
  
  // 分离收藏币种
  const favoriteCoins = filteredCoins.filter(coin => favorites.includes(coin.symbol));
  const otherCoins = filteredCoins.filter(coin => !favorites.includes(coin.symbol));
  
  // 处理币种选择
  const handleCoinSelect = (coin) => {
    onSelect(coin.symbol);
    setIsDropdownOpen(false);
    setSearchTerm('');
  };
  
  // 处理收藏切换
  const handleFavoriteToggle = (e, symbol) => {
    e.stopPropagation();
    onToggleFavorite(symbol);
  };
  
  // 获取币种颜色
  const getCoinColor = (symbol) => {
    const colorMap = {
      'BTC': '#F7931A',
      'ETH': '#627EEA',
      'USDT': '#26A17B',
      'BNB': '#F3BA2F',
      'SOL': '#14F195',
      'DOGE': '#C2A633',
    };
    
    return colorMap[symbol] || '#6366f1';
  };
  
  return (
    <div className="relative" ref={dropdownRef}>
      <div 
        className="bg-gray-800 rounded-md flex items-center p-2 cursor-pointer"
        onClick={() => setIsDropdownOpen(true)}
      >
        {loading ? (
          <LoadingOutlined className="text-gray-400 mr-2" />
        ) : (
          <SearchOutlined className="text-gray-400 mr-2" />
        )}
        <Input
          placeholder="搜索币种..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onClick={(e) => {
            e.stopPropagation();
            setIsDropdownOpen(true);
          }}
          className="bg-transparent border-0 text-white placeholder-gray-500"
          style={{ width: '180px' }}
        />
      </div>
      
      {isDropdownOpen && (
        <div className="absolute top-full left-0 mt-1 w-64 max-h-96 overflow-y-auto bg-gray-800 rounded-md shadow-lg z-50">
          {loading ? (
            // 加载状态
            <div className="p-4">
              <Skeleton.Input active size="small" className="mb-2" style={{ width: '100%' }} />
              <Skeleton.Input active size="small" className="mb-2" style={{ width: '100%' }} />
              <Skeleton.Input active size="small" className="mb-2" style={{ width: '100%' }} />
            </div>
          ) : (
            <>
              {/* 搜索结果统计 */}
              <div className="px-3 py-2 text-gray-400 text-xs">
                找到 {filteredCoins.length} 个币种
                {searchTerm && <span> (搜索: "{searchTerm}")</span>}
              </div>
              
              {/* 收藏币种 */}
              {favoriteCoins.length > 0 && (
                <>
                  <div className="px-3 py-1 text-xs text-gray-400 font-medium">收藏币种</div>
                  {favoriteCoins.map((coin) => (
                    <div 
                      key={`fav-${coin.symbol}`}
                      className="flex items-center justify-between px-3 py-2 hover:bg-gray-700 cursor-pointer"
                      onClick={() => handleCoinSelect(coin)}
                    >
                      <div className="flex items-center">
                        <div 
                          className="w-6 h-6 rounded-full flex items-center justify-center mr-2 text-white"
                          style={{ backgroundColor: getCoinColor(coin.symbol) }}
                        >
                          {coin.symbol.charAt(0)}
                        </div>
                        <div>
                          <div className="text-white">{coin.symbol}</div>
                          {coin.otcIndex && (
                            <div className="text-xs text-blue-400">场外指数: {coin.otcIndex}</div>
                          )}
                        </div>
                      </div>
                      <StarFilled 
                        className="text-yellow-400 cursor-pointer" 
                        onClick={(e) => handleFavoriteToggle(e, coin.symbol)}
                      />
                    </div>
                  ))}
                  <Divider className="my-1 bg-gray-600" />
                </>
              )}
              
              {/* 其他币种 */}
              {otherCoins.length > 0 && (
                <>
                  {favoriteCoins.length > 0 && (
                    <div className="px-3 py-1 text-xs text-gray-400 font-medium">其他币种</div>
                  )}
                  {otherCoins.map((coin) => (
                    <div 
                      key={`other-${coin.symbol}`}
                      className="flex items-center justify-between px-3 py-2 hover:bg-gray-700 cursor-pointer"
                      onClick={() => handleCoinSelect(coin)}
                    >
                      <div className="flex items-center">
                        <div 
                          className="w-6 h-6 rounded-full flex items-center justify-center mr-2 text-white"
                          style={{ backgroundColor: getCoinColor(coin.symbol) }}
                        >
                          {coin.symbol.charAt(0)}
                        </div>
                        <div>
                          <div className="text-white">{coin.symbol}</div>
                          {coin.otcIndex && (
                            <div className="text-xs text-blue-400">场外指数: {coin.otcIndex}</div>
                          )}
                        </div>
                      </div>
                      <StarOutlined 
                        className="text-gray-400 hover:text-yellow-400 cursor-pointer" 
                        onClick={(e) => handleFavoriteToggle(e, coin.symbol)}
                      />
                    </div>
                  ))}
                </>
              )}
              
              {filteredCoins.length === 0 && (
                <div className="px-3 py-4 text-center text-gray-400">
                  未找到匹配的币种
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default SearchBar;