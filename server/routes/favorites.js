// server/routes/favorites.js
const express = require('express');
const router = express.Router();
const { UserFavorite } = require('../models');
const authMiddleware = require('../middleware/auth');

// 获取收藏列表 - 支持用户ID和设备ID
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    const deviceId = req.headers['x-device-id'];

    let whereClause;

    // 优先使用用户ID（如果已登录）
    if (userId && userId !== 999) { // 999是开发模式的默认用户ID
      whereClause = { user_id: userId };
    } else if (deviceId) {
      // 回退到设备ID（未登录用户）
      whereClause = { device_id: deviceId, user_id: null };
    } else {
      return res.status(400).json({ error: 'No user ID or device ID provided' });
    }

    const favorites = await UserFavorite.findAll({
      where: whereClause,
      attributes: ['symbol'],
      order: [['createdAt', 'ASC']]
    });

    // 提取符号数组
    const favoriteSymbols = favorites.map(fav => fav.symbol);

    res.json(favoriteSymbols);
  } catch (error) {
    console.error('Error fetching favorites:', error);
    res.status(500).json({ error: 'Failed to fetch favorites' });
  }
});

// 保持向后兼容性的旧路由（仅用于设备ID）
router.get('/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;

    const favorites = await UserFavorite.findAll({
      where: { device_id: deviceId, user_id: null },
      attributes: ['symbol'],
      order: [['createdAt', 'ASC']]
    });

    // 提取符号数组
    const favoriteSymbols = favorites.map(fav => fav.symbol);

    res.json(favoriteSymbols);
  } catch (error) {
    console.error('Error fetching favorites:', error);
    res.status(500).json({ error: 'Failed to fetch favorites' });
  }
});

// 添加收藏 - 支持用户ID和设备ID
router.post('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    const deviceId = req.headers['x-device-id'] || req.body.deviceId;
    const { symbol } = req.body;

    // console.log(`[收藏API] 添加收藏请求: symbol=${symbol}, userId=${userId}, deviceId=${deviceId}`);

    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }

    let whereClause, defaults;

    // 优先使用用户ID（如果已登录）
    if (userId && userId !== 999) { // 999是开发模式的默认用户ID
      whereClause = {
        user_id: userId,
        symbol: symbol.toUpperCase()
      };
      defaults = {
        user_id: userId,
        symbol: symbol.toUpperCase()
      };
    } else if (deviceId) {
      // 回退到设备ID（未登录用户）
      whereClause = {
        device_id: deviceId,
        symbol: symbol.toUpperCase(),
        user_id: null
      };
      defaults = {
        device_id: deviceId,
        symbol: symbol.toUpperCase(),
        user_id: null
      };
    } else {
      return res.status(400).json({ error: 'No user ID or device ID provided' });
    }

    // 使用findOrCreate防止重复添加
    const [favorite, created] = await UserFavorite.findOrCreate({
      where: whereClause,
      defaults: defaults
    });

    console.log(`[收藏API] 添加收藏结果: symbol=${symbol}, created=${created}`);

    res.status(created ? 201 : 200).json({
      message: created ? 'Favorite added' : 'Favorite already exists',
      symbol: favorite.symbol
    });
  } catch (error) {
    console.error('Error adding favorite:', error);
    res.status(500).json({ error: 'Failed to add favorite' });
  }
});

// 删除收藏 - 支持用户ID和设备ID
router.delete('/:symbol', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    const deviceId = req.headers['x-device-id'];
    const { symbol } = req.params;

    console.log(`[收藏API] 删除收藏请求: symbol=${symbol}, userId=${userId}, deviceId=${deviceId}`);

    let whereClause;

    // 优先使用用户ID（如果已登录）
    if (userId && userId !== 999) { // 999是开发模式的默认用户ID
      whereClause = {
        user_id: userId,
        symbol: symbol.toUpperCase()
      };
    } else if (deviceId) {
      // 回退到设备ID（未登录用户）
      whereClause = {
        device_id: deviceId,
        symbol: symbol.toUpperCase(),
        user_id: null
      };
    } else {
      return res.status(400).json({ error: 'No user ID or device ID provided' });
    }

    const deleted = await UserFavorite.destroy({
      where: whereClause
    });

    console.log(`[收藏API] 删除收藏结果: symbol=${symbol}, deleted=${deleted}`);

    if (deleted) {
      res.json({ message: 'Favorite removed', symbol });
    } else {
      res.status(404).json({ error: 'Favorite not found' });
    }
  } catch (error) {
    console.error('Error removing favorite:', error);
    res.status(500).json({ error: 'Failed to remove favorite' });
  }
});

// 保持向后兼容性的旧路由（仅用于设备ID）
router.delete('/:deviceId/:symbol', async (req, res) => {
  try {
    const { deviceId, symbol } = req.params;

    const deleted = await UserFavorite.destroy({
      where: {
        device_id: deviceId,
        symbol: symbol.toUpperCase(),
        user_id: null
      }
    });

    if (deleted) {
      res.json({ message: 'Favorite removed', symbol });
    } else {
      res.status(404).json({ error: 'Favorite not found' });
    }
  } catch (error) {
    console.error('Error removing favorite:', error);
    res.status(500).json({ error: 'Failed to remove favorite' });
  }
});

module.exports = router;