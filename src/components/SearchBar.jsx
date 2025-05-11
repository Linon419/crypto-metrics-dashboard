// src/components/SearchBar.jsx - Mobile-friendly version
import React, { useState, useEffect, useRef } from 'react';
import { Input, Divider, Typography, Skeleton, Drawer } from 'antd';
import { SearchOutlined, StarFilled, StarOutlined, LoadingOutlined, CloseOutlined } from '@ant-design/icons';

const { Text } = Typography;

function SearchBar({ coins, onSelect, favorites = [], onToggleFavorite, loading = false }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const dropdownRef = useRef(null);
  
  // Handle window resize for mobile detection
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      // Close dropdown when switching between mobile and desktop
      if (isDropdownOpen) {
        setIsDropdownOpen(!mobile);
      }
    };
    
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [isDropdownOpen]);
  
  // Handle outside click to close dropdown on desktop
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    };
    
    if (!isMobile) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMobile]);
  
  // Filter coins - case insensitive search
  const filteredCoins = coins.filter(coin => {
    const search = searchTerm.toLowerCase();
    return (
      coin.symbol.toLowerCase().includes(search) ||
      (coin.name && coin.name.toLowerCase().includes(search))
    );
  });
  
  // Separate favorite coins
  const favoriteCoins = filteredCoins.filter(coin => favorites.includes(coin.symbol));
  const otherCoins = filteredCoins.filter(coin => !favorites.includes(coin.symbol));
  
  // Handle coin selection
  const handleCoinSelect = (coin) => {
    onSelect(coin.symbol);
    setIsDropdownOpen(false);
    setIsDrawerOpen(false);
    setSearchTerm('');
  };
  
  // Handle favorite toggle
  const handleFavoriteToggle = (e, symbol) => {
    e.stopPropagation();
    onToggleFavorite(symbol);
  };
  
  // Get coin color
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
  
  // Handle search icon click
  const handleSearchIconClick = () => {
    if (isMobile) {
      setIsDrawerOpen(true);
    } else {
      setIsDropdownOpen(!isDropdownOpen);
    }
  };
  
  // Render coin list for both dropdown and drawer
  const renderCoinList = () => (
    <>
      {/* Search results count */}
      <div className="px-3 py-2 text-gray-400 text-xs">
        找到 {filteredCoins.length} 个币种
        {searchTerm && <span> (搜索: "{searchTerm}")</span>}
      </div>
      
      {/* Favorite coins */}
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
      
      {/* Other coins */}
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
  );
  
  // Loading skeleton
  const renderLoadingSkeleton = () => (
    <div className="p-4">
      <Skeleton.Input active size="small" className="mb-2" style={{ width: '100%' }} />
      <Skeleton.Input active size="small" className="mb-2" style={{ width: '100%' }} />
      <Skeleton.Input active size="small" className="mb-2" style={{ width: '100%' }} />
    </div>
  );
  
  return (
    <div className="relative" ref={dropdownRef}>
      {/* Search button/input */}
      <div 
        className="bg-gray-800 rounded-md flex items-center p-2 cursor-pointer"
        onClick={handleSearchIconClick}
      >
        {loading ? (
          <LoadingOutlined className="text-gray-400 mr-2" />
        ) : (
          <SearchOutlined className="text-gray-400 mr-2" />
        )}
        <Input
          placeholder={isMobile ? "搜索" : "搜索币种..."}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onClick={(e) => {
            e.stopPropagation();
            if (isMobile) {
              setIsDrawerOpen(true);
            } else {
              setIsDropdownOpen(true);
            }
          }}
          className="bg-transparent border-0 text-white placeholder-gray-500"
          style={{ width: isMobile ? '70px' : '180px' }}
        />
      </div>
      
      {/* Desktop dropdown */}
      {!isMobile && isDropdownOpen && (
        <div className="absolute top-full left-0 mt-1 w-64 max-h-96 overflow-y-auto bg-gray-800 rounded-md shadow-lg z-50">
          {loading ? renderLoadingSkeleton() : renderCoinList()}
        </div>
      )}
      
      {/* Mobile drawer */}
      <Drawer
        title={
          <div className="flex items-center justify-between">
            <span>搜索币种</span>
            <CloseOutlined onClick={() => setIsDrawerOpen(false)} />
          </div>
        }
        placement="top"
        height="80vh"
        onClose={() => setIsDrawerOpen(false)}
        open={isMobile && isDrawerOpen}
        destroyOnClose={false}
        bodyStyle={{ padding: 0 }}
        headerStyle={{ padding: '10px 16px' }}
      >
        <div className="p-3 sticky top-0 z-10 bg-gray-800 border-b border-gray-700">
          <Input
            placeholder="输入币种名称或代号..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            prefix={<SearchOutlined className="text-gray-400" />}
            allowClear
            autoFocus
            className="bg-gray-700 text-white border-gray-600"
          />
        </div>
        <div className="bg-gray-800 text-white overflow-y-auto" style={{ height: 'calc(80vh - 110px)' }}>
          {loading ? renderLoadingSkeleton() : renderCoinList()}
        </div>
      </Drawer>
    </div>
  );
}

export default SearchBar;