const assert = require('assert');
const { CoinKline, sequelize } = require('../models');

const uniqueIndexes = CoinKline.options.indexes.filter(index => index.unique);
// trading_symbol 必须在唯一键里，否则同一市场换标的会按 open_time 覆盖掉另一个标的的历史
const hasPerCoinUniqueIndex = uniqueIndexes.some(index => (
  JSON.stringify(index.fields)
    === JSON.stringify(['coin_id', 'market', 'interval', 'trading_symbol', 'open_time'])
));

assert.strictEqual(hasPerCoinUniqueIndex, true);
assert.strictEqual(
  uniqueIndexes.some(index => (
    JSON.stringify(index.fields) === JSON.stringify(['coin_id', 'market', 'interval', 'open_time'])
  )),
  false,
  '旧的缺少 trading_symbol 的唯一键必须已被替换'
);

sequelize.close();
console.log('coinKlineModel.test.js passed');
