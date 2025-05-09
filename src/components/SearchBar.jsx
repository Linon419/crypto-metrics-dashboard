// src/components/SearchBar.jsx - 改进版
import React, { useState, useEffect, useRef } from 'react';
import { Input, Divider } from 'antd';
import { SearchOutlined, StarFilled, StarOutlined } from '@ant-design/icons';

function SearchBar({ coins, onSelect, favorites = [], onToggleFavorite }) {
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
  
  // 筛选币种
  const filteredCoins = coins.filter(coin => 
    coin.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (coin.name && coin.name.toLowerCase().includes(searchTerm.toLowerCase()))
  );
  
  // 分离收藏币种
  const favoriteCoins = filteredCoins.filter(coin => favorites.includes(coin.symbol));
  const otherCoins = filteredCoins.filter(coin => !favorites.includes(coin.symbol));
  
  // 处理币种选择
  const handleCoinSelect = (coin) => {
    onSelect(coin);
    setIsDropdownOpen(false);
    setSearchTerm('');
  };
  
  // 处理收藏切换
  const handleFavoriteToggle = (e, symbol) => {
    e.stopPropagation();
    onToggleFavorite(symbol);
  };
  
  return (
    <div className="relative" ref={dropdownRef}>
      <div 
        className="bg-gray-800 rounded-md flex items-center p-2 cursor-pointer"
        onClick={() => setIsDropdownOpen(true)}
      >
        <SearchOutlined className="text-gray-400 mr-2" />
        <Input
          placeholder="搜索模型"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className="bg-transparent border-0 text-white placeholder-gray-500"
          style={{ width: '150px' }}
        />
      </div>
      
      {isDropdownOpen && (
        <div className="absolute top-full left-0 mt-1 w-64 max-h-96 overflow-y-auto bg-gray-800 rounded-md shadow-lg z-50">
          {/* 收藏币种 */}
          {favoriteCoins.length > 0 && (
            <>
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
                    <span className="text-white">{coin.symbol}</span>
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
                <span className="text-white">{coin.symbol}</span>
              </div>
              <StarOutlined 
                className="text-gray-400 hover:text-yellow-400 cursor-pointer" 
                onClick={(e) => handleFavoriteToggle(e, coin.symbol)}
              />
            </div>
          ))}
          
          {filteredCoins.length === 0 && (
            <div className="px-3 py-4 text-center text-gray-400">
              未找到匹配的币种
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// 获取币种颜色
function getCoinColor(symbol) {
  const colorMap = {
    'BTC': '#F7931A',
    'ETH': '#627EEA',
    'USDT': '#26A17B',
    'BNB': '#F3BA2F',
    'SOL': '#14F195',
    'DOGE': '#C2A633',
  };
  
  return colorMap[symbol] || '#6366f1';
}

export default SearchBar;