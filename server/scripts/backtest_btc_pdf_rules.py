#!/usr/bin/env python3
import json
import math
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "database.sqlite"
OUTPUT_PATH = ROOT / "server" / "output" / "btc-pdf-rule-backtest-python.json"
HORIZONS = [1, 3, 5, 7]
MIN_SIGNALS_FOR_RANK = 5


def normalize_period_type(value):
    raw = str(value or "").strip().lower()
    if raw in {"entry", "in", "long", "进场", "进场期"}:
        return "entry"
    if raw in {"exit", "out", "short", "退场", "退场期"}:
        return "exit"
    return "unknown"


def load_btc_rows():
    query = """
        SELECT
            DailyMetrics.date,
            DailyMetrics.otc_index,
            DailyMetrics.explosion_index,
            DailyMetrics.schelling_point,
            DailyMetrics.entry_exit_type,
            DailyMetrics.entry_exit_day
        FROM DailyMetrics
        JOIN Coins ON Coins.id = DailyMetrics.coin_id
        WHERE Coins.symbol = 'BTC'
        ORDER BY DailyMetrics.date ASC
    """
    with sqlite3.connect(DB_PATH) as conn:
        raw = pd.read_sql_query(query, conn)

    raw["date"] = raw["date"].astype(str)
    for column in ["otc_index", "explosion_index", "schelling_point", "entry_exit_day"]:
        raw[column] = pd.to_numeric(raw[column], errors="coerce")
    raw["entry_exit_type"] = raw["entry_exit_type"].map(normalize_period_type)
    raw["entry_exit_day"] = raw["entry_exit_day"].fillna(0).clip(lower=0)

    usable = raw.dropna(subset=["otc_index", "explosion_index", "schelling_point"]).copy()
    usable = usable.sort_values("date").reset_index(drop=True)
    usable["date_dt"] = pd.to_datetime(usable["date"], errors="coerce")
    clean, excluded = remove_schelling_outliers(usable)
    return raw.reset_index(drop=True), usable, clean.reset_index(drop=True), excluded.reset_index(drop=True)


def remove_schelling_outliers(rows):
    if rows.empty:
        return rows, rows
    median = rows["schelling_point"].rolling(7, center=True, min_periods=3).median()
    median = median.fillna(rows["schelling_point"].median())
    mask = (rows["schelling_point"] >= median * 0.5) & (rows["schelling_point"] <= median * 1.8)
    return rows[mask].copy(), rows[~mask].copy()


def is_entry_start(rows, index):
    row = rows.loc[index]
    if row["entry_exit_type"] != "entry":
        return False
    if int(row["entry_exit_day"] or 0) == 1:
        return True
    return index == 0 or rows.loc[index - 1, "entry_exit_type"] != "entry"


def is_exit_start(rows, index):
    row = rows.loc[index]
    if row["entry_exit_type"] != "exit":
        return False
    if int(row["entry_exit_day"] or 0) == 1:
        return True
    return index == 0 or rows.loc[index - 1, "entry_exit_type"] != "exit"


def pct_change(current, previous):
    if previous is None or not np.isfinite(previous) or previous == 0:
        return None
    return current / previous - 1


def add_key_node_features(rows):
    output = rows.copy()
    output["entry_key_otc_change"] = np.nan
    output["exit_key_otc_change"] = np.nan
    output["is_entry_start"] = False
    output["is_exit_start"] = False
    output["explosion_cross_down_200"] = False
    output["explosion_neg_to_pos"] = False
    output["explosion_near_200"] = False
    output["explosion_near_zero"] = False
    output["otc_cross_up_1000"] = False
    output["otc_cross_down_1000"] = False

    last_entry_key_otc = None
    last_exit_key_otc = None

    for index in range(len(output)):
        row = output.loc[index]
        prev = output.loc[index - 1] if index > 0 else None
        phase = row["entry_exit_type"]

        entry_start = is_entry_start(output, index)
        exit_start = is_exit_start(output, index)
        cross_down_200 = prev is not None and prev["explosion_index"] >= 200 and row["explosion_index"] < 200
        neg_to_pos = prev is not None and prev["explosion_index"] < 0 and row["explosion_index"] >= 0
        near_200 = 195 <= row["explosion_index"] <= 205
        near_zero = -5 <= row["explosion_index"] <= 5
        cross_up_1000 = prev is not None and prev["otc_index"] < 1000 <= row["otc_index"]
        cross_down_1000 = prev is not None and prev["otc_index"] >= 1000 > row["otc_index"]

        output.at[index, "is_entry_start"] = entry_start
        output.at[index, "is_exit_start"] = exit_start
        output.at[index, "explosion_cross_down_200"] = cross_down_200
        output.at[index, "explosion_neg_to_pos"] = neg_to_pos
        output.at[index, "explosion_near_200"] = near_200
        output.at[index, "explosion_near_zero"] = near_zero
        output.at[index, "otc_cross_up_1000"] = cross_up_1000
        output.at[index, "otc_cross_down_1000"] = cross_down_1000

        if phase == "entry":
            change = pct_change(row["otc_index"], last_entry_key_otc)
            output.at[index, "entry_key_otc_change"] = change if change is not None else np.nan
        if phase == "exit":
            change = pct_change(row["otc_index"], last_exit_key_otc)
            output.at[index, "exit_key_otc_change"] = change if change is not None else np.nan

        if phase == "entry" and (entry_start or cross_down_200):
            last_entry_key_otc = row["otc_index"]
        if phase == "exit" and (exit_start or neg_to_pos):
            last_exit_key_otc = row["otc_index"]

    return output


def build_rule_definitions():
    return [
        {
            "id": "entry_start_long_all",
            "label": "进场期开始做多",
            "direction": "up",
            "source": "PDF p.1-p.3: 场外进场期作为趋势状态",
            "condition": lambda r: r["is_entry_start"],
        },
        {
            "id": "entry_start_long_explosion_le_200",
            "label": "进场期开始且爆破未高于200做多",
            "direction": "up",
            "source": "PDF p.7: 进场日叠加爆破>200质量偏低",
            "condition": lambda r: r["is_entry_start"] and r["explosion_index"] <= 200,
        },
        {
            "id": "entry_start_explosion_gt_200_fade",
            "label": "进场期开始且爆破高于200谨慎看回落",
            "direction": "down",
            "source": "PDF p.7: 进场日叠加爆破>200质量偏低",
            "condition": lambda r: r["is_entry_start"] and r["explosion_index"] > 200,
        },
        {
            "id": "entry_cross_down_200_take_profit",
            "label": "进场期爆破跌回200按止盈节点看回落",
            "direction": "down",
            "source": "PDF p.9-p.10: 爆破跌回200是阶段高点",
            "condition": lambda r: r["entry_exit_type"] == "entry" and r["explosion_cross_down_200"],
        },
        {
            "id": "entry_cross_down_200_otc_up_continue",
            "label": "进场期爆破跌回200且场外节点升高看延续",
            "direction": "up",
            "source": "PDF p.9-p.10: 场外节点升高代表波段扩张",
            "condition": lambda r: (
                r["entry_exit_type"] == "entry"
                and r["explosion_cross_down_200"]
                and pd.notna(r["entry_key_otc_change"])
                and r["entry_key_otc_change"] > 0
            ),
        },
        {
            "id": "entry_cross_down_200_otc_flat_down_fade",
            "label": "进场期爆破跌回200且场外未升高看回落",
            "direction": "down",
            "source": "PDF p.9-p.10: 场外走平或下降代表动能衰减",
            "condition": lambda r: (
                r["entry_exit_type"] == "entry"
                and r["explosion_cross_down_200"]
                and pd.notna(r["entry_key_otc_change"])
                and r["entry_key_otc_change"] <= 0
            ),
        },
        {
            "id": "entry_otc_cross_up_1000_long",
            "label": "进场期场外上穿1000做多",
            "direction": "up",
            "source": "PDF p.8-p.10: 场外1000是阶段变化阈值",
            "condition": lambda r: r["entry_exit_type"] == "entry" and r["otc_cross_up_1000"],
        },
        {
            "id": "entry_otc_above_1000_explosion_between_0_200_long",
            "label": "进场期场外高于1000且爆破0-200做多",
            "direction": "up",
            "source": "PDF p.8-p.10: 场外阈值叠加爆破中区间",
            "condition": lambda r: (
                r["entry_exit_type"] == "entry"
                and r["otc_index"] >= 1000
                and 0 <= r["explosion_index"] < 200
            ),
        },
        {
            "id": "exit_start_short_all",
            "label": "退场期开始做空",
            "direction": "down",
            "source": "PDF p.81: 风险偏低可等退场第1天做空",
            "condition": lambda r: r["is_exit_start"],
        },
        {
            "id": "exit_neg_to_pos_cover_then_bounce",
            "label": "退场期爆破负变正看反弹",
            "direction": "up",
            "source": "PDF p.81: 空头在爆破负变正处止盈",
            "condition": lambda r: r["entry_exit_type"] == "exit" and r["explosion_neg_to_pos"],
        },
        {
            "id": "exit_cross_down_200_short",
            "label": "退场期爆破跌回200做空",
            "direction": "down",
            "source": "PDF p.81: 高风险空头在爆破跌回200启动",
            "condition": lambda r: r["entry_exit_type"] == "exit" and r["explosion_cross_down_200"],
        },
        {
            "id": "exit_otc_cross_down_1000_short",
            "label": "退场期场外跌破1000做空",
            "direction": "down",
            "source": "PDF p.10: 场外低于1000叠加退场用于牛熊切换",
            "condition": lambda r: r["entry_exit_type"] == "exit" and r["otc_cross_down_1000"],
        },
        {
            "id": "near_200_entry_watch_reversal",
            "label": "进场期爆破接近200看短线回落",
            "direction": "down",
            "source": "PDF p.4: 195-205可视作关键节点区",
            "condition": lambda r: r["entry_exit_type"] == "entry" and r["explosion_near_200"],
        },
        {
            "id": "near_zero_exit_watch_bounce",
            "label": "退场期爆破接近0看短线反弹",
            "direction": "up",
            "source": "PDF p.4: -5到5可视作退场关键节点区",
            "condition": lambda r: r["entry_exit_type"] == "exit" and r["explosion_near_zero"],
        },
    ]


def rule_signals(rows, rule):
    signals = []
    for index in range(len(rows)):
        row = rows.loc[index]
        if not rule["condition"](row):
            continue
        signals.append({
            "row_index": int(index),
            "date": row["date"],
            "ruleId": rule["id"],
            "label": rule["label"],
            "source": rule["source"],
            "direction": rule["direction"],
            "phase": row["entry_exit_type"],
            "period_day": int(row["entry_exit_day"] or 0),
            "otc_index": float(row["otc_index"]),
            "explosion_index": float(row["explosion_index"]),
            "schelling_point": float(row["schelling_point"]),
            "entry_key_otc_change": json_float(row["entry_key_otc_change"]),
            "exit_key_otc_change": json_float(row["exit_key_otc_change"]),
        })
    return signals


def json_float(value):
    if value is None:
        return None
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def add_rule_targets(signals, rows):
    output = []
    for signal in signals:
        index = signal["row_index"]
        for horizon in HORIZONS:
            future = future_row_for_calendar_horizon(rows, index, horizon)
            if future is None:
                continue
            future_return = future["schelling_point"] / signal["schelling_point"] - 1
            directional_return = future_return if signal["direction"] == "up" else -future_return
            target_date = rows.loc[index, "date_dt"] + pd.Timedelta(days=horizon)
            item = dict(signal)
            item.update({
                "horizon": horizon,
                "target_date": str(target_date.date()),
                "future_date": future["date"],
                "future_schelling_point": float(future["schelling_point"]),
                "calendar_gap_days": int((future["date_dt"] - target_date).days),
                "future_return": float(future_return),
                "directional_return": float(directional_return),
                "success": int(directional_return > 0),
            })
            output.append(item)
    return pd.DataFrame(output)


def future_row_for_calendar_horizon(rows, index, horizon):
    target_date = rows.loc[index, "date_dt"] + pd.Timedelta(days=horizon)
    future_rows = rows[(rows.index > index) & (rows["date_dt"] >= target_date)]
    if future_rows.empty:
        return None
    return future_rows.iloc[0]


def summarize_rule_results(dataset):
    summaries = []
    if dataset.empty:
        return summaries

    for (rule_id, horizon), subset in dataset.groupby(["ruleId", "horizon"], sort=False):
        first = subset.iloc[0]
        signal_count = len(subset)
        success_rate = float(subset["success"].mean())
        avg_directional_return = float(subset["directional_return"].mean())
        median_directional_return = float(subset["directional_return"].median())
        avg_future_return = float(subset["future_return"].mean())
        summaries.append({
            "ruleId": rule_id,
            "label": first["label"],
            "source": first["source"],
            "horizon": int(horizon),
            "direction": first["direction"],
            "signalCount": int(signal_count),
            "successRate": success_rate,
            "averageDirectionalReturn": avg_directional_return,
            "medianDirectionalReturn": median_directional_return,
            "averageFutureReturn": avg_future_return,
            "firstSignalDate": str(subset["date"].min()),
            "lastSignalDate": str(subset["date"].max()),
            "score": result_score(signal_count, success_rate, avg_directional_return, horizon),
        })
    return sorted(summaries, key=lambda row: row["score"], reverse=True)


def result_score(signal_count, success_rate, average_directional_return, horizon):
    enough = 1.0 if signal_count >= MIN_SIGNALS_FOR_RANK else -1.0
    horizon_bonus = 0.15 if horizon in {3, 5} else 0.0
    return (
        enough
        + success_rate * 3.0
        + max(average_directional_return, -0.05) * 120.0
        + min(signal_count, 40) / 100.0
        + horizon_bonus
    )


def build_baseline(rows):
    baseline = []
    for horizon in HORIZONS:
        outcomes = []
        gaps = []
        for index in range(len(rows)):
            future = future_row_for_calendar_horizon(rows, index, horizon)
            if future is None:
                continue
            target_date = rows.loc[index, "date_dt"] + pd.Timedelta(days=horizon)
            future_return = future["schelling_point"] / rows.loc[index, "schelling_point"] - 1
            outcomes.append(float(future_return))
            gaps.append(int((future["date_dt"] - target_date).days))
        if not outcomes:
            continue
        values = np.asarray(outcomes)
        baseline.append({
            "horizon": horizon,
            "rowCount": int(len(values)),
            "averageCalendarGapDays": float(np.mean(gaps)) if gaps else 0.0,
            "upRate": float((values > 0).mean()),
            "downRate": float((values < 0).mean()),
            "averageReturn": float(values.mean()),
            "medianReturn": float(np.median(values)),
        })
    return baseline


def latest_signals(rows, rules):
    if rows.empty:
        return []
    output = []
    latest_index = len(rows) - 1
    latest = rows.loc[latest_index]
    for rule in rules:
        if rule["condition"](latest):
            output.append({
                "date": latest["date"],
                "ruleId": rule["id"],
                "label": rule["label"],
                "direction": rule["direction"],
                "phase": latest["entry_exit_type"],
                "period_day": int(latest["entry_exit_day"] or 0),
                "otc_index": float(latest["otc_index"]),
                "explosion_index": float(latest["explosion_index"]),
                "schelling_point": float(latest["schelling_point"]),
            })
    return output


def json_safe(value):
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [json_safe(item) for item in value]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        value = float(value)
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    return value


def main():
    raw, usable, clean, excluded = load_btc_rows()
    rows = add_key_node_features(clean)
    rules = build_rule_definitions()
    signals = []
    for rule in rules:
        signals.extend(rule_signals(rows, rule))

    dataset = add_rule_targets(signals, rows)
    ranked = summarize_rule_results(dataset)
    robust = [row for row in ranked if row["signalCount"] >= MIN_SIGNALS_FOR_RANK]
    output = {
        "modelName": "BTC PDF Fixed Rule Backtest",
        "priceProxy": "schelling_point",
        "data": {
            "totalRows": int(len(raw)),
            "rowsWithSchellingPoint": int(len(usable)),
            "cleanRowsUsed": int(len(clean)),
            "excludedOutlierRows": [
                {
                    "date": row["date"],
                    "schelling_point": float(row["schelling_point"]),
                    "otc_index": float(row["otc_index"]),
                    "explosion_index": float(row["explosion_index"]),
                }
                for _, row in excluded.iterrows()
            ],
            "firstDate": clean["date"].iloc[0] if len(clean) else None,
            "latestCleanDate": clean["date"].iloc[-1] if len(clean) else None,
            "latestRawDate": raw["date"].iloc[-1] if len(raw) else None,
            "ruleCount": int(len(rules)),
            "signalRows": int(len(signals)),
            "targetRows": int(len(dataset)),
        },
        "baseline": build_baseline(rows),
        "bestResult": robust[0] if robust else (ranked[0] if ranked else None),
        "bestAnyResult": ranked[0] if ranked else None,
        "bestRobustResult": robust[0] if robust else None,
        "rankedResults": ranked,
        "latestSignals": latest_signals(rows, rules),
        "signals": signals,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(json_safe(output), indent=2, ensure_ascii=False), encoding="utf-8")

    print("========== BTC PDF Fixed Rule Backtest ==========")
    print(
        f"Rows: total={output['data']['totalRows']}, "
        f"with_schelling={output['data']['rowsWithSchellingPoint']}, "
        f"clean_used={output['data']['cleanRowsUsed']}, "
        f"signals={output['data']['signalRows']}"
    )
    print(f"Output: {OUTPUT_PATH}")
    print("\nBaseline:")
    for item in output["baseline"]:
        print(
            f"{item['horizon']}d rows={item['rowCount']} "
            f"upRate={item['upRate']:.2%} avgReturn={item['averageReturn']:.2%}"
        )
    print("\nTop robust rules:")
    for index, item in enumerate(robust[:12], start=1):
        print(
            f"{index}. {item['label']} | {item['horizon']}d | "
            f"direction={item['direction']} signals={item['signalCount']} "
            f"success={item['successRate']:.2%} "
            f"avgDirectionalReturn={item['averageDirectionalReturn']:.2%}"
        )
    if output["latestSignals"]:
        print("\nLatest clean-date signals:")
        for item in output["latestSignals"]:
            print(
                f"{item['date']} {item['label']} "
                f"direction={item['direction']} otc={item['otc_index']:.0f} "
                f"explosion={item['explosion_index']:.0f}"
            )


if __name__ == "__main__":
    main()
