// src/utils/deviceId.js

/**
 * 获取或生成设备ID
 * 这个ID将用于跨会话识别同一设备
 */
export const getDeviceId = () => {
    const storageKey = 'crypto_dashboard_device_id';
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
  };