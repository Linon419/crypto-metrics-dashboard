# BTC 期权实时搭建与盈亏图设计

## 状态

已在 2026-06-08 与用户确认以下范围：

- 覆盖现有 20 个期权策略。
- 每个策略详情页提供实时自动搭建和手动参数调整。
- 盈亏图默认采用到期盈亏、当前估算、IV/时间场景三类口径。
- 实现路径采用 `REST 缓存 + 选中策略精算`。

## 目标

升级 `/options` 页面，让它从课程原文目录扩展为期权策略复盘工具。用户可以按行情状态或策略类型进入任一策略，查看《魔方内参》原文、老师讲法、实时 BTC 期权腿位、具体搭建设置、关键 Greeks、盈亏图和 IV/时间场景。

## 范围边界

第一阶段聚焦 BTC inverse options 的教学演算、复盘和策略结构查看：

- 行情数据使用 Deribit public API。
- 交易标的使用 BTC options。
- 默认底仓类策略按 `1 BTC` 虚拟底仓展示。
- 下单、账户持仓同步、真实保证金模拟进入后续阶段。
- USDC linear options、多币种 options、WebSocket 推送增强进入后续阶段。

## 数据来源与缓存

### Deribit 数据接口

| 用途 | Deribit API | 关键字段 |
| --- | --- | --- |
| 合约列表 | `public/get_instruments?currency=BTC&kind=option&expired=false` | `instrument_name`, `expiration_timestamp`, `strike`, `option_type`, `state`, `min_trade_amount` |
| 期权链摘要 | `public/get_book_summary_by_currency?currency=BTC&kind=option` | `bid_price`, `ask_price`, `mid_price`, `mark_price`, `mark_iv`, `open_interest`, `underlying_price`, `interest_rate` |
| 单合约精算 | `public/ticker?instrument_name=...` | `bid_iv`, `ask_iv`, `mark_iv`, `greeks`, `underlying_price`, `interest_rate`, `state` |
| 顶部 DVOL K 线 | `public/get_volatility_index_data` | OHLC volatility index candles |
| 合约规格校验 | `public/get_contract_size` | `contract_size` |

官方资料依据：

- Deribit `get_instruments`: https://docs.deribit.com/api-reference/market-data/public-get_instruments
- Deribit `get_book_summary_by_currency`: https://docs.deribit.com/api-reference/market-data/public-get_book_summary_by_currency
- Deribit `ticker`: https://docs.deribit.com/api-reference/market-data/public-ticker
- Deribit rate limits: https://docs.deribit.com/articles/rate-limits
- Deribit inverse options: https://support.deribit.com/hc/en-us/articles/31424939096093-Inverse-Options
- Deribit contract size: https://docs.deribit.com/api-reference/market-data/public-get_contract_size

### 缓存策略

| 数据 | 建议缓存 | 说明 |
| --- | --- | --- |
| instruments | 10 分钟 | 到期日、strike、合约状态变化频率较低 |
| book summary | 15-30 秒 | 列表页、自动选腿和默认价格来源 |
| ticker | 5-10 秒 | 仅对打开详情页的策略腿位拉取 |
| DVOL history | 1-5 分钟 | 顶部 K 线已有数据流基础 |

失败处理：

- Deribit 请求失败时沿用上一份有效缓存。
- 响应里返回 `cacheAgeMs`, `updatedAt`, `source`, `isStale`。
- 页面用数据时间戳和缓存状态提示用户。

## 后端接口设计

新增 options 相关 API：

| Endpoint | 功能 |
| --- | --- |
| `GET /api/options/btc/chain` | 返回 BTC option chain 摘要、可用到期日、当前 underlying price |
| `GET /api/options/btc/strategies/:strategyId/setup` | 按策略蓝图生成默认实时腿位 |
| `POST /api/options/btc/payoff` | 根据用户手动参数计算 payoff、场景线和指标 |
| `GET /api/options/btc/ticker?instrument_name=...` | 返回单合约 ticker 与 Greeks，供调试和详情页刷新使用 |

后端模块建议：

| 模块 | 职责 |
| --- | --- |
| `server/utils/deribitOptions.js` | Deribit options REST client、缓存、字段归一化 |
| `server/utils/optionsChain.js` | 到期日、strike、合约匹配、流动性过滤 |
| `server/utils/optionsStrategyBlueprints.js` | 20 个策略的自动搭建蓝图 |
| `server/utils/optionsPayoff.js` | 到期 payoff、Black-Scholes 当前估算、IV/时间场景 |
| `server/routes/options.js` | 对前端暴露 options API |

## 策略蓝图

统一选腿规则：

- 默认到期日：最近 7-30 天内、合约状态为 `open`、流动性较好的到期日。
- ATM：strike 最接近 BTC underlying price。
- OTM：优先按 Deribit ticker delta，链摘要缺少 Greeks 时按 moneyness 近似。
- 价格口径：默认 `mark_price`，用户可切换 `mid / bid / ask`。
- 数量：默认每组 `1`，支持小数合约数量。
- 底仓：领口、区间化领口、风险逆转、合成多头默认使用 `1 BTC` 虚拟底仓。

### 20 个策略蓝图

| 策略 | 默认搭建 | 默认规则 | 场景重点 |
| --- | --- | --- | --- |
| 买入跨式 | Buy ATM Call + Buy ATM Put | 同到期、同 strike | IV 上升能否覆盖 theta |
| 买入宽跨式 | Buy OTM Call + Buy OTM Put | 两侧约 0.25 delta | 突破幅度与双边成本 |
| 卖出跨式 | Sell ATM Call + Sell ATM Put | 同到期、同 strike | 两侧尾部风险、负 gamma |
| 卖出宽跨式 | Sell OTM Call + Sell OTM Put | 两侧约 0.16 delta | 区间内收租、突破区间 |
| 铁鹰 | Buy Put + Sell Put + Sell Call + Buy Call | 短腿约 0.16 delta，长腿按翼宽 | 风险封顶、IV 回落 |
| 日历价差 | Sell near-term ATM option + Buy far-term same strike option | Call/Put 可切换 | 近月 theta 与远月 vega |
| 对角价差 | Buy far-term direction leg + Sell near-term outer leg | 按方向倾斜选 strike | 短腿受压与方向收益 |
| 蝶式策略 | Buy low + Sell 2 middle + Buy high | 中间 strike 接近现价 | 到期钉住目标价 |
| 领口策略 | 1 BTC + Buy lower Put + Sell upper Call | 下方保护 5%-10%，上方让利 | 保护成本和收益封顶 |
| 区间化领口 | 1 BTC + Put Spread + Sell upper Call | 保护一段下跌区间 | 跌破保护下沿后的敞口 |
| Gamma Scalping | Buy positive gamma core option + hedge note | 默认 ATM straddle 或核心 long option | gamma 收益、theta 成本 |
| 牛市认购价差 | Buy lower Call + Sell higher Call | 上方腿接近目标价或 0.25 delta | 慢涨和收益封顶 |
| 牛市认沽价差 | Sell higher Put + Buy lower Put | 短 Put 约 0.25-0.35 delta | 正 theta 与下跌风险 |
| 熊市认沽价差 | Buy higher Put + Sell lower Put | 按下跌目标选宽度 | 下跌目标区收益 |
| 风险逆转 | Sell Put + Buy Call | 偏多结构，Put 补贴 Call | 上行参与与下方义务 |
| 合成多头 | Buy Call + Sell Put | 同 strike、同到期、默认 ATM | 线性多头近似 |
| 螃蟹策略 | 课程偏多多腿价差映射 | 保留右侧收益斜率 | 右侧延展和中间风险 |
| 比例价差 | Sell 1 lower Call + Buy 2 higher Calls | 偏多突破，比例 1:-2 | 中间亏损区和右侧接管 |
| 牛三腿 | Sell lower Put + Buy middle Call + Sell upper Call | 偏多收租结构 | 横盘收租、慢涨收益、短腿压力 |
| 鳄鱼策略 | Bull Call Spread + extra Long Call | 趋势启动结构 | 右侧斜率增强 |

## 盈亏与场景计算

### 到期 payoff

Deribit BTC inverse options 的权利金以 BTC 计价，合约乘数为 `1 BTC`。到期价值：

- Call: `max(S - K, 0) / S`
- Put: `max(K - S, 0) / S`

单腿到期盈亏：

```text
legPnlBtc = sideMultiplier * quantity * (intrinsicBtc - entryPremiumBtc)
```

其中 `sideMultiplier = 1` 表示买入腿，`sideMultiplier = -1` 表示卖出腿。组合盈亏是全部腿和虚拟底仓的求和。页面同时显示 `BTC PnL` 和按场景价格折算的 `USD PnL`。

### 当前估算

当前估算使用 Black-Scholes 类模型重估每条腿：

- underlying price: Deribit `underlying_price`
- volatility: `mark_iv`
- interest rate: Deribit `interest_rate`
- time to expiry: 合约到期时间减当前时间
- option type: call / put

输出一条“当前估算”曲线。曲线用于复盘和教学演算，成交相关判断仍以交易所实际盘口为准。

### IV 场景

默认场景：

- `IV -10 vol points`
- `当前 IV`
- `IV +10 vol points`

用户可把场景步长调整为 `5 / 10 / 20 vol points`。

### 时间场景

默认时间点：

- 今天
- T+1
- T+3
- T+7
- 到期

当剩余到期时间较短时，页面自动压缩场景点，保留今天、半程、到期等有效点。

### 指标

每个策略详情页展示：

- 净权利金
- 最大收益
- 最大亏损
- 上下盈亏平衡点
- 组合 delta / gamma / theta / vega
- 当前 IV
- 剩余天数
- 数据更新时间
- 价格口径

## 前端信息架构

### 顶部区域

保留 BTC DVOL K 线，新增实时数据状态：

- BTC underlying price
- DVOL latest
- option chain 更新时间
- 可用到期日数量
- Deribit 数据状态

### 策略目录

保留两个一级视角：

- 行情状态：波动率开始上升、高 IV 回落、区间震荡、趋势启动、底仓保护等。
- 策略类型：买入波动率、卖出波动率、时间结构、方向价差、底仓保护、课程组合。

### 策略卡片

每张卡显示：

- 策略名称和英文名
- 适用环境
- 核心 Greeks
- 老师原文数量
- 实时搭建支持状态
- 默认风险形态

### 策略详情页

`OptionsStrategyDrawer` 拆成共用子组件：

| 组件 | 内容 |
| --- | --- |
| `OptionsStrategySourcePanel` | 课程原文、来源日期、操作步骤、风险点 |
| `OptionsLiveSetupPanel` | 自动腿位、手动参数、价格口径、刷新状态 |
| `OptionsLegTable` | 每条腿的合约名、到期日、strike、买卖方向、数量、mark、IV、Greeks |
| `OptionsPayoffChart` | 到期盈亏、当前估算、IV/时间场景 |
| `OptionsScenarioMetrics` | 最大收益、最大亏损、盈亏平衡、组合 Greeks |

交互：

- 打开策略详情后自动生成默认腿位。
- 用户改到期日、strike、数量、价格口径后实时重算。
- 图例可切换到期、当前估算、IV 上升、IV 回落、T+N。
- 鼠标悬停展示该 BTC 价格下的组合盈亏。
- 图上固定标出当前 BTC、短腿 strike、长腿 strike、盈亏平衡点。

## 视觉草图

已通过本地可视化伴随服务确认草图方向：

- 三栏详情布局：课程原文、实时搭建、盈亏图。
- 铁鹰示例含四条腿、净权利金、最大收益、最大亏损、场景曲线。
- 全量 20 策略采用 `REST 缓存 + 选中策略精算`。

本地草图服务 URL：`http://localhost:53763`

## 测试方案

### 后端测试

- Mock `get_instruments`，验证 instruments 缓存、到期日解析、合约状态过滤。
- Mock `get_book_summary_by_currency`，验证 chain 摘要归一化和 stale cache 标记。
- Mock `ticker`，验证 Greeks、IV 和 interest rate 聚合。
- 验证 Deribit 请求失败时返回上一份有效缓存。

### 蓝图测试

每个策略至少生成一套合法默认腿位：

- 到期日关系符合蓝图。
- strike 顺序符合策略结构。
- 买卖方向符合策略定义。
- Call/Put 类型符合策略定义。
- 数量比例符合策略定义。
- 底仓类策略包含虚拟底仓。

### 盈亏测试

覆盖代表结构：

- 买入跨式
- 卖出宽跨式
- 铁鹰
- 蝶式
- 领口
- 牛三腿
- 比例价差
- 合成多头

验证内容：

- 到期 payoff 点数量。
- 最大收益和最大亏损。
- 盈亏平衡点。
- BTC PnL 与 USD PnL。
- IV 场景和时间场景输出。

### 前端测试

- 策略列表和筛选仍可用。
- 打开任一策略显示实时搭建设置。
- 手动修改参数后重算图表和指标。
- 数据 stale 时显示缓存状态。
- 原文片段继续展示。

### 浏览器验证

- 打开 `/options`。
- 检查顶部 DVOL K 线和实时行情状态。
- 检查 20 个策略卡片。
- 打开铁鹰详情页，确认腿位、盈亏图和场景线。
- 手动修改到期日、strike、数量、价格口径。
- 检查移动端布局。

## 交付标准

- 20 个策略都有自动搭建设置。
- 20 个策略都有盈亏图。
- 每个详情页支持手动调参并重算。
- 实时数据来自 Deribit public API。
- 页面显示行情更新时间和缓存状态。
- 课程原文索引保留并可在详情页查看。
- 后端行情、蓝图、盈亏引擎和关键前端交互有测试覆盖。

## 后续阶段

- WebSocket `ticker.{instrument_name}.{interval}` 推送增强。
- 用户保存自定义策略参数。
- 账户持仓和真实保证金视图。
- 多币种期权支持。
- USDC linear options 支持。
