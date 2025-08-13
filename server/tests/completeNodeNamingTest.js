// server/tests/completeNodeNamingTest.js
// 完整的节点命名系统测试

console.log('🧪 完整节点命名系统测试...\n');

// 模拟进场期节点命名
function getEntryNodeName(nodeNum, entryStartNodeNum) {
  if (nodeNum === entryStartNodeNum) {
    return `${nodeNum}进场期第一天`;
  } else {
    return `${nodeNum}爆破跌200`;
  }
}

// 模拟退场期节点命名
function getExitNodeName(nodeNum, exitStartNodeNum) {
  if (nodeNum === exitStartNodeNum) {
    return `${nodeNum}退场期第一天`;
  } else {
    return `${nodeNum}爆破负变正`;
  }
}

console.log('📈 进场期完整示例:');
console.log('场景：进场期开始前有2个爆破跌200节点，进场期从节点3开始，之后又有3个爆破跌200节点');

const entryExample = {
  beforeEntryNodes: 2,
  entryStartNodeNum: 3,
  afterEntryNodes: 3
};

const entryNodes = [];
// 进场期开始前的节点
for (let i = 1; i <= entryExample.beforeEntryNodes; i++) {
  entryNodes.push({ num: i, name: getEntryNodeName(i, entryExample.entryStartNodeNum) });
}
// 进场期第一天
entryNodes.push({ num: entryExample.entryStartNodeNum, name: getEntryNodeName(entryExample.entryStartNodeNum, entryExample.entryStartNodeNum) });
// 进场期开始后的节点
for (let i = 1; i <= entryExample.afterEntryNodes; i++) {
  const nodeNum = entryExample.entryStartNodeNum + i;
  entryNodes.push({ num: nodeNum, name: getEntryNodeName(nodeNum, entryExample.entryStartNodeNum) });
}

entryNodes.forEach(node => {
  console.log(`  节点${node.num}: ${node.name}`);
});

console.log('\n📉 退场期完整示例:');
console.log('场景：退场期开始前有1个爆破负变正节点，退场期从节点2开始，之后又有2个爆破负变正节点');

const exitExample = {
  beforeExitNodes: 1,
  exitStartNodeNum: 2,
  afterExitNodes: 2
};

const exitNodes = [];
// 退场期开始前的节点
for (let i = 1; i <= exitExample.beforeExitNodes; i++) {
  exitNodes.push({ num: i, name: getExitNodeName(i, exitExample.exitStartNodeNum) });
}
// 退场期第一天
exitNodes.push({ num: exitExample.exitStartNodeNum, name: getExitNodeName(exitExample.exitStartNodeNum, exitExample.exitStartNodeNum) });
// 退场期开始后的节点
for (let i = 1; i <= exitExample.afterExitNodes; i++) {
  const nodeNum = exitExample.exitStartNodeNum + i;
  exitNodes.push({ num: nodeNum, name: getExitNodeName(nodeNum, exitExample.exitStartNodeNum) });
}

exitNodes.forEach(node => {
  console.log(`  节点${node.num}: ${node.name}`);
});

console.log('\n🎯 实际数据模拟:');

// 模拟BTC的进场期分析
console.log('BTC进场期分析 (进场期开始前1个节点，进场期从节点3开始):');
const btcData = [
  { num: 2, date: '2025-05-27', otc: 1163, name: '2爆破跌200' },
  { num: 3, date: '2025-06-25', otc: 835, name: '3进场期第一天' },
  { num: 4, date: '2025-07-01', otc: 995, name: '4爆破跌200' },
  { num: 5, date: '2025-07-05', otc: 773, name: '5爆破跌200' },
  { num: 6, date: '2025-07-16', otc: 1543, name: '6爆破跌200' }
];

// 显示节点间的变化
for (let i = 1; i < btcData.length; i++) {
  const prev = btcData[i-1];
  const curr = btcData[i];
  const change = curr.otc - prev.otc;
  const changePercent = ((change / prev.otc) * 100).toFixed(2);
  
  console.log(`  ${prev.name}[${prev.date}](${prev.otc}) -> ${curr.name}[${curr.date}](${curr.otc})`);
  console.log(`  场外指数变化: ${change} (${changePercent}%)`);
  
  if (Math.abs(changePercent) < 5) {
    console.log(`  ✗ 持平趋势（变化<±5%）`);
  } else if (change > 0) {
    console.log(`  ✓ 上升趋势`);
  } else {
    console.log(`  ✗ 下降趋势`);
  }
  console.log('');
}

console.log('✅ 完整节点命名系统测试完成！');

console.log('\n📋 最终命名规则:');
console.log('进场期:');
console.log('  - 进场期开始前: 1爆破跌200, 2爆破跌200, ...');
console.log('  - 进场期第一天: N进场期第一天 (N由实际节点编号决定)');
console.log('  - 进场期开始后: (N+1)爆破跌200, (N+2)爆破跌200, ...');
console.log('');
console.log('退场期:');
console.log('  - 退场期开始前: 1爆破负变正, 2爆破负变正, ...');
console.log('  - 退场期第一天: N退场期第一天 (N由实际节点编号决定)');
console.log('  - 退场期开始后: (N+1)爆破负变正, (N+2)爆破负变正, ...');
console.log('');
console.log('🔍 关键特点:');
console.log('  - 节点编号保持连续性和唯一性');
console.log('  - 进场期/退场期第一天有特殊标识');
console.log('  - 节点名称清楚表明节点类型和时间关系');
console.log('  - 支持质量判断逻辑中的±5%持平判断');
