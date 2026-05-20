# BTC 场外指数、爆破指数和进退场周期预测方案

## 1. 建模目标

本方案只针对 BTC。价格用谢林点代替，输入特征使用场外指数、爆破指数、进退场类型、进退场天数及其衍生特征。

核心目标：

- 预测未来 1 天、3 天、5 天、7 天谢林点方向
- 输出上涨概率、方向标签、周期位置解释
- 对比课内算法和课外算法的预测表现
- 把高概率信号、样本数、历史命中率放到 dashboard

基础数据字段：

| 字段 | 含义 | 用途 |
|---|---|---|
| `date` | 日期 | 时间排序和回测切分 |
| `symbol` | 币种 | 固定为 BTC |
| `otc_index` | 场外指数 | 核心预测特征 |
| `explosion_index` | 爆破指数 | 核心预测特征 |
| `schelling_point` | 谢林点 | 价格替代变量 |
| `entry_exit_type` | 进场期或退场期 | 辅助状态特征 |
| `entry_exit_day` | 进退场第几天 | 辅助状态特征 |

## 2. Target 设计

先做方向预测，再做收益率预测。

### 2.1 二分类方向

```text
future_return_3d = schelling_point[t+3] / schelling_point[t] - 1

target_3d_up = 1 if future_return_3d > 0
target_3d_up = 0 if future_return_3d <= 0
```

同样生成：

```text
target_1d_up
target_3d_up
target_5d_up
target_7d_up
```

### 2.2 三分类方向

```text
future_return_3d > 1%      => up
-1% <= future_return_3d <= 1% => flat
future_return_3d < -1%     => down
```

三分类更接近实际交易判断，因为小幅波动可以视为横盘。

### 2.3 回归收益率

```text
target = future_return_3d
```

回归模型输出未来收益率，例如 `+2.1%`。这个目标噪声更大，适合作为第二阶段。

## 3. Feature Engineering

数据范围限定为场外指数、爆破指数、进退场周期、谢林点历史。

### 3.1 当日特征

```text
otc_index
explosion_index
entry_exit_type
entry_exit_day
is_entry_period
is_exit_period
```

### 3.2 变化特征

```text
otc_change_1d = otc_index[t] - otc_index[t-1]
explosion_change_1d = explosion_index[t] - explosion_index[t-1]

otc_pct_change_1d = otc_index[t] / otc_index[t-1] - 1
explosion_pct_change_1d = explosion_index[t] / explosion_index[t-1] - 1
```

### 3.3 滚动均值

```text
otc_ma_3
otc_ma_7
explosion_ma_3
explosion_ma_7
```

### 3.4 趋势特征

```text
otc_slope_3 = otc_index[t] - otc_index[t-3]
explosion_slope_3 = explosion_index[t] - explosion_index[t-3]

otc_up_3d = 1 if otc_index[t] > otc_index[t-3]
explosion_up_3d = 1 if explosion_index[t] > explosion_index[t-3]
```

### 3.5 阈值特征

```text
explosion_above_200 = 1 if explosion_index > 200
explosion_cross_up_200 = 1 if explosion_index[t-1] <= 200 and explosion_index[t] > 200
explosion_cross_down_200 = 1 if explosion_index[t-1] >= 200 and explosion_index[t] < 200

otc_above_1000 = 1 if otc_index > 1000
otc_above_1500 = 1 if otc_index > 1500
```

### 3.6 进退场周期特征

进退场周期是本方案的关键状态特征。同样的爆破指数，在进场期第 3 天和进场期第 34 天含义不同。

```text
is_entry_period = 1 if entry_exit_type == "entry"
is_exit_period = 1 if entry_exit_type == "exit"

early_entry_period = 1 if entry_exit_type == "entry" and entry_exit_day <= 7
middle_entry_period = 1 if entry_exit_type == "entry" and 8 <= entry_exit_day <= 30
late_entry_period = 1 if entry_exit_type == "entry" and entry_exit_day > 30

early_exit_period = 1 if entry_exit_type == "exit" and entry_exit_day <= 7
middle_exit_period = 1 if entry_exit_type == "exit" and 8 <= entry_exit_day <= 30
late_exit_period = 1 if entry_exit_type == "exit" and entry_exit_day > 30
```

分箱版本：

```text
entry_day_bucket:
- entry_1_7
- entry_8_30
- entry_31_plus

exit_day_bucket:
- exit_1_7
- exit_8_30
- exit_31_plus
```

## 4. 方案 A：课内 Baseline 模型

用途：建立可解释 baseline，判断两个指标是否有基本预测力。

| 模型 | 任务 | 价值 |
|---|---|---|
| Logistic Regression | 预测上涨概率 | 可解释，适合作基准 |
| Decision Tree | 找规则 | 能解释阈值、进退场天数和组合条件 |
| Naive Bayes | 快速概率模型 | 适合做条件概率 baseline |
| Random Forest | 增强树模型 | 比单棵树稳定 |

推荐训练顺序：

```text
1. Logistic Regression
2. Decision Tree
3. Naive Bayes
4. Random Forest
```

输出示例：

```text
BTC future_3d_up probability:
- Logistic Regression: 56.2%
- Decision Tree: 61.0%
- Naive Bayes: 58.4%
- Random Forest: 63.5%
```

## 5. 方案 B：贝叶斯规则模型

用途：给 dashboard 一个可解释的概率信号。

### 5.1 指标分箱

```text
爆破指数:
- below_0
- between_0_200
- above_200

场外指数:
- below_1000
- between_1000_1500
- above_1500

场外趋势:
- up_3d
- down_3d

周期位置:
- entry_1_7
- entry_8_30
- entry_31_plus
- exit_1_7
- exit_8_30
- exit_31_plus
```

### 5.2 条件概率

```text
P(future_3d_up | explosion_above_200, otc_up_3d)
P(future_3d_up | entry_1_7, explosion_above_200, otc_up_3d)
P(future_5d_up | exit_1_7, explosion_cross_down_200, otc_down_3d)
```

### 5.3 Bayesian Smoothing

```text
posterior = (up_count + 1) / (total_count + 2)
```

例子：

```text
条件：进场期第1-7天，爆破指数 > 200，场外指数近3天上涨
历史出现：80 次
未来3天上涨：52 次

posterior = (52 + 1) / (80 + 2) = 64.6%
```

dashboard 展示：

```text
BTC 未来3天上涨概率：64.6%
信号来源：进场期前7天 + 爆破 > 200 + 场外3日上升
历史样本数：80
历史命中：52
```

退场期示例：

```text
BTC 未来5天上涨概率：38.2%
信号来源：退场期前7天 + 爆破跌破200 + 场外3日下降
历史样本数：34
历史命中：13
```

## 6. 方案 C：课外高表现模型

用途：追求更高预测表现。

| 模型 | 推荐程度 | 适用理由 |
|---|---:|---|
| LightGBMClassifier | 最高 | 表格数据强，训练快 |
| XGBoostClassifier | 很高 | 稳定，调参资料多 |
| CatBoostClassifier | 中高 | 进退场类型和周期分箱这类类别特征处理方便 |
| ExtraTreesClassifier | 中高 | 简单快速，适合强 baseline |
| HistGradientBoostingClassifier | 中 | sklearn 自带，安装成本低 |

优先级：

```text
1. LightGBM
2. XGBoost
3. ExtraTrees
4. Random Forest
5. Logistic Regression
```

训练目标：

```text
target_1d_up
target_3d_up
target_5d_up
target_7d_up
```

输出：

```text
model.predict_proba(X_today)
=> BTC 未来3天上涨概率
```

核心输入：

```text
otc_index
explosion_index
entry_exit_type
entry_exit_day
entry_day_bucket
exit_day_bucket
otc_change_1d / 3d / 7d
explosion_change_1d / 3d / 7d
otc_ma_3 / 7
explosion_ma_3 / 7
threshold_crossing_features
```

## 7. 方案 D：市场状态模型

用途：先判断市场状态，再预测未来方向。

### 7.1 K-means 状态分组

输入：

```text
otc_index
explosion_index
entry_exit_type
entry_exit_day
otc_change_3d
explosion_change_3d
```

可能得到的状态：

```text
state_0: 低爆破 + 低场外
state_1: 进场前期 + 高爆破 + 场外上升
state_2: 进场后期 + 高场外 + 爆破转弱
state_3: 退场前期 + 爆破跌破200
```

### 7.2 HMM 状态模型

HMM 适合把市场理解成隐藏状态：

```text
hidden_state = risk_on / neutral / risk_off
```

然后把 `hidden_state` 加入分类模型：

```text
features = raw_features + entry_exit_features + market_state
model = LightGBMClassifier
```

## 8. 方案 E：收益率回归模型

用途：预测未来涨跌幅。

模型：

```text
LinearRegression
RandomForestRegressor
XGBoostRegressor
LightGBMRegressor
```

目标：

```text
future_return_3d
future_return_5d
future_return_7d
```

输出：

```text
BTC future_3d_return prediction = +2.1%
```

回归结果适合作辅助排序，方向预测适合作主信号。

## 9. 验证方法

必须按时间顺序验证。

推荐：

```text
TimeSeriesSplit
walk-forward backtest
```

流程：

```text
Fold 1:
train = 早期历史
test = 后面一段历史

Fold 2:
train = 更长历史
test = 再后面一段历史
```

避免未来数据进入训练集：

```text
scaler.fit(X_train)
model.fit(X_train, y_train)
model.predict(X_test)
```

## 10. 评估指标

分类指标：

```text
accuracy
precision
recall
F1
ROC-AUC
```

交易指标：

```text
directional_accuracy
average_return_when_signal
win_rate_when_probability_above_60
max_drawdown
number_of_signals
```

重点看：

```text
未来3天和未来5天
precision
样本数
交易成本后收益
```

## 11. 推荐 V1

第一版直接做四个模型：

```text
1. Logistic Regression
2. Bayesian Rule Model
3. Random Forest
4. LightGBM
```

预测周期：

```text
1d
3d
5d
7d
```

dashboard 输出字段：

```text
btc_prediction_1d_probability
btc_prediction_3d_probability
btc_prediction_5d_probability
btc_prediction_7d_probability

best_model
signal_strength
historical_sample_size
historical_precision
latest_features
latest_period_state
entry_exit_type
entry_exit_day
```

## 12. 推荐文件结构

```text
server/scripts/train-btc-prediction-models.js
server/scripts/backtest-btc-prediction-models.js
server/utils/btcPredictionFeatures.js
server/utils/btcBayesianSignals.js
server/utils/btcPeriodStateFeatures.js
server/models/btcprediction.js
server/routes/predictions.js
src/components/BtcPredictionPanel.jsx
```

## 13. 实现顺序

```text
Step 1: 从数据库导出 BTC 历史数据
Step 2: 构造 features 和 targets
Step 3: 加入进退场周期特征
Step 4: 跑 baseline 模型
Step 5: 跑 Bayesian Rule Model
Step 6: 跑 LightGBM / XGBoost
Step 7: 做 walk-forward backtest
Step 8: 保存最新预测结果
Step 9: dashboard 展示预测概率、周期状态和历史命中率
```

## 14. 最终推荐

最优先做：

```text
Bayesian Rule Model + LightGBM
```

Bayesian Rule Model 负责解释：

```text
为什么当前信号偏多或偏空
历史样本有多少
历史命中率是多少
```

LightGBM 负责预测表现：

```text
综合场外指数、爆破指数、进退场周期、变化率、滚动均值、阈值状态
输出未来 1 / 3 / 5 / 7 天上涨概率
```

第一版验收标准：

```text
能生成 BTC 历史 features 表
能生成进退场周期特征
能训练 4 个模型
能输出 1d / 3d / 5d / 7d 上涨概率
能显示每个模型的回测指标
能在 dashboard 展示最新 BTC 预测信号和周期状态
```
