# Database Patch Workflow

Use this workflow for precise cloud database corrections from local Codex.

## Patch Format

```json
{
  "reason": "修正 BTC 2026-05-18 完整时间",
  "operations": [
    {
      "table": "DailyMetrics",
      "match": {
        "symbol": "BTC",
        "date": "2026-05-18"
      },
      "set": {
        "timestamp": "2026-05-18T23:01:00+10:00",
        "time_precision": "minute"
      }
    }
  ]
}
```

## Supported Tables

`DailyMetrics` uses `symbol + date` as the match key.

Allowed update fields:

```text
otc_index
explosion_index
schelling_point
entry_exit_type
entry_exit_day
near_threshold
momentum_indicators
timestamp
time_precision
```

`LiquidityOverviews` uses `date` as the match key.

Allowed update fields:

```text
btc_fund_change
eth_fund_change
sol_fund_change
total_market_fund_change
comments
daily_reminder
timestamp
time_precision
```

`TrendingCoins` uses `symbol + date` as the match key.

Allowed update fields:

```text
otc_index
explosion_index
schelling_point
entry_exit_type
entry_exit_day
timestamp
time_precision
```

## Local Commands

```bash
export CLOUD_API_BASE_URL="https://your-cloud-domain.example"
export CLOUD_API_TOKEN="<admin-jwt-token>"

node server/scripts/apply-cloud-patch.js data-patches/fix-btc-time.json --dry-run
node server/scripts/apply-cloud-patch.js data-patches/fix-btc-time.json --apply
```

## Cloud Endpoints

```text
POST /api/admin/database-patches/dry-run
POST /api/admin/database-patches/apply
GET  /api/admin/database-patches/logs
```

All endpoints require an admin bearer token.
