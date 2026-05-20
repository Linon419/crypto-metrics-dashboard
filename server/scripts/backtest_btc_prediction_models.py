#!/usr/bin/env python3
import json
import math
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, ClassifierMixin
from sklearn.cluster import KMeans
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import (
    ExtraTreesClassifier,
    GradientBoostingClassifier,
    HistGradientBoostingClassifier,
    RandomForestClassifier,
)
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.naive_bayes import GaussianNB
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier


ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "database.sqlite"
OUTPUT_PATH = ROOT / "server" / "output" / "btc-prediction-backtest-python.json"
HORIZONS = [1, 3, 5, 7]
SIGNAL_THRESHOLD = 0.60


FEATURE_COLUMNS = [
    "otc_index",
    "explosion_index",
    "entry_exit_day",
    "is_entry_period",
    "is_exit_period",
    "early_entry_period",
    "middle_entry_period",
    "late_entry_period",
    "early_exit_period",
    "middle_exit_period",
    "late_exit_period",
    "otc_change_1d",
    "otc_change_3d",
    "otc_change_7d",
    "explosion_change_1d",
    "explosion_change_3d",
    "explosion_change_7d",
    "otc_pct_change_1d",
    "explosion_pct_change_1d",
    "otc_ma_3",
    "otc_ma_7",
    "explosion_ma_3",
    "explosion_ma_7",
    "otc_slope_3",
    "explosion_slope_3",
    "otc_up_3d",
    "explosion_up_3d",
    "explosion_above_200",
    "explosion_below_0",
    "explosion_cross_up_200",
    "explosion_cross_down_200",
    "otc_above_1000",
    "otc_above_1500",
    "schelling_return_1d",
    "schelling_return_3d",
    "schelling_ma_3",
    "schelling_ma_7",
]


def sigmoid(value):
    value = float(np.clip(value, -30, 30))
    return 1.0 / (1.0 + math.exp(-value))


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

    usable = raw.dropna(subset=["otc_index", "explosion_index", "schelling_point"]).copy()
    usable = usable.sort_values("date").reset_index(drop=True)
    usable["entry_exit_type"] = usable["entry_exit_type"].map(normalize_period_type)
    usable["entry_exit_day"] = usable["entry_exit_day"].fillna(0).clip(lower=0)
    return raw, usable


def add_period_features(df):
    df["is_entry_period"] = (df["entry_exit_type"] == "entry").astype(int)
    df["is_exit_period"] = (df["entry_exit_type"] == "exit").astype(int)
    df["early_entry_period"] = ((df["entry_exit_type"] == "entry") & (df["entry_exit_day"] <= 7)).astype(int)
    df["middle_entry_period"] = (
        (df["entry_exit_type"] == "entry") & (df["entry_exit_day"].between(8, 30))
    ).astype(int)
    df["late_entry_period"] = ((df["entry_exit_type"] == "entry") & (df["entry_exit_day"] > 30)).astype(int)
    df["early_exit_period"] = ((df["entry_exit_type"] == "exit") & (df["entry_exit_day"] <= 7)).astype(int)
    df["middle_exit_period"] = (
        (df["entry_exit_type"] == "exit") & (df["entry_exit_day"].between(8, 30))
    ).astype(int)
    df["late_exit_period"] = ((df["entry_exit_type"] == "exit") & (df["entry_exit_day"] > 30)).astype(int)
    return df


def build_features(usable):
    df = usable.copy()
    df = add_period_features(df)

    for lag in [1, 3, 7]:
        df[f"otc_change_{lag}d"] = df["otc_index"].diff(lag).fillna(0)
        df[f"explosion_change_{lag}d"] = df["explosion_index"].diff(lag).fillna(0)

    df["otc_pct_change_1d"] = df["otc_index"].pct_change(1).replace([np.inf, -np.inf], 0).fillna(0)
    df["explosion_pct_change_1d"] = (
        df["explosion_index"].pct_change(1).replace([np.inf, -np.inf], 0).fillna(0)
    )

    for window in [3, 7]:
        df[f"otc_ma_{window}"] = df["otc_index"].rolling(window, min_periods=1).mean()
        df[f"explosion_ma_{window}"] = df["explosion_index"].rolling(window, min_periods=1).mean()
        df[f"schelling_ma_{window}"] = df["schelling_point"].rolling(window, min_periods=1).mean()

    df["otc_slope_3"] = df["otc_change_3d"]
    df["explosion_slope_3"] = df["explosion_change_3d"]
    df["otc_up_3d"] = (df["otc_change_3d"] > 0).astype(int)
    df["explosion_up_3d"] = (df["explosion_change_3d"] > 0).astype(int)
    df["explosion_above_200"] = (df["explosion_index"] > 200).astype(int)
    df["explosion_below_0"] = (df["explosion_index"] < 0).astype(int)
    df["explosion_cross_up_200"] = (
        (df["explosion_index"].shift(1) <= 200) & (df["explosion_index"] > 200)
    ).astype(int)
    df["explosion_cross_down_200"] = (
        (df["explosion_index"].shift(1) >= 200) & (df["explosion_index"] < 200)
    ).astype(int)
    df["otc_above_1000"] = (df["otc_index"] > 1000).astype(int)
    df["otc_above_1500"] = (df["otc_index"] > 1500).astype(int)
    df["schelling_return_1d"] = df["schelling_point"].pct_change(1).replace([np.inf, -np.inf], 0).fillna(0)
    df["schelling_return_3d"] = df["schelling_point"].pct_change(3).replace([np.inf, -np.inf], 0).fillna(0)

    df[FEATURE_COLUMNS] = df[FEATURE_COLUMNS].replace([np.inf, -np.inf], 0).fillna(0)
    return df


def build_dataset(feature_df):
    rows = []
    for horizon in HORIZONS:
        df = feature_df.copy()
        df["horizon"] = horizon
        df["future_date"] = df["date"].shift(-horizon)
        df["future_schelling_point"] = df["schelling_point"].shift(-horizon)
        df["future_return"] = df["future_schelling_point"] / df["schelling_point"] - 1
        df = df.dropna(subset=["future_schelling_point"]).copy()
        df["target_up"] = (df["future_return"] > 0).astype(int)
        rows.append(df)
    return pd.concat(rows, ignore_index=True)


def condition_key(row):
    explosion = row["explosion_index"]
    if explosion < 0:
        explosion_bucket = "explosion_below_0"
    elif explosion > 200:
        explosion_bucket = "explosion_above_200"
    else:
        explosion_bucket = "explosion_between_0_200"

    otc = row["otc_index"]
    if otc < 1000:
        otc_bucket = "otc_below_1000"
    elif otc > 1500:
        otc_bucket = "otc_above_1500"
    else:
        otc_bucket = "otc_between_1000_1500"

    trend = "otc_up_3d" if row["otc_up_3d"] == 1 else "otc_down_or_flat_3d"

    period = "period_unknown"
    for name in [
        ("early_entry_period", "entry_1_7"),
        ("middle_entry_period", "entry_8_30"),
        ("late_entry_period", "entry_31_plus"),
        ("early_exit_period", "exit_1_7"),
        ("middle_exit_period", "exit_8_30"),
        ("late_exit_period", "exit_31_plus"),
    ]:
        if row[name[0]] == 1:
            period = name[1]
            break

    return "|".join([explosion_bucket, otc_bucket, trend, period])


class BayesianRuleClassifier(BaseEstimator, ClassifierMixin):
    def fit(self, X, y):
        frame = pd.DataFrame(X, columns=FEATURE_COLUMNS)
        frame["target"] = np.asarray(y)
        self.global_probability_ = (frame["target"].sum() + 1) / (len(frame) + 2)
        self.stats_ = {}
        for _, row in frame.iterrows():
            key = condition_key(row)
            stats = self.stats_.setdefault(key, {"total": 0, "up": 0})
            stats["total"] += 1
            stats["up"] += int(row["target"] == 1)
        self.classes_ = np.array([0, 1])
        return self

    def predict_proba(self, X):
        frame = pd.DataFrame(X, columns=FEATURE_COLUMNS)
        probabilities = []
        for _, row in frame.iterrows():
            stats = self.stats_.get(condition_key(row))
            if stats:
                probability = (stats["up"] + 1) / (stats["total"] + 2)
            else:
                probability = self.global_probability_
            probabilities.append([1 - probability, probability])
        return np.asarray(probabilities)

    def predict(self, X):
        return (self.predict_proba(X)[:, 1] >= 0.5).astype(int)


class KMeansStateClassifier(BaseEstimator, ClassifierMixin):
    def __init__(self, n_clusters=4, random_state=5310):
        self.n_clusters = n_clusters
        self.random_state = random_state

    def fit(self, X, y):
        self.scaler_ = StandardScaler()
        scaled = self.scaler_.fit_transform(X)
        clusters = min(self.n_clusters, len(X))
        self.kmeans_ = KMeans(n_clusters=clusters, random_state=self.random_state, n_init=10)
        labels = self.kmeans_.fit_predict(scaled)
        self.cluster_probability_ = {}
        y = np.asarray(y)
        for cluster in range(clusters):
            mask = labels == cluster
            total = int(mask.sum())
            up = int(y[mask].sum())
            self.cluster_probability_[cluster] = (up + 1) / (total + 2)
        self.classes_ = np.array([0, 1])
        return self

    def predict_proba(self, X):
        labels = self.kmeans_.predict(self.scaler_.transform(X))
        probabilities = np.asarray([self.cluster_probability_.get(int(label), 0.5) for label in labels])
        return np.column_stack([1 - probabilities, probabilities])

    def predict(self, X):
        return (self.predict_proba(X)[:, 1] >= 0.5).astype(int)


class RidgeReturnClassifier(BaseEstimator, ClassifierMixin):
    def fit(self, X, y, returns=None):
        self.pipeline_ = Pipeline([
            ("scaler", StandardScaler()),
            ("model", Ridge(alpha=1.0)),
        ])
        target = np.asarray(returns if returns is not None else y, dtype=float)
        self.pipeline_.fit(X, target)
        self.classes_ = np.array([0, 1])
        return self

    def predict_proba(self, X):
        predicted_return = self.pipeline_.predict(X)
        probabilities = np.asarray([sigmoid(value / 0.03) for value in predicted_return])
        return np.column_stack([1 - probabilities, probabilities])

    def predict(self, X):
        return (self.predict_proba(X)[:, 1] >= 0.5).astype(int)


def make_models():
    return {
        "Majority Baseline": DummyClassifier(strategy="prior"),
        "Logistic Regression": Pipeline([
            ("scaler", StandardScaler()),
            ("model", LogisticRegression(max_iter=3000, class_weight="balanced", random_state=5310)),
        ]),
        "Decision Tree": DecisionTreeClassifier(max_depth=4, min_samples_leaf=5, random_state=5310),
        "Naive Bayes": Pipeline([
            ("scaler", StandardScaler()),
            ("model", GaussianNB()),
        ]),
        "Random Forest": RandomForestClassifier(
            n_estimators=300,
            max_depth=5,
            min_samples_leaf=4,
            class_weight="balanced_subsample",
            random_state=5310,
        ),
        "ExtraTrees": ExtraTreesClassifier(
            n_estimators=300,
            max_depth=5,
            min_samples_leaf=4,
            class_weight="balanced",
            random_state=5310,
        ),
        "GradientBoosting": GradientBoostingClassifier(random_state=5310),
        "HistGradientBoosting": HistGradientBoostingClassifier(max_iter=150, learning_rate=0.06, random_state=5310),
        "KMeans State": KMeansStateClassifier(),
        "Bayesian Rule": BayesianRuleClassifier(),
        "Ridge Return": RidgeReturnClassifier(),
    }


def evaluate_predictions(y_true, probabilities, future_returns):
    y_pred = (probabilities >= 0.5).astype(int)
    signals = probabilities >= SIGNAL_THRESHOLD
    signal_returns = future_returns[signals]

    metrics = {
        "total": int(len(y_true)),
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "precision": float(precision_score(y_true, y_pred, zero_division=0)),
        "recall": float(recall_score(y_true, y_pred, zero_division=0)),
        "f1": float(f1_score(y_true, y_pred, zero_division=0)),
        "signalThreshold": SIGNAL_THRESHOLD,
        "signalCount": int(signals.sum()),
        "precisionAtThreshold": float(y_true[signals].mean()) if signals.sum() else 0.0,
        "averageReturnWhenSignal": float(signal_returns.mean()) if signals.sum() else 0.0,
        "winRateWhenSignal": float((signal_returns > 0).mean()) if signals.sum() else 0.0,
        "averageProbability": float(probabilities.mean()),
    }
    try:
        metrics["auc"] = float(roc_auc_score(y_true, probabilities))
    except ValueError:
        metrics["auc"] = 0.5
    return metrics


def result_score(result):
    metrics = result["metrics"]
    enough_signals = 1 if metrics["signalCount"] >= 5 else -1
    horizon_bonus = 0.15 if result["horizon"] in {3, 5} else 0
    average_return_score = max(metrics["averageReturnWhenSignal"], -0.03) * 200
    return (
        enough_signals
        + metrics["precisionAtThreshold"] * 3
        + average_return_score
        + metrics["f1"] * 0.5
        + metrics["auc"] * 0.5
        + min(metrics["signalCount"], 50) / 200
        + horizon_bonus
    )


def train_model(model, X_train, y_train, returns_train):
    if isinstance(model, RidgeReturnClassifier):
        return model.fit(X_train, y_train, returns=returns_train)
    return model.fit(X_train, y_train)


def walk_forward_backtest(dataset):
    results = []
    models = make_models()

    for horizon in HORIZONS:
        horizon_df = dataset[dataset["horizon"] == horizon].sort_values("date").reset_index(drop=True)
        n = len(horizon_df)
        min_train = max(50, int(n * 0.45))
        test_window = max(8, int((n - min_train) / 5))

        for model_name in models:
            y_true_all = []
            probability_all = []
            return_all = []
            fold_count = 0

            for test_start in range(min_train, n, test_window):
                test_end = min(test_start + test_window, n)
                train = horizon_df.iloc[:test_start]
                test = horizon_df.iloc[test_start:test_end]
                if test.empty or train["target_up"].nunique() < 2:
                    continue

                model = make_models()[model_name]
                X_train = train[FEATURE_COLUMNS].to_numpy(dtype=float)
                y_train = train["target_up"].to_numpy(dtype=int)
                returns_train = train["future_return"].to_numpy(dtype=float)
                X_test = test[FEATURE_COLUMNS].to_numpy(dtype=float)

                try:
                    fitted = train_model(model, X_train, y_train, returns_train)
                    probabilities = fitted.predict_proba(X_test)[:, 1]
                except Exception as exc:
                    print(f"skip {model_name} {horizon}d fold: {exc}")
                    continue

                y_true_all.extend(test["target_up"].to_numpy(dtype=int).tolist())
                probability_all.extend(probabilities.tolist())
                return_all.extend(test["future_return"].to_numpy(dtype=float).tolist())
                fold_count += 1

            if y_true_all:
                metrics = evaluate_predictions(
                    np.asarray(y_true_all, dtype=int),
                    np.asarray(probability_all, dtype=float),
                    np.asarray(return_all, dtype=float),
                )
                results.append({
                    "horizon": horizon,
                    "modelName": model_name,
                    "folds": fold_count,
                    "metrics": metrics,
                })

    return results


def latest_predictions(feature_df, dataset, best_result):
    latest = feature_df.iloc[-1]
    predictions = []
    for horizon in HORIZONS:
        horizon_df = dataset[dataset["horizon"] == horizon].sort_values("date").reset_index(drop=True)
        if horizon_df["target_up"].nunique() < 2:
            continue
        X_train = horizon_df[FEATURE_COLUMNS].to_numpy(dtype=float)
        y_train = horizon_df["target_up"].to_numpy(dtype=int)
        returns_train = horizon_df["future_return"].to_numpy(dtype=float)
        X_latest = latest[FEATURE_COLUMNS].to_numpy(dtype=float).reshape(1, -1)

        for model_name, model in make_models().items():
            try:
                fitted = train_model(model, X_train, y_train, returns_train)
                probability = float(fitted.predict_proba(X_latest)[0, 1])
            except Exception:
                continue
            predictions.append({
                "horizon": horizon,
                "modelName": model_name,
                "probability": round(probability, 4),
                "probabilityPercent": round(probability * 100, 2),
                "predictedDirection": "up" if probability >= 0.6 else "down" if probability <= 0.4 else "neutral",
                "trainingRows": int(len(horizon_df)),
            })

    if not best_result:
        return predictions, None
    best_latest = next(
        (
            item
            for item in predictions
            if item["horizon"] == best_result["horizon"] and item["modelName"] == best_result["modelName"]
        ),
        None,
    )
    return predictions, best_latest


def main():
    raw, usable = load_btc_rows()
    feature_df = build_features(usable)
    dataset = build_dataset(feature_df)
    model_results = walk_forward_backtest(dataset)
    ranked = sorted(model_results, key=result_score, reverse=True)
    best_result = ranked[0] if ranked else None
    latest_all, best_latest = latest_predictions(feature_df, dataset, best_result)

    output = {
        "generatedBy": "python-sklearn",
        "data": {
            "totalRows": int(len(raw)),
            "rowsWithSchellingPoint": int(len(usable)),
            "rowsWithoutSchellingPoint": int(len(raw) - len(usable)),
            "firstTrainingDate": str(usable["date"].iloc[0]) if len(usable) else None,
            "latestTrainingFeatureDate": str(usable["date"].iloc[-1]) if len(usable) else None,
            "latestRawDate": str(raw["date"].iloc[-1]) if len(raw) else None,
            "predictionRows": int(len(dataset)),
        },
        "bestResult": best_result,
        "bestLatestPrediction": best_latest,
        "bestByHorizon": [
            sorted([item for item in model_results if item["horizon"] == horizon], key=result_score, reverse=True)[0]
            for horizon in HORIZONS
            if any(item["horizon"] == horizon for item in model_results)
        ],
        "topResults": ranked[:20],
        "latestPredictions": latest_all,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")

    print("========== Python BTC prediction backtest ==========")
    print(
        f"Rows: total={output['data']['totalRows']}, "
        f"with_schelling={output['data']['rowsWithSchellingPoint']}, "
        f"without_schelling={output['data']['rowsWithoutSchellingPoint']}"
    )
    print(
        f"Training range: {output['data']['firstTrainingDate']} -> "
        f"{output['data']['latestTrainingFeatureDate']}"
    )
    print(f"Output: {OUTPUT_PATH}")
    print("\nTop results:")
    for index, item in enumerate(ranked[:12], start=1):
        metrics = item["metrics"]
        print(
            f"{index}. {item['modelName']} {item['horizon']}d "
            f"signals={metrics['signalCount']} "
            f"precision@60={metrics['precisionAtThreshold']:.2%} "
            f"f1={metrics['f1']:.2%} "
            f"auc={metrics['auc']:.2%} "
            f"avgSignalReturn={metrics['averageReturnWhenSignal']:.2%}"
        )

    if best_result:
        metrics = best_result["metrics"]
        print("\nBest selected result:")
        print(
            f"{best_result['modelName']} {best_result['horizon']}d "
            f"precision@60={metrics['precisionAtThreshold']:.2%}, "
            f"signals={metrics['signalCount']}, "
            f"f1={metrics['f1']:.2%}, "
            f"auc={metrics['auc']:.2%}, "
            f"avgSignalReturn={metrics['averageReturnWhenSignal']:.2%}"
        )
    if best_latest:
        print("\nLatest usable prediction:")
        print(
            f"{output['data']['latestTrainingFeatureDate']} "
            f"{best_latest['modelName']} {best_latest['horizon']}d "
            f"probability={best_latest['probabilityPercent']:.2f}% "
            f"direction={best_latest['predictedDirection']}"
        )


if __name__ == "__main__":
    main()
