// src/components/CoinList.jsx
import React from 'react';
import { Row, Col, Carousel } from 'antd';
import CoinCard from './CoinCard';

function CoinList() {
  // 模拟币种数据
  const coins = [
    {
      symbol: 'BTC',
      name: 'Bitcoin',
      price: 99623.24,
      priceChangePercent: 2.68,
      otcIndex: 1627,
      explosionIndex: 195,
      schellingPoint: 98500,
      entryExitType: 'entry',
      entryExitDay: 26
    },
    {
      symbol: 'ETH',
      name: 'Ethereum',
      price: 1937.98,
      priceChangePercent: 7.01,
      otcIndex: 1430,
      explosionIndex: 180,
      schellingPoint: 1820,
      entryExitType: 'exit',
      entryExitDay: 104
    },
    {
      symbol: 'USDT',
      name: 'Tether',
      price: 1.00005,
      priceChangePercent: 0.01,
      otcIndex: 800,
      explosionIndex: 120,
      schellingPoint: 1.0,
      entryExitType: 'neutral',
      entryExitDay: 0
    },
    {
      symbol: 'BNB',
      name: 'Binance Coin',
      price: 616.96,
      priceChangePercent: 2.37,
      otcIndex: 1200,
      explosionIndex: 175,
      schellingPoint: 620,
      entryExitType: 'entry',
      entryExitDay: 14
    }
  ];

  return (
    <div className="mb-4">
      <div className="hidden md:block">
        <Row gutter={[16, 16]} className="mb-4">
          {coins.map(coin => (
            <Col key={coin.symbol} xs={24} sm={12} md={6}>
              <CoinCard coin={coin} />
            </Col>
          ))}
        </Row>
      </div>
      
      {/* 移动端轮播 */}
      <div className="block md:hidden">
        <Carousel autoplay>
          {coins.map(coin => (
            <div key={coin.symbol} className="px-2">
              <CoinCard coin={coin} />
            </div>
          ))}
        </Carousel>
      </div>
    </div>
  );
}

export default CoinList;