// server/tests/checkSUI.js
// 检查SUI的质量判断逻辑

const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, '../database.sqlite'),
  logging: false
});

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

async function checkSUI() {
  try {
    console.log('🔍 分析SUI的质量判断逻辑...\n');

    const coin = await Coin.findOne({ where: { symbol: 'SUI' } });
    if (!coin) {
      console.log('❌ 未找到SUI币种');
      return;
    }
    
    console.log(`✅ SUI币种信息: ID=${coin.id}, Symbol=${coin.symbol}, Name=${coin.name}\n`);
    
    // 获取SUI的所有数据，按日期排序
    const allMetrics = await DailyMetric.findAll({
      where: { coin_id: coin.id },
      order: [['date', 'ASC']]
    });
    
    console.log('📊 SUI的所有数据记录:');
    console.log('日期\t\t场外指数\t爆破指数\t进退场\t天数');
    console.log('----\t\t--------\t--------\t------\t----');
    
    allMetrics.forEach(metric => {
      const typeText = metric.entry_exit_type === 'entry' ? '进场' : 
                      metric.entry_exit_type === 'exit' ? '退场' : '中性';
      const dayText = metric.entry_exit_day ? `第${metric.entry_exit_day}天` : '-';
      console.log(`${metric.date}\t${metric.otc_index}\t\t${metric.explosion_index}\t\t${typeText}\t${dayText}`);
    });
    
    // 查找爆破负变正的节点（爆破指数从负数变为正数）
    console.log('\n🔍 查找爆破负变正节点:');
    const turnPositiveNodes = [];
    
    for (let i = 1; i < allMetrics.length; i++) {
      const prev = allMetrics[i-1];
      const curr = allMetrics[i];
      
      if (prev.explosion_index < 0 && curr.explosion_index > 0) {
        turnPositiveNodes.push({
          date: curr.date,
          prevExplosion: prev.explosion_index,
          currExplosion: curr.explosion_index,
          otcIndex: curr.otc_index,
          nodeNum: turnPositiveNodes.length + 1
        });
      }
    }
    
    if (turnPositiveNodes.length === 0) {
      console.log('❌ 未找到爆破负变正节点');
      return;
    }
    
    console.log('爆破负变正节点:');
    turnPositiveNodes.forEach(node => {
      console.log(`  ${node.nodeNum}爆破负变正[${node.date}]: ${node.prevExplosion} -> ${node.currExplosion}, 场外指数: ${node.otcIndex}`);
    });
    
    // 查找退场期开始
    const exitMetrics = allMetrics.filter(m => m.entry_exit_type === 'exit');
    if (exitMetrics.length === 0) {
      console.log('\n❌ 未找到退场期数据');
      return;
    }
    
    const exitStart = exitMetrics[0];
    console.log(`\n📈 退场期开始: ${exitStart.date}, 场外指数: ${exitStart.otc_index}`);
    
    // 分析质量判断逻辑
    console.log('\n🎯 质量判断分析:');
    
    if (turnPositiveNodes.length >= 2) {
      // 情况1: 已进入退场期，分析相邻节点趋势
      console.log('情况: 已进入退场期，分析相邻节点趋势');
      
      // 构建关键节点序列：退场期第一天 + 后续转正节点
      const exitStartNodeNum = turnPositiveNodes.length + 1;
      const afterExitNodes = turnPositiveNodes.filter(node => new Date(node.date) > new Date(exitStart.date));
      
      const keyNodes = [
        { date: exitStart.date, otc_index: exitStart.otc_index, nodeNum: exitStartNodeNum, type: 'exit_start' },
        ...afterExitNodes.map((node, index) => ({
          date: node.date,
          otc_index: node.otcIndex,
          nodeNum: exitStartNodeNum + 1 + index,
          type: 'turn_positive'
        }))
      ];
      
      console.log('关键节点序列:');
      keyNodes.forEach(node => {
        const nodeName = node.type === 'exit_start' ? `${node.nodeNum}退场期第一天` : `${node.nodeNum}爆破负变正`;
        console.log(`  ${nodeName}[${node.date}]: 场外指数 ${node.otc_index}`);
      });
      
      if (keyNodes.length >= 2) {
        console.log('\n节点间变化分析:');
        let decreasingCount = 0;
        let increasingCount = 0;
        
        for (let i = 0; i < keyNodes.length - 1; i++) {
          const current = keyNodes[i];
          const next = keyNodes[i + 1];
          
          const currentName = current.type === 'exit_start' ? `${current.nodeNum}退场期第一天` : `${current.nodeNum}爆破负变正`;
          const nextName = next.type === 'exit_start' ? `${next.nodeNum}退场期第一天` : `${next.nodeNum}爆破负变正`;
          
          const change = next.otc_index - current.otc_index;
          const changePercent = (change / current.otc_index * 100).toFixed(2);
          
          console.log(`  ${currentName}[${current.date}](${current.otc_index}) -> ${nextName}[${next.date}](${next.otc_index})`);
          console.log(`  场外指数变化: ${change} (${changePercent}%)`);
          
          if (Math.abs(changePercent) < 5) {
            increasingCount++; // 持平趋势（坏现象）
            console.log(`  ✗ 持平趋势（变化<±5%）`);
          } else if (change < 0) {
            decreasingCount++; // 下降趋势（好现象）
            console.log(`  ✓ 下降趋势`);
          } else {
            increasingCount++; // 上升趋势（坏现象）
            console.log(`  ✗ 上升趋势`);
          }
        }
        
        console.log(`\n📊 趋势统计:`);
        console.log(`  下降次数: ${decreasingCount} (好现象)`);
        console.log(`  上升/持平次数: ${increasingCount} (坏现象)`);
        
        if (decreasingCount > increasingCount) {
          console.log(`\n✅ 结果: 下降次数 > 上升/持平次数 -> 高质量退场`);
        } else {
          console.log(`\n❌ 结果: 下降次数 ≤ 上升/持平次数 -> 低质量退场`);
        }
      }
    } else {
      // 情况2: 刚进入退场期
      console.log('情况: 刚进入退场期，比较最后一个爆破负变正节点与退场期第一天');
      
      const lastTurnPositive = turnPositiveNodes[turnPositiveNodes.length - 1];
      const change = exitStart.otc_index - lastTurnPositive.otcIndex;
      const changePercent = (change / lastTurnPositive.otcIndex * 100).toFixed(2);
      
      console.log(`${turnPositiveNodes.length}爆破负变正[${lastTurnPositive.date}](${lastTurnPositive.otcIndex}) -> ${turnPositiveNodes.length + 1}退场期第一天[${exitStart.date}](${exitStart.otc_index})`);
      console.log(`场外指数变化: ${change} (${changePercent}%)`);
      
      if (Math.abs(changePercent) < 5) {
        console.log(`\n❌ 结果: 场外指数变化<±5%，近乎持平 -> 低质量退场`);
      } else if (change < 0) {
        console.log(`\n✅ 结果: 场外指数下降且变化≥5% -> 高质量退场`);
      } else {
        console.log(`\n❌ 结果: 场外指数上升 -> 低质量退场`);
      }
    }
    
  } catch (error) {
    console.error('❌ 查询SUI数据时出错:', error.message);
  } finally {
    await sequelize.close();
  }
}

checkSUI();
