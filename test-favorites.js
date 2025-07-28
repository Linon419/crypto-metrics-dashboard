const axios = require('axios');

const API_BASE = 'http://localhost:3001/api';
const TEST_DEVICE_ID = 'test-device-debug-123';
const TEST_SYMBOL = 'BTC';

async function testFavoritesAPI() {
  console.log('🧪 开始测试收藏功能API...\n');

  try {
    // 1. 测试获取收藏列表（初始状态）
    console.log('1️⃣ 测试获取收藏列表（初始状态）');
    const initialResponse = await axios.get(`${API_BASE}/favorites`, {
      headers: { 'x-device-id': TEST_DEVICE_ID }
    });
    console.log('✅ 初始收藏列表:', initialResponse.data);
    console.log('📊 状态码:', initialResponse.status);
    console.log('');

    // 2. 测试添加收藏
    console.log('2️⃣ 测试添加收藏');
    const addResponse = await axios.post(`${API_BASE}/favorites`, {
      symbol: TEST_SYMBOL
    }, {
      headers: { 'x-device-id': TEST_DEVICE_ID }
    });
    console.log('✅ 添加收藏响应:', addResponse.data);
    console.log('📊 状态码:', addResponse.status);
    console.log('');

    // 3. 再次获取收藏列表（验证添加）
    console.log('3️⃣ 验证添加后的收藏列表');
    const afterAddResponse = await axios.get(`${API_BASE}/favorites`, {
      headers: { 'x-device-id': TEST_DEVICE_ID }
    });
    console.log('✅ 添加后收藏列表:', afterAddResponse.data);
    console.log('📊 状态码:', afterAddResponse.status);
    console.log('');

    // 4. 测试删除收藏
    console.log('4️⃣ 测试删除收藏');
    const deleteResponse = await axios.delete(`${API_BASE}/favorites/${TEST_SYMBOL}`, {
      headers: { 'x-device-id': TEST_DEVICE_ID }
    });
    console.log('✅ 删除收藏响应:', deleteResponse.data);
    console.log('📊 状态码:', deleteResponse.status);
    console.log('');

    // 5. 最终验证收藏列表
    console.log('5️⃣ 验证删除后的收藏列表');
    const finalResponse = await axios.get(`${API_BASE}/favorites`, {
      headers: { 'x-device-id': TEST_DEVICE_ID }
    });
    console.log('✅ 最终收藏列表:', finalResponse.data);
    console.log('📊 状态码:', finalResponse.status);
    console.log('');

    console.log('🎉 所有API测试完成！');

  } catch (error) {
    console.error('❌ API测试失败:');
    console.error('错误信息:', error.message);
    if (error.response) {
      console.error('响应状态:', error.response.status);
      console.error('响应数据:', error.response.data);
    }
  }
}

// 运行测试
testFavoritesAPI();
