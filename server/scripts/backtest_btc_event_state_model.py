#!/usr/bin/env python3
import json
import math
import sqlite3
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "database.sqlite"
OUTPUT_PATH = ROOT / "server" / "output" / "btc-event-state-backtest-python.json"
HORIZONS = [1, 3, 5, 7]
THRESHOLDS = [0.55, 0.60, 0.70]


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
        rows = pd.read_sql_query(query, conn)

    rows["date"] = rows["date"].astype(str)
    for column in ["otc_index", "explosion_index", "schelling_point", "entry_exit_day"]:
        rows[column] = pd.to_numeric(rows[column], errors="coerce")
    rows["entry_exit_type"] = rows["entry_exit_type"].fillna("unknown").astype(str).str.lower()

    usable = rows.dropna(subset=["otc_index", "explosion_index", "schelling_point"]).copy().reset_index(drop=True)
    clean, excluded = remove_schelling_outliers(usable)
    return rows.reset_index(drop=True), usable, clean.reset_index(drop=True), excluded.reset_index(drop=True)


def remove_schelling_outliers(rows):
    if rows.empty:
        return rows, rows
    median = rows["schelling_point"].rolling(7, center=True, min_periods=3).median()
    median = median.fillna(rows["schelling_point"].median())
    mask = (rows["schelling_point"] >= median * 0.5) & (rows["schelling_point"] <= median * 1.8)
    return rows[mask].copy(), rows[~mask].copy()


def period_bucket(day):
    if day <= 7:
        return "day_1_7"
    if day <= 30:
        return "day_8_30"
    return "day_31_plus"


def level_bucket(value, low, high, name):
    if value < low:
        return f"{name}_below_{low}"
    if value > high:
        return f"{name}_above_{high}"
    return f"{name}_{low}_{high}"


def change_bucket(change):
    if change is None or not np.isfinite(change):
        return "otc_change_unknown"
    if change >= 0.15:
        return "otc_strong_up"
    if change >= 0.05:
        return "otc_up"
    if change > -0.05:
        return "otc_flat"
    if change <= -0.15:
        return "otc_strong_down"
    return "otc_down"


def trend_3d(rows, index):
    if index < 3:
        return "otc_trend_unknown"
    return "otc_trend_up" if rows.loc[index, "otc_index"] > rows.loc[index - 3, "otc_index"] else "otc_trend_down"


def is_entry_start(rows, index):
    row = rows.loc[index]
    if row["entry_exit_type"] != "entry":
        return False
    if int(row["entry_exit_day"] or 0) == 1:
        return True
    if index == 0:
        return True
    return rows.loc[index - 1, "entry_exit_type"] != "entry"


def is_exit_start(rows, index):
    row = rows.loc[index]
    if row["entry_exit_type"] != "exit":
        return False
    if int(row["entry_exit_day"] or 0) == 1:
        return True
    if index == 0:
        return True
    return rows.loc[index - 1, "entry_exit_type"] != "exit"


def event_type_for(rows, index):
    row = rows.loc[index]
    phase = row["entry_exit_type"]
    if phase not in {"entry", "exit"}:
        return None

    prev = rows.loc[index - 1] if index > 0 else None
    if phase == "entry" and is_entry_start(rows, index):
        return "entry_start"
    if phase == "exit" and is_exit_start(rows, index):
        return "exit_start"
    if prev is not None and prev["explosion_index"] >= 200 and row["explosion_index"] < 200:
        return "explosion_cross_down_200"
    if prev is not None and prev["explosion_index"] < 0 and row["explosion_index"] >= 0:
        return "explosion_neg_to_pos"
    return None


def infer_rule_direction(phase, event_type, otc_change):
    if phase == "entry":
        if event_type in {"entry_start", "explosion_neg_to_pos"}:
            return "up" if otc_change is None or otc_change > -0.05 else "down"
        if event_type == "explosion_cross_down_200":
            return "up" if otc_change is not None and otc_change > 0 else "down"

    if phase == "exit":
        if event_type in {"exit_start", "explosion_neg_to_pos"}:
            return "down" if otc_change is None or otc_change <= 0 else "up"
        if event_type == "explosion_cross_down_200":
            return "down"

    return None


def build_event_rows(rows):
    events = []
    last_entry_key = None
    last_exit_key = None

    for index in range(len(rows)):
        event_type = event_type_for(rows, index)
        if not event_type:
            continue

        row = rows.loc[index]
        phase = row["entry_exit_type"]
        baseline = last_entry_key if phase == "entry" else last_exit_key
        otc_change = None
        if baseline is not None and baseline["otc_index"]:
            otc_change = row["otc_index"] / baseline["otc_index"] - 1

        direction = infer_rule_direction(phase, event_type, otc_change)
        if direction is None:
            continue

        event = {
            "row_index": int(index),
            "date": row["date"],
            "phase": phase,
            "event_type": event_type,
            "period_day": int(row["entry_exit_day"] or 0),
            "period_bucket": period_bucket(int(row["entry_exit_day"] or 0)),
            "otc_index": float(row["otc_index"]),
            "explosion_index": float(row["explosion_index"]),
            "schelling_point": float(row["schelling_point"]),
            "baseline_date": baseline["date"] if baseline is not None else None,
            "baseline_otc_index": float(baseline["otc_index"]) if baseline is not None else None,
            "otc_change_from_key": float(otc_change) if otc_change is not None else None,
            "otc_change_bucket": change_bucket(otc_change),
            "otc_level_bucket": level_bucket(row["otc_index"], 1000, 1500, "otc"),
            "explosion_level_bucket": level_bucket(row["explosion_index"], 0, 200, "explosion"),
            "otc_trend_3d": trend_3d(rows, index),
            "rule_direction": direction,
        }
        events.append(event)

        if phase == "entry" and event_type in {"entry_start", "explosion_cross_down_200"}:
            last_entry_key = row
        if phase == "exit" and event_type in {"exit_start", "explosion_neg_to_pos"}:
            last_exit_key = row

    return pd.DataFrame(events)


def add_targets(events, rows):
    output = []
    for _, event in events.iterrows():
        index = int(event["row_index"])
        for horizon in HORIZONS:
            future_index = index + horizon
            if future_index >= len(rows):
                continue
            future = rows.loc[future_index]
            future_return = future["schelling_point"] / event["schelling_point"] - 1
            if event["rule_direction"] == "up":
                success = future_return > 0
                directional_return = future_return
            else:
                success = future_return < 0
                directional_return = -future_return
            item = event.to_dict()
            item.update({
                "horizon": horizon,
                "future_date": future["date"],
                "future_return": float(future_return),
                "directional_return": float(directional_return),
                "success": int(success),
            })
            output.append(item)
    return pd.DataFrame(output)


def key_exact(row):
    return "|".join([
        row["phase"],
        row["event_type"],
        row["period_bucket"],
        row["otc_change_bucket"],
        row["otc_level_bucket"],
        row["explosion_level_bucket"],
        row["otc_trend_3d"],
        row["rule_direction"],
    ])


def key_medium(row):
    return "|".join([
        row["phase"],
        row["event_type"],
        row["otc_change_bucket"],
        row["rule_direction"],
    ])


def key_broad(row):
    return "|".join([
        row["phase"],
        row["event_type"],
        row["rule_direction"],
    ])


def key_phase(row):
    return "|".join([row["phase"], row["rule_direction"]])


def build_counts(rows, key_fn):
    counts = defaultdict(lambda: {"total": 0, "success": 0})
    for _, row in rows.iterrows():
        key = key_fn(row)
        counts[key]["total"] += 1
        counts[key]["success"] += int(row["success"])
    return counts


def smooth(success, total, prior, strength):
    return (success + prior * strength) / (total + strength)


def predict_row(train, row, strength=4.0):
    if train.empty:
        return None

    global_prior = smooth(int(train["success"].sum()), len(train), 0.5, 2.0)
    phase_counts = build_counts(train, key_phase)
    broad_counts = build_counts(train, key_broad)
    medium_counts = build_counts(train, key_medium)
    exact_counts = build_counts(train, key_exact)

    phase = phase_counts.get(key_phase(row), {"total": 0, "success": 0})
    phase_prob = smooth(phase["success"], phase["total"], global_prior, strength)

    broad = broad_counts.get(key_broad(row), {"total": 0, "success": 0})
    broad_prob = smooth(broad["success"], broad["total"], phase_prob, strength)

    medium = medium_counts.get(key_medium(row), {"total": 0, "success": 0})
    medium_prob = smooth(medium["success"], medium["total"], broad_prob, strength)

    exact = exact_counts.get(key_exact(row), {"total": 0, "success": 0})
    exact_prob = smooth(exact["success"], exact["total"], medium_prob, strength)

    support = {
        "exact": dict(exact),
        "medium": dict(medium),
        "broad": dict(broad),
        "phase": dict(phase),
        "train_total": int(len(train)),
    }

    if exact["total"] >= 5:
        confidence = "high"
    elif medium["total"] >= 5:
        confidence = "medium"
    else:
        confidence = "low"

    return {
        "probability": float(exact_prob),
        "confidence": confidence,
        "support": support,
        "conditionKey": key_exact(row),
    }


def walk_forward(dataset):
    predictions = []
    for horizon in HORIZONS:
        horizon_rows = dataset[dataset["horizon"] == horizon].sort_values("date").reset_index(drop=True)
        for index in range(len(horizon_rows)):
            train = horizon_rows.iloc[:index]
            row = horizon_rows.iloc[index]
            if len(train) < 8 or train["success"].nunique() < 2:
                continue
            prediction = predict_row(train, row)
            if not prediction:
                continue
            predictions.append({
                "date": row["date"],
                "horizon": int(horizon),
                "phase": row["phase"],
                "event_type": row["event_type"],
                "rule_direction": row["rule_direction"],
                "success": int(row["success"]),
                "future_return": float(row["future_return"]),
                "directional_return": float(row["directional_return"]),
                **prediction,
            })
    return pd.DataFrame(predictions)


def summarize_predictions(predictions):
    rows = []
    for horizon in HORIZONS:
        subset = predictions[predictions["horizon"] == horizon]
        if subset.empty:
            continue
        for threshold in THRESHOLDS:
            signals = subset[subset["probability"] >= threshold]
            rows.append({
                "horizon": horizon,
                "threshold": threshold,
                "evaluatedEvents": int(len(subset)),
                "signalCount": int(len(signals)),
                "precision": float(signals["success"].mean()) if len(signals) else 0.0,
                "averageDirectionalReturn": float(signals["directional_return"].mean()) if len(signals) else 0.0,
                "averageProbability": float(signals["probability"].mean()) if len(signals) else 0.0,
            })
    return sorted(rows, key=result_score, reverse=True)


def result_score(row):
    enough = 1 if row["signalCount"] >= 5 else -1
    horizon_bonus = 0.15 if row["horizon"] in {3, 5} else 0.0
    return (
        enough
        + row["precision"] * 3
        + max(row["averageDirectionalReturn"], -0.05) * 120
        + min(row["signalCount"], 30) / 100
        + horizon_bonus
    )


def precision_score_rank(row):
    enough = 1 if row["signalCount"] >= 5 else -1
    return (
        enough,
        row["precision"],
        row["signalCount"],
        row["averageDirectionalReturn"],
        row["threshold"],
    )


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


def latest_event_prediction(events, dataset):
    if events.empty:
        return None
    latest = events.sort_values("date").iloc[-1]
    output = []
    for horizon in HORIZONS:
        train = dataset[(dataset["horizon"] == horizon) & (dataset["date"] < latest["date"])]
        if len(train) < 8 or train["success"].nunique() < 2:
            continue
        row = latest.copy()
        row["horizon"] = horizon
        prediction = predict_row(train, row)
        if not prediction:
            continue
        output.append({
            "date": latest["date"],
            "horizon": horizon,
            "phase": latest["phase"],
            "event_type": latest["event_type"],
            "rule_direction": latest["rule_direction"],
            "otc_change_from_key": latest["otc_change_from_key"],
            "probability": round(prediction["probability"], 4),
            "probabilityPercent": round(prediction["probability"] * 100, 2),
            "confidence": prediction["confidence"],
            "support": prediction["support"],
            "conditionKey": prediction["conditionKey"],
        })
    return output


def main():
    raw, usable, clean, excluded = load_btc_rows()
    events = build_event_rows(clean)
    dataset = add_targets(events, clean)
    predictions = walk_forward(dataset)
    ranked = summarize_predictions(predictions)
    precision_ranked = sorted(ranked, key=precision_score_rank, reverse=True)
    latest = latest_event_prediction(events, dataset)

    output = {
        "modelName": "Bayesian Event-State Rule Model",
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
            "firstTrainingDate": clean["date"].iloc[0] if len(clean) else None,
            "latestTrainingFeatureDate": clean["date"].iloc[-1] if len(clean) else None,
            "latestRawDate": raw["date"].iloc[-1] if len(raw) else None,
            "eventRows": int(len(events)),
            "targetRows": int(len(dataset)),
            "walkForwardPredictions": int(len(predictions)),
        },
        "bestResult": ranked[0] if ranked else None,
        "bestPrecisionResult": precision_ranked[0] if precision_ranked else None,
        "rankedResults": ranked,
        "precisionRankedResults": precision_ranked,
        "latestEventPredictions": latest,
        "events": events.to_dict(orient="records"),
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(json_safe(output), indent=2, ensure_ascii=False), encoding="utf-8")

    print("========== BTC Bayesian Event-State Rule Model ==========")
    print(
        f"Rows: total={output['data']['totalRows']}, "
        f"with_schelling={output['data']['rowsWithSchellingPoint']}, "
        f"clean_used={output['data']['cleanRowsUsed']}, "
        f"events={output['data']['eventRows']}"
    )
    print(f"Output: {OUTPUT_PATH}")
    print("\nTop precision results:")
    for index, item in enumerate(ranked[:12], start=1):
        print(
            f"{index}. {item['horizon']}d threshold={item['threshold']:.0%} "
            f"signals={item['signalCount']} precision={item['precision']:.2%} "
            f"avgDirectionalReturn={item['averageDirectionalReturn']:.2%} "
            f"avgProbability={item['averageProbability']:.2%}"
        )
    if latest:
        print("\nLatest event predictions:")
        for item in latest:
            print(
                f"{item['date']} {item['event_type']} {item['horizon']}d "
                f"direction={item['rule_direction']} probability={item['probabilityPercent']:.2f}% "
                f"confidence={item['confidence']}"
            )
    if precision_ranked:
        item = precision_ranked[0]
        print("\nBest precision result:")
        print(
            f"{item['horizon']}d threshold={item['threshold']:.0%} "
            f"signals={item['signalCount']} precision={item['precision']:.2%} "
            f"avgDirectionalReturn={item['averageDirectionalReturn']:.2%}"
        )


if __name__ == "__main__":
    main()
