// server/tests/nodeNamingTest.js
// 测试新的节点命名逻辑

console.log('🧪 测试节点命名逻辑...\n');

// 模拟进场期节点命名
function getEntryNodeName(nodeNum, dipNodesBeforeEntry) {
  if (nodeNum <= dipNodesBeforeEntry) {
    return `${nodeNum}爆破跌200`;
  } else if (nodeNum === dipNodesBeforeEntry + 1) {
    return `${nodeNum}进场期第一天`;
  } else {
    return `${nodeNum}爆破跌200`;
  }
}

// 模拟退场期节点命名
function getExitNodeName(nodeNum, turnPositiveNodesBeforeExit) {
  if (nodeNum <= turnPositiveNodesBeforeExit) {
    return `${nodeNum}爆破负变正`;
  } else if (nodeNum === turnPositiveNodesBeforeExit + 1) {
    return `${nodeNum}退场期第一天`;
  } else {
    return `${nodeNum}爆破负变正`;
  }
}

console.log('📈 进场期节点命名测试:');
console.log('假设有3个爆破跌200节点在进场期开始前');

// 测试进场期节点命名
const dipNodesBeforeEntry = 3;
for (let i = 1; i <= 6; i++) {
  const nodeName = getEntryNodeName(i, dipNodesBeforeEntry);
  console.log(`  节点${i}: ${nodeName}`);
}

console.log('\n📉 退场期节点命名测试:');
console.log('假设有2个爆破负变正节点在退场期开始前');

// 测试退场期节点命名
const turnPositiveNodesBeforeExit = 2;
for (let i = 1; i <= 5; i++) {
  const nodeName = getExitNodeName(i, turnPositiveNodesBeforeExit);
  console.log(`  节点${i}: ${nodeName}`);
}

console.log('\n🎯 实际应用示例:');

// 模拟BTC的情况（从之前的日志）
console.log('BTC (CoinID 1) - 进场期分析:');
console.log('进场期开始前有1个爆破跌200节点，进场期从节点3开始');
const btcDipNodesBeforeEntry = 1; // 进场期开始前有1个爆破跌200节点
const btcEntryStartNodeNum = 3; // 进场期从节点3开始
const btcNodes = [
  { num: 3, date: '2025-06-25', otc: 835, isEntryStart: true },
  { num: 4, date: '2025-07-01', otc: 995 },
  { num: 5, date: '2025-07-05', otc: 773 },
  { num: 6, date: '2025-07-16', otc: 1543 }
];

// 修正的节点命名函数，考虑进场期开始节点
function getBtcEntryNodeName(nodeNum, entryStartNodeNum) {
  if (nodeNum === entryStartNodeNum) {
    return `${nodeNum}进场期第一天`;
  } else {
    return `${nodeNum}爆破跌200`;
  }
}

for (let i = 0; i < btcNodes.length - 1; i++) {
  const current = btcNodes[i];
  const next = btcNodes[i + 1];
  const currentName = getBtcEntryNodeName(current.num, btcEntryStartNodeNum);
  const nextName = getBtcEntryNodeName(next.num, btcEntryStartNodeNum);
  const change = next.otc - current.otc;
  const changePercent = ((change / current.otc) * 100).toFixed(2);

  console.log(`  ${currentName}[${current.date}](${current.otc}) -> ${nextName}[${next.date}](${next.otc})`);
  console.log(`  场外指数变化: ${change} (${changePercent}%)`);
  console.log('');
}

console.log('✅ 节点命名逻辑测试完成！');
console.log('\n📋 命名规则总结:');
console.log('进场期:');
console.log('  - 进场期开始前的节点: 1爆破跌200, 2爆破跌200, ...');
console.log('  - 进场期第一天: N进场期第一天 (N = 进场期开始前节点数 + 1)');
console.log('  - 进场期开始后的节点: (N+1)爆破跌200, (N+2)爆破跌200, ...');
console.log('');
console.log('退场期:');
console.log('  - 退场期开始前的节点: 1爆破负变正, 2爆破负变正, ...');
console.log('  - 退场期第一天: N退场期第一天 (N = 退场期开始前节点数 + 1)');
console.log('  - 退场期开始后的节点: (N+1)爆破负变正, (N+2)爆破负变正, ...');
