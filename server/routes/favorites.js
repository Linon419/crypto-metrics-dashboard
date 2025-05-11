// server/routes/favorites.js
const express = require('express');
const router = express.Router();
const { UserFavorite } = require('../models');

// 获取设备的收藏列表
router.get('/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    
    const favorites = await UserFavorite.findAll({
      where: { device_id: deviceId },
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

// 添加收藏
router.post('/', async (req, res) => {
  try {
    const { deviceId, symbol } = req.body;
    
    if (!deviceId || !symbol) {
      return res.status(400).json({ error: 'Device ID and symbol are required' });
    }
    
    // 使用findOrCreate防止重复添加
    const [favorite, created] = await UserFavorite.findOrCreate({
      where: {
        device_id: deviceId,
        symbol: symbol.toUpperCase()
      },
      defaults: {
        device_id: deviceId,
        symbol: symbol.toUpperCase()
      }
    });
    
    res.status(created ? 201 : 200).json({ 
      message: created ? 'Favorite added' : 'Favorite already exists',
      symbol: favorite.symbol
    });
  } catch (error) {
    console.error('Error adding favorite:', error);
    res.status(500).json({ error: 'Failed to add favorite' });
  }
});

// 删除收藏
router.delete('/:deviceId/:symbol', async (req, res) => {
  try {
    const { deviceId, symbol } = req.params;
    
    const deleted = await UserFavorite.destroy({
      where: {
        device_id: deviceId,
        symbol: symbol.toUpperCase()
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