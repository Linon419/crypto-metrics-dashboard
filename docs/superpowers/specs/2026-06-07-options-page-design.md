# 期权功能页面设计

日期：2026-06-07

状态：已确认，待实现计划

## 目标

在当前 Crypto Metrics Dashboard 中新增一个名为“期权”的功能页面，作为《魔方内参》期权课程原文和策略操作的查阅入口。页面需要帮助用户从市场状态出发，找到对应期权策略、课程原文、操作步骤、风险点和相关图示。

## 资料来源

主源：

- `/Users/yang/Documents/知识星球/魔方内参/原文/*.docx`

分类参考：

- `/Users/yang/Documents/知识星球/魔方内参/笔记/课程策略总整理.md`
- `/Users/yang/Documents/知识星球/魔方内参/笔记/卖方第一战法_详细操作手册.md`

图示参考：

- `/Users/yang/Documents/知识星球/魔方内参/assets/payoffs/`
- `/Users/yang/Documents/知识星球/魔方内参/assets/strategy/`
- `/Users/yang/Documents/知识星球/魔方内参/assets/day*/`

数据参考：

- `/Users/yang/Documents/知识星球/魔方内参/data/*.json`

课程目录中的 `AGENTS.md` 指定 `原文/*.docx` 为主要课程源。整理笔记用于建立分类和辅助解释，页面内每段老师原文都需要保留来源文件。

## 页面入口

新增路由：

- `/options`

顶部导航新增：

- `期权`

登录后的用户可以访问该页面。页面复用现有 Dashboard 的视觉系统和认证机制。

## 页面结构

页面从上到下分为四个区域。

### 1. BTC 隐含波动率 K 线图

顶部展示 BTC 隐含波动率 K 线图，数据来自 Deribit DVOL 历史数据。

展示内容：

- DVOL `open / high / low / close`
- 当前 `IV`
- 当前 `RV`
- `IV - RV`
- 数据更新时间
- 刷新按钮

图表失败时显示清晰错误提示和重试按钮，策略资料库保持可用。

### 2. 双目录筛选区

页面使用两个并列目录。

一级目录：市场状态，回答“现在是什么盘面”。

- 波动率开始上升
- 低 `IV` + 高 `RV` 预期
- 高 `IV` + 预期回落
- 区间震荡
- 近端横盘 + 远端保留波动
- 单边趋势开始
- 已有底仓需要保护
- 偏多合成与结构增强

二级目录：策略属性，回答“这类策略本质在赚什么”。

- 买入波动率
- 卖出波动率
- 买入方向
- 卖方收租
- 时间结构
- 区间结构
- 趋势价差
- 底仓保护
- 合成多头
- 课程组合结构

页面支持关键词搜索。搜索字段覆盖中文策略名、英文策略名、Greek、课程日期、来源文件和原文关键词。

### 3. 策略卡片列表

每张策略卡片包含：

- 中文名和英文名
- 市场状态标签
- 策略属性标签
- 什么时候用
- 怎么搭
- 怎么操作
- 核心 Greeks
- 主要风险
- 来源课程
- 相关图
- 老师原文展开入口

卡片阅读顺序：

1. 现在是什么行情
2. 用什么策略
3. 为什么用
4. 怎么搭
5. 怎么操作
6. 主要风险
7. 老师原文

### 4. 原文详情抽屉

点击策略卡片后打开详情抽屉。

详情内容：

- 按课程时间排列原文片段
- 每段显示来源文件
- 支持复制原文
- 显示相关图片
- 显示课程整理版操作步骤

## 分类设计

每个策略可以同时属于多个市场状态和多个策略属性。

| 市场状态 | 策略 |
|---|---|
| 波动率开始上升 | `long straddle`、`long strangle`、方向明确时的 `long call / long put` |
| 低 `IV` + 高 `RV` 预期 | `gamma scalping`、正 `gamma` 核心腿 |
| 高 `IV` + 预期回落 | `short straddle`、`short strangle` |
| 区间震荡 | 铁鹰策略（`iron condor`）、`butterfly` |
| 近端横盘 + 远端保留波动 | `calendar spread`、`diagonal spread` |
| 单边趋势开始 | `bull put spread`、`bull call spread`、`bear put spread`、比例价差、鳄鱼策略 |
| 已有底仓需要保护 | `collar`、`put-spread collar`、`protective put` |
| 偏多合成与结构增强 | `risk reversal`、`synthetic long stock`、牛三腿、看涨螃蟹 |

策略属性示例：

| 策略 | 策略属性 |
|---|---|
| `long straddle` | 买入波动率 |
| `short strangle` | 卖出波动率、卖方收租 |
| 铁鹰策略（`iron condor`） | 卖出波动率、区间结构 |
| `calendar spread` | 时间结构 |
| `bull put spread` | 趋势价差、卖方收租 |
| `collar` | 底仓保护 |
| `risk reversal` | 合成多头、课程组合结构 |

第一套战法中的期货桥接、近月期权修仓、远端黑天鹅腿归入第一套战法附录入口。专门期权策略目录聚焦可独立学习和复盘的策略结构。

## 策略操作内容

每个策略都需要提供“课程整理版”操作步骤。操作步骤来自老师原文和整理笔记，并保留原文证据。

操作步骤字段：

- 判断市场状态
- 选择到期日
- 选择行权价
- 选择买入腿和卖出腿
- 检查核心 Greeks
- 检查最大盈利和最大亏损
- 持仓中观察指标
- 止盈、调整或退出条件

示例：铁鹰策略（`iron condor`）

- 判断 BTC 是否处于明确区间
- 判断 `IV` 是否偏高并存在回落空间
- 下方建立 `bull put spread`
- 上方建立 `bear call spread`
- 确认四条腿同标的、同到期
- 检查净收入和最大亏损比例
- 持仓中观察危险侧短腿、`IV` 回落和剩余权利金
- 到目标权利金比例或区间失效时退出

## 数据索引

生成文件：

- `src/data/optionsKnowledgeIndex.json`

每条记录结构：

```json
{
  "id": "iron-condor",
  "nameZh": "铁鹰策略",
  "nameEn": "iron condor",
  "marketStates": ["区间震荡", "高 IV + 预期回落"],
  "strategyTypes": ["卖出波动率", "区间结构"],
  "whenToUse": "预期价格留在明确上下边界内，IV 有回落空间。",
  "setup": ["下方 bull put spread", "上方 bear call spread", "四条腿同标的、同到期"],
  "operationSteps": ["判断区间边界", "选择到期日", "确定上下短腿", "买保护长腿封顶风险", "持仓观察危险侧和 IV 回落", "达到目标权利金比例后退出"],
  "coreGreeks": ["theta", "vega", "gamma"],
  "risks": ["单边突破区间", "最大亏损大于权利金收入", "危险侧处理太慢"],
  "sourceLessons": ["day11"],
  "quotes": [
    {
      "sourceFile": "day11微信录音 魔方_20260414225958_原文.docx",
      "excerpt": "由生成脚本抽取的老师原文",
      "startHint": "原文片段开头短句",
      "endHint": "原文片段结尾短句"
    }
  ],
  "images": ["assets/payoffs/iron-condor-payoff.png"]
}
```

## 生成脚本

新增脚本：

- `scripts/build-options-knowledge-index.js`

脚本职责：

- 读取 `/Users/yang/Documents/知识星球/魔方内参/原文/*.docx`
- 使用策略关键词定位相关原文片段
- 读取 `课程策略总整理.md` 建立分类和操作骨架
- 关联 `assets/payoffs/`、`assets/strategy/` 和课程图片
- 写入 `src/data/optionsKnowledgeIndex.json`
- 生成抽取报告，列出每个策略命中的课程、文件和片段数量

后续更新流程：

1. 在“魔方内参”目录新增课程资料
2. 运行生成脚本
3. 检查抽取报告
4. 刷新 Dashboard 期权页

## 错误状态

- 原文索引为空：页面显示“暂无期权策略内容”，并提示重新运行生成脚本。
- DVOL 接口失败：顶部图表显示重试按钮，策略库继续展示。
- 某个策略缺少原文：卡片显示“待补充来源”，抽取报告列出该策略。
- 某张图片缺失：卡片保留文字内容，图片区域显示缺失路径。
- 外部路径读取失败：生成脚本输出失败路径和建议检查项。

## 验收标准

- 顶部导航出现 `期权`。
- 登录后可以访问 `/options`。
- 顶部展示 BTC 隐含波动率 K 线图或清晰失败提示。
- 可以按市场状态筛选策略。
- 可以按策略属性筛选策略。
- 可以搜索 `铁鹰`、`iron condor`、`卖出波动率`、`gamma` 等关键词。
- 策略卡片包含“什么时候用 / 怎么搭 / 怎么操作 / 风险 / 老师原文 / 图片”。
- 核心策略至少包含：`long straddle`、`short strangle`、`calendar spread`、`diagonal spread`、`butterfly`、`collar`、`gamma scalping`、铁鹰策略、`bull put spread`、`risk reversal`、鳄鱼策略。
- 原文详情显示来源文件名。
- 生成报告说明每个策略来自哪些 `原文/*.docx`。

## 验证计划

实现阶段需要执行：

- 生成脚本 dry run，检查抽取报告
- 前端单元测试覆盖筛选、搜索和空状态
- 后端或工具函数测试覆盖 DVOL K 线数据格式
- `npm run build`
- 本地浏览器验证桌面和移动端 `/options`

## 待实现模块

- `scripts/build-options-knowledge-index.js`
- `src/data/optionsKnowledgeIndex.json`
- `src/components/OptionsPage.jsx`
- `src/components/OptionsVolatilityChart.jsx`
- `src/components/OptionsStrategyCard.jsx`
- `src/components/OptionsStrategyDrawer.jsx`
- `src/services/api.js` 中的 DVOL 历史数据请求方法
- `server/routes/volatility.js` 和 `server/utils/btcVolatility.js` 中的历史 K 线支持
- `src/App.js` 中的导航和路由
