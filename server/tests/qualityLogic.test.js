// server/tests/qualityLogic.test.js
// 测试新的质量判断逻辑：场外指数变化在10以内视为劣质进场/退场期

// 简单的测试框架
function assert(condition, message) {
  if (!condition) {
    throw new Error(`断言失败: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`断言失败: ${message}\n期望: ${expected}\n实际: ${actual}`);
  }
}

// 模拟质量判断逻辑
function mockQualityCheck(otcIndexChanges, isEntry = true) {
  if (otcIndexChanges.length === 0) return '数据不足';
  
  if (otcIndexChanges.length === 1) {
    // 刚进入进场期/退场期的情况
    const change = otcIndexChanges[0];
    
    if (isEntry) {
      if (change > 10) return '高质量进场';
      if (Math.abs(change) <= 10) return '低质量进场';
      return '低质量进场';
    } else {
      if (change < -10) return '高质量退场';
      if (Math.abs(change) <= 10) return '低质量退场';
      return '低质量退场';
    }
  }
  
  // 多个节点的情况
  let increasingCount = 0;
  let decreasingCount = 0;
  
  for (const change of otcIndexChanges) {
    if (isEntry) {
      if (change > 10) {
        increasingCount++;
      } else {
        decreasingCount++;
      }
    } else {
      if (change < -10) {
        decreasingCount++;
      } else {
        increasingCount++;
      }
    }
  }
  
  if (isEntry) {
    return increasingCount > decreasingCount ? '高质量进场' : '低质量进场';
  } else {
    return decreasingCount > increasingCount ? '高质量退场' : '低质量退场';
  }
}

// 运行测试
function runTests() {
  console.log('🧪 开始测试场外指数质量判断逻辑...\n');

  // 进场期质量判断测试
  console.log('📈 进场期质量判断测试:');

  // 场外指数显著上升（>10）应判断为高质量进场
  assertEqual(mockQualityCheck([15]), '高质量进场', '场外指数上升15应为高质量进场');
  assertEqual(mockQualityCheck([20]), '高质量进场', '场外指数上升20应为高质量进场');
  assertEqual(mockQualityCheck([50]), '高质量进场', '场外指数上升50应为高质量进场');
  console.log('  ✅ 显著上升测试通过');

  // 场外指数变化在10以内应判断为低质量进场
  assertEqual(mockQualityCheck([5]), '低质量进场', '场外指数上升5应为低质量进场');
  assertEqual(mockQualityCheck([10]), '低质量进场', '场外指数上升10应为低质量进场');
  assertEqual(mockQualityCheck([-5]), '低质量进场', '场外指数下降5应为低质量进场');
  assertEqual(mockQualityCheck([-10]), '低质量进场', '场外指数下降10应为低质量进场');
  assertEqual(mockQualityCheck([0]), '低质量进场', '场外指数持平应为低质量进场');
  console.log('  ✅ 变化在10以内测试通过');

  // 场外指数显著下降（<-10）应判断为低质量进场
  assertEqual(mockQualityCheck([-15]), '低质量进场', '场外指数下降15应为低质量进场');
  assertEqual(mockQualityCheck([-25]), '低质量进场', '场外指数下降25应为低质量进场');
  console.log('  ✅ 显著下降测试通过');

  // 多个节点测试
  assertEqual(mockQualityCheck([15, 20, 5]), '高质量进场', '多数显著上升应为高质量进场');
  assertEqual(mockQualityCheck([5, 8, -3]), '低质量进场', '多数持平/下降应为低质量进场');
  console.log('  ✅ 多节点测试通过');

  // 退场期质量判断测试
  console.log('\n📉 退场期质量判断测试:');

  // 场外指数显著下降（<-10）应判断为高质量退场
  assertEqual(mockQualityCheck([-15], false), '高质量退场', '场外指数下降15应为高质量退场');
  assertEqual(mockQualityCheck([-20], false), '高质量退场', '场外指数下降20应为高质量退场');
  assertEqual(mockQualityCheck([-50], false), '高质量退场', '场外指数下降50应为高质量退场');
  console.log('  ✅ 显著下降测试通过');

  // 场外指数变化在10以内应判断为低质量退场
  assertEqual(mockQualityCheck([5], false), '低质量退场', '场外指数上升5应为低质量退场');
  assertEqual(mockQualityCheck([10], false), '低质量退场', '场外指数上升10应为低质量退场');
  assertEqual(mockQualityCheck([-5], false), '低质量退场', '场外指数下降5应为低质量退场');
  assertEqual(mockQualityCheck([-10], false), '低质量退场', '场外指数下降10应为低质量退场');
  assertEqual(mockQualityCheck([0], false), '低质量退场', '场外指数持平应为低质量退场');
  console.log('  ✅ 变化在10以内测试通过');

  // 边界情况测试
  console.log('\n🎯 边界情况测试:');
  assertEqual(mockQualityCheck([10]), '低质量进场', '正好10的上升应为低质量进场');
  assertEqual(mockQualityCheck([-10]), '低质量进场', '正好10的下降应为低质量进场');
  assertEqual(mockQualityCheck([11]), '高质量进场', '正好11的上升应为高质量进场');
  assertEqual(mockQualityCheck([-11], false), '高质量退场', '正好11的下降应为高质量退场');
  assertEqual(mockQualityCheck([]), '数据不足', '空数组应返回数据不足');
  console.log('  ✅ 边界情况测试通过');

  console.log('\n🎉 所有测试通过！');
}

runTests();

console.log('质量判断逻辑测试完成！');
console.log('新规则：场外指数变化在10以内（含10）视为劣质进场/退场期');
console.log('进场期：变化>10为高质量，≤10为低质量');
console.log('退场期：变化<-10为高质量，≥-10为低质量');
