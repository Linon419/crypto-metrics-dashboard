import React, { useState, useEffect } from 'react';
import { Card, Button, Typography, Space, Divider, Alert } from 'antd';
import { fetchFavorites, addFavorite, removeFavorite } from '../services/api';

const { Title, Text, Paragraph } = Typography;

const FavoriteDebug = () => {
  const [localFavorites, setLocalFavorites] = useState([]);
  const [serverFavorites, setServerFavorites] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [logs, setLogs] = useState([]);

  const addLog = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${timestamp}] ${message}`]);
  };

  const loadLocalFavorites = () => {
    try {
      const cached = JSON.parse(localStorage.getItem('favoriteCrypto') || '[]');
      setLocalFavorites(cached);
      addLog(`本地缓存: ${cached.length}个收藏 - ${cached.join(', ')}`);
    } catch (err) {
      addLog(`本地缓存读取失败: ${err.message}`);
    }
  };

  const loadServerFavorites = async () => {
    try {
      setLoading(true);
      setError(null);
      addLog('开始从服务器获取收藏列表...');
      
      const favorites = await fetchFavorites(true);
      setServerFavorites(favorites);
      addLog(`服务器返回: ${favorites.length}个收藏 - ${favorites.join(', ')}`);
    } catch (err) {
      setError(err.message);
      addLog(`服务器请求失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const testAddFavorite = async () => {
    try {
      setLoading(true);
      addLog('测试添加收藏: BTC');
      
      await addFavorite('BTC');
      addLog('添加收藏成功: BTC');
      
      // 重新加载数据
      loadLocalFavorites();
      await loadServerFavorites();
    } catch (err) {
      addLog(`添加收藏失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const testRemoveFavorite = async () => {
    try {
      setLoading(true);
      addLog('测试删除收藏: BTC');
      
      await removeFavorite('BTC');
      addLog('删除收藏成功: BTC');
      
      // 重新加载数据
      loadLocalFavorites();
      await loadServerFavorites();
    } catch (err) {
      addLog(`删除收藏失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const clearLogs = () => {
    setLogs([]);
  };

  useEffect(() => {
    loadLocalFavorites();
    loadServerFavorites();
  }, []);

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <Title level={2}>收藏功能调试工具</Title>
      
      {error && (
        <Alert 
          message="错误信息" 
          description={error} 
          type="error" 
          style={{ marginBottom: '16px' }}
        />
      )}

      <Space direction="vertical" style={{ width: '100%' }} size="large">
        <Card title="数据状态">
          <Space direction="vertical" style={{ width: '100%' }}>
            <div>
              <Text strong>本地缓存收藏 ({localFavorites.length}个):</Text>
              <Paragraph code>{JSON.stringify(localFavorites)}</Paragraph>
            </div>
            <div>
              <Text strong>服务器收藏 ({serverFavorites.length}个):</Text>
              <Paragraph code>{JSON.stringify(serverFavorites)}</Paragraph>
            </div>
          </Space>
        </Card>

        <Card title="测试操作">
          <Space wrap>
            <Button onClick={loadLocalFavorites}>
              刷新本地缓存
            </Button>
            <Button onClick={loadServerFavorites} loading={loading}>
              刷新服务器数据
            </Button>
            <Button onClick={testAddFavorite} loading={loading} type="primary">
              测试添加收藏(BTC)
            </Button>
            <Button onClick={testRemoveFavorite} loading={loading} danger>
              测试删除收藏(BTC)
            </Button>
          </Space>
        </Card>

        <Card title="操作日志" extra={<Button onClick={clearLogs}>清空日志</Button>}>
          <div style={{ 
            height: '300px', 
            overflow: 'auto', 
            backgroundColor: '#f5f5f5', 
            padding: '10px',
            fontFamily: 'monospace',
            fontSize: '12px'
          }}>
            {logs.map((log, index) => (
              <div key={index}>{log}</div>
            ))}
          </div>
        </Card>
      </Space>
    </div>
  );
};

export default FavoriteDebug;
