// server/tests/checkLatestData.js
// 检查数据库中的最新数据

const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');

// 初始化数据库连接
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, '../database.sqlite'), // 检查server目录下的数据库
  logging: false // 关闭SQL日志
});

// 定义DailyMetric模型
const DailyMetric = sequelize.define('DailyMetric', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  coin_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  otc_index: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  explosion_index: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  schelling_point: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  entry_exit_type: {
    type: DataTypes.STRING,
    allowNull: true
  },
  entry_exit_day: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  near_threshold: {
    type: DataTypes.BOOLEAN,
    allowNull: true
  }
}, {
  tableName: 'DailyMetrics',
  timestamps: true
});

async function checkLatestData() {
  try {
    console.log('🔍 检查数据库中的最新数据...\n');

    // 查询最新的10个日期
    const latestDates = await sequelize.query(`
      SELECT date, COUNT(*) as count 
      FROM DailyMetrics 
      GROUP BY date 
      ORDER BY date DESC 
      LIMIT 10
    `, { type: Sequelize.QueryTypes.SELECT });

    console.log('📅 最新的10个数据日期:');
    latestDates.forEach((row, index) => {
      console.log(`  ${index + 1}. ${row.date} (${row.count}条记录)`);
    });

    if (latestDates.length > 0) {
      const latestDate = latestDates[0].date;
      console.log(`\n🎯 当前最新数据日期: ${latestDate}`);
      
      // 计算距离今天的天数
      const today = new Date();
      const latest = new Date(latestDate);
      const diffTime = today - latest;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      console.log(`📊 距离今天 (${today.toISOString().split('T')[0]}) 相差: ${diffDays} 天`);
      
      if (diffDays > 7) {
        console.log('⚠️  警告: 数据已经超过一周未更新！');
      } else if (diffDays > 1) {
        console.log('⚠️  注意: 数据需要更新');
      } else {
        console.log('✅ 数据是最新的');
      }

      // 查询最新日期的具体数据
      console.log(`\n📋 ${latestDate} 的数据详情:`);
      const latestData = await DailyMetric.findAll({
        where: { date: latestDate },
        order: [['coin_id', 'ASC']],
        limit: 5
      });

      latestData.forEach(record => {
        console.log(`  币种ID ${record.coin_id}: 场外指数=${record.otc_index}, 爆破指数=${record.explosion_index}, 进退场=${record.entry_exit_type || '无'}`);
      });

      if (latestData.length > 5) {
        console.log(`  ... 还有 ${latestData.length - 5} 条记录`);
      }
    } else {
      console.log('❌ 数据库中没有找到任何数据！');
    }

  } catch (error) {
    console.error('❌ 检查数据时出错:', error.message);
  } finally {
    await sequelize.close();
  }
}

checkLatestData();
