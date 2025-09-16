// server/routes/favorites.js
const express = require('express');
const router = express.Router();
const { UserFavorite } = require('../models');
const { verifyToken: authMiddleware } = require('../middleware/auth');

// 获取收藏列表 - 只使用用户ID
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User must be logged in' });
    }

    const favorites = await UserFavorite.findAll({
      where: { user_id: userId },
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

// 添加收藏 - 只使用用户ID
router.post('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    const { symbol } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'User must be logged in' });
    }

    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }

    // 使用findOrCreate防止重复添加
    const [favorite, created] = await UserFavorite.findOrCreate({
      where: {
        user_id: userId,
        symbol: symbol.toUpperCase()
      },
      defaults: {
        user_id: userId,
        symbol: symbol.toUpperCase()
      }
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

// 删除收藏 - 只使用用户ID
router.delete('/:symbol', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    const { symbol } = req.params;

    if (!userId) {
      return res.status(401).json({ error: 'User must be logged in' });
    }

    console.log(`[收藏API] 删除收藏请求: symbol=${symbol}, userId=${userId}`);

    const deleted = await UserFavorite.destroy({
      where: {
        user_id: userId,
        symbol: symbol.toUpperCase()
      }
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

module.exports = router;