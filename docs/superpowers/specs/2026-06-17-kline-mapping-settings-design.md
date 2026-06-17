# K 线映射设置页面设计

## 状态

用户已选择方案 A：新增数据库化 K 线映射设置页。

## 目标

在 admin 下新增一个“K线映射设置”页面，用于管理每个 dashboard 币种实际拉取 K 线时使用的数据来源和交易代码。设置保存后，K 线图、刷新、WebSocket、回补都读取同一套映射配置。

## 用户场景

- `CN_AI_ETF` 的指标仍显示为“国内人工智能 ETF”，K 线来源映射到 Yahoo Finance 的 `159819.SZ`。
- `CN_ROBOT` 的指标仍显示为“国内机器人 ETF”，K 线来源映射到 Yahoo Finance 的 `562500.SS`。
- `VEGA` 的指标仍显示为 Vega，K 线来源映射到 Deribit 的 BTC DVOL。
- 普通加密货币默认走 Binance USDM perpetual，必要时可手动改成 Binance spot 或 Yahoo Finance。

## 数据模型

新增 `CoinKlineMapping` 表：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | integer | 主键 |
| `coin_id` | integer | 关联 `Coins.id` |
| `coin_symbol` | string | 冗余币种 symbol，便于排查 |
| `market` | string | K 线来源 |
| `trading_symbol` | string | 来源里的实际交易代码 |
| `enabled` | boolean | 是否启用 |
| `notes` | text | 管理员备注 |
| `createdAt` / `updatedAt` | date | Sequelize 默认时间 |

唯一约束：`coin_id` 唯一。每个 dashboard 币种当前只维护一条主映射。

## 来源枚举

| market | 页面显示 | trading symbol 示例 |
| --- | --- | --- |
| `binance_usdm_perpetual` | Binance U 本位合约 | `BTCUSDT` |
| `binance_spot` | Binance 现货 | `BTCUSDT` |
| `yahoo_finance` | Yahoo Finance | `159819.SZ`, `562500.SS`, `AXTI` |
| `deribit_btc_dvol` | Deribit BTC DVOL | `BTC-DVOL` |

## 默认映射迁移

迁移创建表后写入当前硬编码映射：

| coin_symbol | market | trading_symbol |
| --- | --- | --- |
| `CN_AI_ETF` | `yahoo_finance` | `159819.SZ` |
| `CN_ROBOT` | `yahoo_finance` | `562500.SS` |
| `CN_INDEX` | `yahoo_finance` | `000300.SS` |
| `VEGA` | `deribit_btc_dvol` | `BTC-DVOL` |
| `NASDAQ` | `yahoo_finance` | `^IXIC` |
| 美股个股 | `yahoo_finance` | 原 symbol |

迁移只为已存在的 `Coins` 记录创建映射。后续新增币种可在设置页手动补映射。

## 后端设计

新增 admin API：

| Endpoint | 功能 |
| --- | --- |
| `GET /api/admin/kline-mappings` | 返回所有币种及当前映射 |
| `PUT /api/admin/kline-mappings/:coinId` | 更新单个币种映射 |
| `POST /api/admin/kline-mappings/seed-defaults` | 按默认规则补齐缺失映射 |

`server/utils/coinKlines.js` 增加映射解析能力：

- `resolveKlineMapping(coin, options)`：读取数据库映射，失败时回落到内置默认映射。
- `getPreferredKlineMarket(symbol, mapping)`：优先使用数据库映射的 `market`。
- `resolveTradingSymbol(symbol, mapping)`：优先使用数据库映射的 `trading_symbol`。

接入点：

- `/coins/:symbol/klines`
- `/coins/klines/backfill`
- WebSocket kline server
- `findCoinKlineBackfillGaps`
- `syncCoinKlines`

## 前端设计

新增路由：`/settings/kline-mappings`，仅 admin 可访问。

admin 下拉菜单新增入口：`K线映射设置`。

页面布局：

- 顶部说明条：解释“dashboard 币种”和“实际 K 线交易代码”的关系。
- 表格列：币种、名称、来源、映射代码、启用、最近更新时间、备注、操作。
- 行内编辑：来源用 Select，映射代码用 Input，启用 Switch，备注 Input。
- 操作按钮：保存、恢复默认、补齐默认映射。

页面强调密集、清晰、可扫读，沿用现有 Ant Design 管理页风格。

## 校验规则

- `market` 必须来自来源枚举。
- `trading_symbol` 必填，长度控制在 1-40。
- Binance 来源自动转大写。
- Yahoo Finance 保留大小写和符号，例如 `^IXIC`、`159819.SZ`。
- Deribit DVOL 固定建议值为 `BTC-DVOL`。

## 测试计划

后端：

- 映射模型和迁移可创建表。
- 默认映射 seed 可为现有币种补齐。
- `syncCoinKlines` 使用数据库映射拉取 Yahoo / Deribit / Binance。
- `/coins/:symbol/klines` 返回映射来源和交易代码。
- 回补缺口计算使用映射来源查询已有 K 线。

前端：

- 管理页面可加载映射列表。
- 修改来源和代码后调用 PUT API。
- 保存成功后表格显示最新值。
- admin 菜单可进入设置页。

## 风险与处理

- 已有 K 线历史仍保留原 market 与 trading symbol；切换映射后新数据会写入新的 market 维度。
- 回补时按当前启用映射判断覆盖情况。
- 若映射错误导致拉取失败，API 返回错误信息，页面保留当前配置供管理员修正。
