import React from 'react';
import OtcIndexTable from '../components/OtcIndexTable';

// 生成演示数据
const generateDemoData = (count = 50) => {
  return Array.from({ length: count }, (_, index) => ({
    symbol: `COIN${index + 1}`,
    otcIndex: (800 + Math.random() * 400).toFixed(2),
    explosionIndex: (100 + Math.random() * 300).toFixed(2),
    schellingPoint: (10 + Math.random() * 100).toFixed(2),
    entryExitType: index % 4 === 0 ? 'entry' : index % 4 === 1 ? 'exit' : 'neutral',
    entryExitDay: Math.floor(Math.random() * 7) + 1,
    entryExitQuality: ['高质量进场', '低质量进场', '高质量退场', '低质量退场', '观望'][Math.floor(Math.random() * 5)],
    otcIndexChangePercent: ((Math.random() - 0.5) * 20).toFixed(2),
    explosionIndexChangePercent: ((Math.random() - 0.5) * 30).toFixed(2),
    previousDayData: {
      otc_index: (780 + Math.random() * 400).toFixed(2),
      explosion_index: (90 + Math.random() * 300).toFixed(2)
    }
  }));
};

function PaginationDemo() {
  const demoData = generateDemoData(50);

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1>场外指数表分页功能演示</h1>
      <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f0f2f5', borderRadius: '6px' }}>
        <h3>新增功能说明：</h3>
        <ul>
          <li>✅ <strong>每页显示数量选择器</strong>：用户可以选择每页显示 10、20、50 或 100 条记录</li>
          <li>✅ <strong>快速跳转</strong>：用户可以直接输入页码快速跳转到指定页面</li>
          <li>✅ <strong>显示统计信息</strong>：显示当前页范围和总记录数（如：第 1-10 条，共 50 条）</li>
          <li>✅ <strong>响应式设计</strong>：在移动端自动切换为简化的列表视图</li>
        </ul>
      </div>
      
      <OtcIndexTable coins={demoData} loading={false} />
      
      <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#e6f7ff', borderRadius: '6px' }}>
        <h3>使用说明：</h3>
        <ol>
          <li>在表格底部找到分页控件</li>
          <li>点击"10 条/页"下拉菜单可以选择每页显示的记录数</li>
          <li>使用页码按钮或输入框进行页面跳转</li>
          <li>查看左下角的统计信息了解当前显示范围</li>
        </ol>
      </div>
    </div>
  );
}

export default PaginationDemo;
