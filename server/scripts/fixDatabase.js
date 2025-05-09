// server/scripts/fixDatabase.js
// 修复版 - 解决模型关联问题
const { Sequelize } = require('sequelize');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// 根据环境获取配置
const env = process.env.NODE_ENV || 'development';
const config = require('../config/config.json')[env];

// 创建与数据库的连接
const sequelize = new Sequelize(
  config.database, 
  config.username, 
  config.password, 
  {
    host: config.host,
    dialect: config.dialect,
    storage: config.storage, // SQLite需要
    logging: console.log, // 显示所有SQL查询
  }
);

// 直接导入整个模型库，而不是单独加载模型
// 这样可以确保所有模型及其关联都被正确加载
const db = require('../models');

// 定义要修复的日期
const targetDate = '2025-05-09'; // 5.9日期，格式为YYYY-MM-DD

// 主函数
async function fixDatabase() {
  try {
    // 测试数据库连接
    await sequelize.authenticate();
    console.log('数据库连接成功');

    // 1. 选择操作模式:
    const mode = process.argv[2] || 'info'; // 默认显示信息

    switch(mode) {
      case 'info': 
        await showInfo();
        break;
      case 'delete':
        await deleteDate();
        break;
      case 'update':
        await updateData();
        break;
      case 'reset':
        await resetDatabase();
        break;
      default:
        console.log('未知操作模式，请使用: info, delete, update, 或 reset');
    }

    console.log('操作完成');
  } catch (error) {
    console.error('数据库操作失败:', error);
  } finally {
    // 关闭数据库连接
    await sequelize.close();
  }
}

// 显示特定日期的信息 - 修复关联问题
async function showInfo() {
  console.log(`======= ${targetDate}的数据信息 =======`);
  
  try {
    // 获取指标数据 - 不使用关联查询，分两步进行
    const metrics = await db.DailyMetric.findAll({
      where: { date: targetDate }
    });
    
    console.log(`找到${metrics.length}条指标记录`);
    
    // 显示每条记录的详细信息
    for (const metric of metrics) {
      // 单独查询币种信息
      const coin = await db.Coin.findByPk(metric.coin_id);
      const symbol = coin ? coin.symbol : '未知币种';
      
      console.log(`- ${symbol} (ID: ${metric.coin_id}):`);
      console.log(`  场外指数: ${metric.otc_index}`);
      console.log(`  爆破指数: ${metric.explosion_index}`);
      console.log(`  谢林点: ${metric.schelling_point}`);
      console.log(`  ${metric.entry_exit_type === 'entry' ? '进场' : metric.entry_exit_type === 'exit' ? '退场' : '中性'}期第${metric.entry_exit_day}天`);
      console.log('---');
    }
    
    // 获取流动性信息
    const liquidity = await db.LiquidityOverview.findOne({
      where: { date: targetDate }
    });
    
    if (liquidity) {
      console.log('流动性数据:');
      console.log(`  BTC资金变化: ${liquidity.btc_fund_change}`);
      console.log(`  ETH资金变化: ${liquidity.eth_fund_change}`);
      console.log(`  SOL资金变化: ${liquidity.sol_fund_change}`);
      console.log(`  总市场资金变化: ${liquidity.total_market_fund_change}`);
      console.log(`  备注: ${liquidity.comments}`);
    } else {
      console.log('未找到流动性数据');
    }
    
    // 获取热门币种
    const trendingCoins = await db.TrendingCoin.findAll({
      where: { date: targetDate }
    });
    
    console.log(`找到${trendingCoins.length}条热门币种记录`);
    for (const coin of trendingCoins) {
      console.log(`- ${coin.symbol}:`);
      console.log(`  场外指数: ${coin.otc_index}`);
      console.log(`  爆破指数: ${coin.explosion_index}`);
      console.log(`  谢林点: ${coin.schelling_point}`);
      console.log(`  ${coin.entry_exit_type === 'entry' ? '进场' : coin.entry_exit_type === 'exit' ? '退场' : '中性'}期第${coin.entry_exit_day}天`);
      console.log('---');
    }
  } catch (error) {
    console.error('获取数据信息失败:', error);
  }
}

// 删除特定日期的所有数据
async function deleteDate() {
  console.log(`正在删除 ${targetDate} 的所有数据...`);
  
  // 开启事务
  const transaction = await sequelize.transaction();
  
  try {
    // 删除指标数据
    const metricsDeleted = await db.DailyMetric.destroy({
      where: { date: targetDate },
      transaction
    });
    
    // 删除流动性数据
    const liquidityDeleted = await db.LiquidityOverview.destroy({
      where: { date: targetDate },
      transaction
    });
    
    // 删除热门币种数据
    const trendingDeleted = await db.TrendingCoin.destroy({
      where: { date: targetDate },
      transaction
    });
    
    // 提交事务
    await transaction.commit();
    
    console.log(`删除完成: ${metricsDeleted}条指标记录, ${liquidityDeleted}条流动性记录, ${trendingDeleted}条热门币种记录`);
  } catch (error) {
    // 回滚事务
    await transaction.rollback();
    console.error('删除失败:', error);
  }
}

// 手动更新特定币种的数据
async function updateData() {
  // 获取参数: 币种符号、爆破指数和场外指数
  const symbol = process.argv[3];
  const explosionIndex = parseInt(process.argv[4]);
  const otcIndex = parseInt(process.argv[5]);
  
  if (!symbol || isNaN(explosionIndex) || isNaN(otcIndex)) {
    console.log('用法: node fixDatabase.js update [币种符号] [爆破指数] [场外指数]');
    console.log('例如: node fixDatabase.js update BTC 195 1627');
    return;
  }
  
  try {
    // 找到币种
    const coin = await db.Coin.findOne({
      where: { symbol: symbol.toUpperCase() }
    });
    
    if (!coin) {
      console.error(`找不到币种: ${symbol}`);
      return;
    }
    
    // 更新指标
    const [metric, created] = await db.DailyMetric.findOrCreate({
      where: {
        coin_id: coin.id,
        date: targetDate
      },
      defaults: {
        otc_index: otcIndex,
        explosion_index: explosionIndex,
        schelling_point: coin.symbol === 'BTC' ? 98500 : 1820, // 默认值
        entry_exit_type: coin.symbol === 'BTC' ? 'entry' : 'exit', // 默认值
        entry_exit_day: coin.symbol === 'BTC' ? 26 : 105, // 默认值
        near_threshold: false
      }
    });
    
    if (!created) {
      await metric.update({
        otc_index: otcIndex,
        explosion_index: explosionIndex
      });
    }
    
    console.log(`成功${created ? '创建' : '更新'} ${symbol} 的数据: 爆破指数=${explosionIndex}, 场外指数=${otcIndex}`);
  } catch (error) {
    console.error('更新失败:', error);
  }
}

// 直接执行SQL语句
async function executeSql() {
  const sql = process.argv[3];
  if (!sql) {
    console.log('用法: node fixDatabase.js sql "您的SQL语句"');
    return;
  }
  
  try {
    const [results] = await sequelize.query(sql);
    console.log('SQL执行结果:');
    console.log(results);
  } catch (error) {
    console.error('SQL执行失败:', error);
  }
}

// 完全重置数据库（危险操作！）
async function resetDatabase() {
  console.log('警告: 此操作将重置整个数据库，所有数据将丢失!');
  
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question('确定要重置数据库吗? (输入"YES"确认): ', async (answer) => {
      if (answer === 'YES') {
        try {
          // 重新同步所有模型，强制创建新表
          await sequelize.sync({ force: true });
          console.log('数据库已重置');
          
          // 创建基础数据
          await createBaseData();
        } catch (error) {
          console.error('重置失败:', error);
        }
      } else {
        console.log('操作已取消');
      }
      
      rl.close();
      resolve();
    });
  });
}

// 创建基础数据
async function createBaseData() {
  // 创建一些基础币种
  const baseCoins = [
    { symbol: 'BTC', name: 'Bitcoin' },
    { symbol: 'ETH', name: 'Ethereum' },
    { symbol: 'BNB', name: 'Binance Coin' },
    { symbol: 'SOL', name: 'Solana' },
    { symbol: 'XRP', name: 'Ripple' },
    { symbol: 'DOGE', name: 'Dogecoin' },
    { symbol: 'ADA', name: 'Cardano' },
    { symbol: 'AVAX', name: 'Avalanche' }
  ];
  
  for (const coinData of baseCoins) {
    await db.Coin.create(coinData);
  }
  
  console.log(`创建了${baseCoins.length}个基础币种`);
}

// 执行主函数
fixDatabase();