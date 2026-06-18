// server/tests/checkCoins.js
// 检查数据库中的币种和最新数据

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
  name: { type: DataTypes.STRING, allowNull: false },
  current_price: { type: DataTypes.DECIMAL(20, 8) },
  logo_url: { type: DataTypes.STRING }
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

async function checkCoinsAndData() {
  try {
    console.log('🔍 检查数据库中的币种和数据...\n');

    // 查询所有币种
    const coins = await Coin.findAll({
      order: [['id', 'ASC']]
    });

    console.log('📊 数据库中的币种列表:');
    console.log('ID\t符号\t\t名称');
    console.log('---\t----\t\t----');
    coins.forEach(coin => {
      console.log(`${coin.id}\t${coin.symbol.padEnd(8)}\t${coin.name}`);
    });

    console.log(`\n总计: ${coins.length} 个币种\n`);

    // 检查您提到的新币种
    const newSymbols = ['HOOD', 'COIN', 'CIRCLE', 'TSLA', 'NVDA', 'AAPL', 'GOOG'];
    console.log('🔍 检查您提到的新币种:');
    
    for (const symbol of newSymbols) {
      const existingCoin = coins.find(coin => 
        coin.symbol.toLowerCase() === symbol.toLowerCase()
      );
      
      if (existingCoin) {
        console.log(`✅ ${symbol}: 已存在 (ID: ${existingCoin.id}, 名称: ${existingCoin.name})`);
        
        // 检查最新数据
        const latestMetric = await DailyMetric.findOne({
          where: { coin_id: existingCoin.id },
          order: [['date', 'DESC']]
        });
        
        if (latestMetric) {
          console.log(`   最新数据: ${latestMetric.date}, 场外指数: ${latestMetric.otc_index}, 爆破指数: ${latestMetric.explosion_index}`);
        } else {
          console.log(`   ⚠️  没有找到数据记录`);
        }
      } else {
        console.log(`❌ ${symbol}: 不存在于数据库中`);
      }
    }

    // 检查其他资产类型
    console.log('\n🔍 检查其他资产类型:');
    const otherAssets = ['黄金', 'GOLD', '地产', 'ESTATE', '原油', 'OIL'];
    
    for (const asset of otherAssets) {
      const existingAsset = coins.find(coin => 
        coin.symbol.toLowerCase().includes(asset.toLowerCase()) ||
        coin.name.toLowerCase().includes(asset.toLowerCase())
      );
      
      if (existingAsset) {
        console.log(`✅ ${asset}: 找到相关资产 (${existingAsset.symbol} - ${existingAsset.name})`);
      } else {
        console.log(`❌ ${asset}: 未找到相关资产`);
      }
    }

    // 查询最新数据日期
    const latestDate = await sequelize.query(`
      SELECT date, COUNT(*) as count 
      FROM DailyMetrics 
      GROUP BY date 
      ORDER BY date DESC 
      LIMIT 1
    `, { type: Sequelize.QueryTypes.SELECT });

    if (latestDate.length > 0) {
      console.log(`\n📅 数据库最新数据日期: ${latestDate[0].date} (${latestDate[0].count}条记录)`);
    }

  } catch (error) {
    console.error('❌ 检查数据时出错:', error.message);
  } finally {
    await sequelize.close();
  }
}

checkCoinsAndData();
