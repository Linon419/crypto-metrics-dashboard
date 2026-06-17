const assert = require('assert');
const { CoinKline, sequelize } = require('../models');

const uniqueIndexes = CoinKline.options.indexes.filter(index => index.unique);
const hasPerCoinUniqueIndex = uniqueIndexes.some(index => (
  JSON.stringify(index.fields) === JSON.stringify(['coin_id', 'market', 'interval', 'open_time'])
));

assert.strictEqual(hasPerCoinUniqueIndex, true);

sequelize.close();
console.log('coinKlineModel.test.js passed');
