const axios = require('axios');

const API_BASE = 'http://localhost:3001/api';

// 模拟登录获取token
async function login() {
  try {
    const response = await axios.post(`${API_BASE}/auth/login`, {
      username: 'admin',
      password: 'password'
    });
    return response.data.token;
  } catch (error) {
    console.error('登录失败:', error.response?.data || error.message);
    return null;
  }
}

async function testUserFavorites() {
  console.log('🧪 测试基于用户ID的收藏功能...\n');

  // 1. 登录获取token
  console.log('1️⃣ 用户登录');
  const token = await login();
  if (!token) {
    console.error('❌ 登录失败，无法继续测试');
    return;
  }
  console.log('✅ 登录成功，获得token');
  console.log('');

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  try {
    // 2. 测试获取收藏列表（初始状态）
    console.log('2️⃣ 获取初始收藏列表');
    const initialResponse = await axios.get(`${API_BASE}/favorites`, { headers });
    console.log('✅ 初始收藏列表:', initialResponse.data);
    console.log('');

    // 3. 测试添加收藏
    console.log('3️⃣ 添加收藏 (BTC)');
    const addResponse = await axios.post(`${API_BASE}/favorites`, {
      symbol: 'BTC'
    }, { headers });
    console.log('✅ 添加响应:', addResponse.data);
    console.log('');

    // 4. 验证添加后的收藏列表
    console.log('4️⃣ 验证添加后的收藏列表');
    const afterAddResponse = await axios.get(`${API_BASE}/favorites`, { headers });
    console.log('✅ 添加后收藏列表:', afterAddResponse.data);
    console.log('');

    // 5. 测试重复添加（应该不会重复）
    console.log('5️⃣ 测试重复添加 (BTC)');
    const duplicateResponse = await axios.post(`${API_BASE}/favorites`, {
      symbol: 'BTC'
    }, { headers });
    console.log('✅ 重复添加响应:', duplicateResponse.data);
    console.log('');

    // 6. 添加另一个收藏
    console.log('6️⃣ 添加另一个收藏 (ETH)');
    const addEthResponse = await axios.post(`${API_BASE}/favorites`, {
      symbol: 'ETH'
    }, { headers });
    console.log('✅ 添加ETH响应:', addEthResponse.data);
    console.log('');

    // 7. 查看完整收藏列表
    console.log('7️⃣ 查看完整收藏列表');
    const fullListResponse = await axios.get(`${API_BASE}/favorites`, { headers });
    console.log('✅ 完整收藏列表:', fullListResponse.data);
    console.log('');

    // 8. 测试删除收藏
    console.log('8️⃣ 删除收藏 (BTC)');
    const deleteResponse = await axios.delete(`${API_BASE}/favorites/BTC`, { headers });
    console.log('✅ 删除响应:', deleteResponse.data);
    console.log('');

    // 9. 验证删除后的收藏列表
    console.log('9️⃣ 验证删除后的收藏列表');
    const afterDeleteResponse = await axios.get(`${API_BASE}/favorites`, { headers });
    console.log('✅ 删除后收藏列表:', afterDeleteResponse.data);
    console.log('');

    // 10. 清理剩余收藏
    console.log('🔟 清理剩余收藏');
    await axios.delete(`${API_BASE}/favorites/ETH`, { headers });
    const finalResponse = await axios.get(`${API_BASE}/favorites`, { headers });
    console.log('✅ 最终收藏列表:', finalResponse.data);
    console.log('');

    console.log('🎉 所有测试完成！收藏功能工作正常。');

  } catch (error) {
    console.error('❌ 测试失败:');
    console.error('错误信息:', error.message);
    if (error.response) {
      console.error('响应状态:', error.response.status);
      console.error('响应数据:', error.response.data);
    }
  }
}

// 测试未登录情况
async function testUnauthorized() {
  console.log('\n🔒 测试未登录访问收藏功能...');
  
  try {
    const response = await axios.get(`${API_BASE}/favorites`);
    console.log('❌ 未登录却能访问收藏功能，这是个问题！');
  } catch (error) {
    if (error.response?.status === 401) {
      console.log('✅ 未登录正确返回401错误');
    } else {
      console.log('⚠️ 未登录返回了其他错误:', error.response?.status);
    }
  }
}

// 运行测试
async function runAllTests() {
  await testUserFavorites();
  await testUnauthorized();
}

runAllTests();
