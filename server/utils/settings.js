// server/utils/settings.js
// 系统设置管理模块

// 系统设置（实际项目中应该存储在数据库）
let systemSettings = {
  registrationEnabled: true
};

// 获取系统设置
const getSystemSettings = () => {
  return { ...systemSettings };
};

// 更新系统设置
const updateSystemSettings = (newSettings) => {
  systemSettings = { ...systemSettings, ...newSettings };
  return { ...systemSettings };
};

module.exports = {
  getSystemSettings,
  updateSystemSettings
};