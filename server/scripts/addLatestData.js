// server/scripts/addLatestData.js
// 添加2025-08-13的最新数据

const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');

// 初始化数据库连接
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, '../database.sqlite'),
  logging: false
});

// 定义模型
const Coin = sequelize.define('Coin', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  symbol: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false }
}, { tableName: 'Coins', timestamps: true });

const DailyMetric = sequelize.define('DailyMetric', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  coin_id: { type: DataTypes.INTEGER, allowNull: false },
  date: { type: DataTypes.DATEONLY, allowNull: false },
  otc_index: { type: DataTypes.INTEGER, allowNull: false },
  explosion_index: { type: DataTypes.INTEGER, allowNull: false },
  schelling_point: { type: DataTypes.INTEGER, allowNull: false },
  entry_exit_type: { type: DataTypes.STRING },
  entry_exit_day: { type: DataTypes.INTEGER },
  near_threshold: { type: DataTypes.BOOLEAN }
}, { tableName: 'DailyMetrics', timestamps: true });

// 2025-08-13的最新数据
const latestData = [
  { symbol: 'HOOD', otc_index: 1266, explosion_index: 240, entry_exit_type: 'entry', entry_exit_day: 6 },
  { symbol: 'COIN', otc_index: 659, explosion_index: 59, entry_exit_type: 'entry', entry_exit_day: 1 },
  { symbol: 'CIRCLE', otc_index: 785, explosion_index: 88, entry_exit_type: 'exit', entry_exit_day: 16, near_threshold: true },
  { symbol: 'TSLA', otc_index: 1178, explosion_index: 257, entry_exit_type: 'entry', entry_exit_day: 6 },
  { symbol: 'NVDA', otc_index: 838, explosion_index: 215, entry_exit_type: 'entry', entry_exit_day: 101 },
  { symbol: 'AAPL', otc_index: 1261, explosion_index: 255, entry_exit_type: 'entry', entry_exit_day: 7 },
  { symbol: 'GOOG', otc_index: 1260, explosion_index: 283, entry_exit_type: 'entry', entry_exit_day: 49 },
  { symbol: 'GOLD', otc_index: 987, explosion_index: 87, entry_exit_type: 'entry', entry_exit_day: 11 },
  { symbol: '地产', otc_index: 1457, explosion_index: 254, entry_exit_type: 'entry', entry_exit_day: 30 }, // 第一月 = 30天
  { symbol: 'BRENT_OIL', otc_index: 866, explosion_index: 9, entry_exit_type: 'exit', entry_exit_day: 11 }
];

async function addLatestData() {
  try {
    console.log('🔄 开始添加2025-08-13的最新数据...\n');

    const targetDate = '2025-08-13';
    let successCount = 0;
    let errorCount = 0;

    for (const data of latestData) {
      try {
        // 查找币种
        const coin = await Coin.findOne({
          where: { symbol: data.symbol }
        });

        if (!coin) {
          console.log(`❌ 未找到币种: ${data.symbol}`);
          errorCount++;
          continue;
        }

        // 检查是否已存在该日期的数据
        const existingMetric = await DailyMetric.findOne({
          where: {
            coin_id: coin.id,
            date: targetDate
          }
        });

        if (existingMetric) {
          // 更新现有数据
          await existingMetric.update({
            otc_index: data.otc_index,
            explosion_index: data.explosion_index,
            schelling_point: data.otc_index, // 使用场外指数作为默认谢林点
            entry_exit_type: data.entry_exit_type,
            entry_exit_day: data.entry_exit_day,
            near_threshold: data.near_threshold || false
          });
          console.log(`✅ 更新 ${data.symbol}: 场外${data.otc_index}, 爆破${data.explosion_index}, ${data.entry_exit_type}期第${data.entry_exit_day}天`);
        } else {
          // 创建新数据
          await DailyMetric.create({
            coin_id: coin.id,
            date: targetDate,
            otc_index: data.otc_index,
            explosion_index: data.explosion_index,
            schelling_point: data.otc_index, // 使用场外指数作为默认谢林点
            entry_exit_type: data.entry_exit_type,
            entry_exit_day: data.entry_exit_day,
            near_threshold: data.near_threshold || false
          });
          console.log(`✅ 新增 ${data.symbol}: 场外${data.otc_index}, 爆破${data.explosion_index}, ${data.entry_exit_type}期第${data.entry_exit_day}天`);
        }

        successCount++;
      } catch (error) {
        console.log(`❌ 处理 ${data.symbol} 时出错: ${error.message}`);
        errorCount++;
      }
    }

    console.log(`\n📊 数据添加完成:`);
    console.log(`✅ 成功: ${successCount} 条`);
    console.log(`❌ 失败: ${errorCount} 条`);

    // 验证数据
    console.log(`\n🔍 验证 ${targetDate} 的数据:`);
    const addedData = await sequelize.query(`
      SELECT c.symbol, dm.otc_index, dm.explosion_index, dm.entry_exit_type, dm.entry_exit_day
      FROM DailyMetrics dm
      JOIN Coins c ON dm.coin_id = c.id
      WHERE dm.date = '${targetDate}'
      AND c.symbol IN ('HOOD', 'COIN', 'CIRCLE', 'TSLA', 'NVDA', 'AAPL', 'GOOG', 'GOLD', '地产', 'BRENT_OIL')
      ORDER BY c.symbol
    `, { type: Sequelize.QueryTypes.SELECT });

    addedData.forEach(row => {
      console.log(`  ${row.symbol}: 场外${row.otc_index}, 爆破${row.explosion_index}, ${row.entry_exit_type}期第${row.entry_exit_day}天`);
    });

  } catch (error) {
    console.error('❌ 添加数据时出错:', error.message);
  } finally {
    await sequelize.close();
  }
}

addLatestData();
