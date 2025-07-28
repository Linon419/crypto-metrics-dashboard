// 模拟前端的设备ID生成逻辑
function getDeviceId() {
  const storageKey = 'crypto_dashboard_device_id';
  
  // 模拟localStorage
  if (typeof localStorage === 'undefined') {
    global.localStorage = {
      storage: {},
      getItem: function(key) {
        return this.storage[key] || null;
      },
      setItem: function(key, value) {
        this.storage[key] = value;
      }
    };
  }
  
  let deviceId = localStorage.getItem(storageKey);
  
  // 如果没有找到设备ID，则生成一个新的
  if (!deviceId) {
    // 生成一个简单的唯一ID (UUID v4格式)
    deviceId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
    
    // 保存到本地存储中
    localStorage.setItem(storageKey, deviceId);
  }
  
  return deviceId;
}

const axios = require('axios');

async function debugDeviceIdIssue() {
  console.log('🔍 调试设备ID和收藏功能...\n');

  // 1. 生成设备ID
  const deviceId = getDeviceId();
  console.log('📱 生成的设备ID:', deviceId);
  console.log('');

  const API_BASE = 'http://localhost:3001/api';

  try {
    // 2. 测试添加收藏
    console.log('2️⃣ 添加收藏 (BTC)');
    const addResponse = await axios.post(`${API_BASE}/favorites`, {
      symbol: 'BTC'
    }, {
      headers: { 'x-device-id': deviceId }
    });
    console.log('✅ 添加响应:', addResponse.data);
    console.log('');

    // 3. 立即获取收藏列表
    console.log('3️⃣ 立即获取收藏列表');
    const getResponse1 = await axios.get(`${API_BASE}/favorites`, {
      headers: { 'x-device-id': deviceId }
    });
    console.log('✅ 收藏列表:', getResponse1.data);
    console.log('');

    // 4. 等待一秒后再次获取（模拟页面刷新）
    console.log('4️⃣ 等待1秒后再次获取（模拟页面刷新）');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const getResponse2 = await axios.get(`${API_BASE}/favorites`, {
      headers: { 'x-device-id': deviceId }
    });
    console.log('✅ 刷新后收藏列表:', getResponse2.data);
    console.log('');

    // 5. 使用不同的设备ID测试
    console.log('5️⃣ 使用不同设备ID测试');
    const differentDeviceId = 'different-device-id-123';
    const getResponse3 = await axios.get(`${API_BASE}/favorites`, {
      headers: { 'x-device-id': differentDeviceId }
    });
    console.log('✅ 不同设备ID的收藏列表:', getResponse3.data);
    console.log('');

    // 6. 清理测试数据
    console.log('6️⃣ 清理测试数据');
    await axios.delete(`${API_BASE}/favorites/BTC`, {
      headers: { 'x-device-id': deviceId }
    });
    console.log('✅ 清理完成');

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    if (error.response) {
      console.error('响应状态:', error.response.status);
      console.error('响应数据:', error.response.data);
    }
  }
}

debugDeviceIdIssue();
