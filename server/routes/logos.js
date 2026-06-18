const express = require('express');
const { Coin } = require('../models');
const { getLogoResponse } = require('../utils/logoCache');

function createLogosRouter({
  CoinModel = Coin,
  logoResponseProvider = getLogoResponse,
} = {}) {
  const router = express.Router();

  router.get('/:symbol', async (req, res) => {
    try {
      const symbol = String(req.params.symbol || '').trim().toUpperCase();
      if (!symbol || symbol.length > 80) {
        return res.status(400).json({ success: false, error: 'Invalid logo symbol' });
      }

      const coin = CoinModel?.findOne
        ? await CoinModel.findOne({
          where: { symbol },
          attributes: ['symbol', 'logo_url'],
          raw: true,
        })
        : null;

      const logo = await logoResponseProvider(symbol, {
        explicitLogoUrl: coin?.logo_url || null,
        forceRefresh: req.query.refresh === '1' || req.query.refresh === 'true',
      });

      res.set('Content-Type', logo.contentType);
      res.set('Cache-Control', ['remote', 'disk'].includes(logo.source)
        ? 'public, max-age=604800, immutable'
        : 'public, max-age=3600');
      res.set('X-Logo-Cache', logo.cacheHit ? 'hit' : 'miss');
      res.set('X-Logo-Source', logo.source || 'unknown');
      return res.send(logo.body);
    } catch (error) {
      console.error('[LOGO_CACHE] Failed to serve logo:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to serve logo',
      });
    }
  });

  return router;
}

const router = createLogosRouter();
router.createLogosRouter = createLogosRouter;

module.exports = router;
