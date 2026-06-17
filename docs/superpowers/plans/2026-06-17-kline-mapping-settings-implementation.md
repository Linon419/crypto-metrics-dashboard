# K Line Mapping Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin-managed K line mapping settings page so each dashboard coin can choose its K line market source and trading symbol.

**Architecture:** Add a `CoinKlineMapping` Sequelize model and migration, expose admin CRUD endpoints, and make K line sync/read paths resolve the mapping before choosing Binance, Yahoo, or Deribit. Add a protected React settings page under admin navigation that edits mappings through the admin API.

**Tech Stack:** Node.js, Express, Sequelize, SQLite, React, Ant Design, Jest/React Testing Library, Node assert tests.

---

### Task 1: Backend Mapping Model And Utilities

**Files:**
- Create: `server/models/coinklinemapping.js`
- Create: `server/migrations/20260617000003-create-coin-kline-mappings.js`
- Create: `server/utils/coinKlineMappings.js`
- Modify: `server/models/coin.js`
- Test: `server/tests/coinKlineMappings.test.js`

- [ ] **Step 1: Write failing tests**

Create `server/tests/coinKlineMappings.test.js` with checks for source validation, default mapping resolution, Binance symbol normalization, and seed payload creation.

- [ ] **Step 2: Run test to verify failure**

Run: `node server/tests/coinKlineMappings.test.js`

Expected: failure because `server/utils/coinKlineMappings.js` does not exist.

- [ ] **Step 3: Implement model, migration, and utility module**

Add `CoinKlineMapping` with `coin_id`, `coin_symbol`, `market`, `trading_symbol`, `enabled`, and `notes`. Implement utility functions:

- `KLINE_MARKETS`
- `normalizeKlineMappingInput`
- `getDefaultKlineMappingForSymbol`
- `resolveEffectiveKlineMapping`
- `buildDefaultKlineMappingsForCoins`

- [ ] **Step 4: Run test to verify pass**

Run: `node server/tests/coinKlineMappings.test.js`

Expected: pass.

### Task 2: Wire Mapping Into K Line Sync

**Files:**
- Modify: `server/utils/coinKlines.js`
- Modify: `server/routes/coins.js`
- Modify: `server/services/klineWebSocketServer.js`
- Test: `server/tests/coinKlines.test.js`

- [ ] **Step 1: Add failing K line mapping tests**

Extend `server/tests/coinKlines.test.js` with:

- `syncCoinKlines` uses a Yahoo mapping for `CN_AI_ETF -> 159819.SZ`.
- `syncCoinKlines` uses a Deribit mapping for `VEGA -> BTC-DVOL`.
- Stored K line lookup uses the mapped market.

- [ ] **Step 2: Run tests to verify failure**

Run: `node server/tests/coinKlines.test.js`

Expected: mapping-specific assertions fail because `syncCoinKlines` only uses hardcoded symbol logic.

- [ ] **Step 3: Implement mapping-aware sync**

Update `coinKlines.js` so `syncCoinKlines`, `fetchMarketKlinesWithFallback`, `getPreferredKlineMarket`, `resolveYahooSymbol`, and `findCoinKlineBackfillGaps` accept an optional effective mapping. Update coin routes and websocket sync to pass `CoinKlineMapping` model when available.

- [ ] **Step 4: Run tests to verify pass**

Run: `node server/tests/coinKlines.test.js`

Expected: pass.

### Task 3: Admin Mapping API

**Files:**
- Modify: `server/routes/admin.js`
- Test: `server/tests/klineMappingsAdmin.test.js`

- [ ] **Step 1: Write failing route tests**

Create `server/tests/klineMappingsAdmin.test.js` using a minimal Express app with mocked admin auth behavior if needed. Cover listing, updating, invalid source rejection, and seed defaults.

- [ ] **Step 2: Run test to verify failure**

Run: `node server/tests/klineMappingsAdmin.test.js`

Expected: failure because admin mapping routes do not exist.

- [ ] **Step 3: Implement admin endpoints**

Add:

- `GET /admin/kline-mappings`
- `PUT /admin/kline-mappings/:coinId`
- `POST /admin/kline-mappings/seed-defaults`

Responses include coin metadata, mapping fields, and effective defaults.

- [ ] **Step 4: Run test to verify pass**

Run: `node server/tests/klineMappingsAdmin.test.js`

Expected: pass.

### Task 4: Frontend API And Settings Page

**Files:**
- Modify: `src/services/api.js`
- Create: `src/components/KlineMappingSettings.jsx`
- Modify: `src/App.js`
- Modify: `src/components/Dashboard.jsx`
- Test: `src/components/__tests__/KlineMappingSettings.test.jsx`

- [ ] **Step 1: Write failing component test**

Create a test that mocks API responses, renders the settings page, changes `CN_AI_ETF` to Yahoo `159819.SZ`, saves, and asserts the update API is called.

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- --runInBand src/components/__tests__/KlineMappingSettings.test.jsx --watchAll=false`

Expected: failure because the component does not exist.

- [ ] **Step 3: Implement frontend API and page**

Add API helpers:

- `fetchKlineMappings`
- `updateKlineMapping`
- `seedDefaultKlineMappings`

Create table page with columns for coin, source, trading symbol, enabled switch, notes, update time, and save action. Add route `/settings/kline-mappings` and admin dropdown entry.

- [ ] **Step 4: Run test to verify pass**

Run: `npm test -- --runInBand src/components/__tests__/KlineMappingSettings.test.jsx --watchAll=false`

Expected: pass.

### Task 5: Final Verification

**Files:**
- All modified files

- [ ] **Step 1: Run targeted backend tests**

Run:

```bash
node server/tests/coinKlineMappings.test.js
node server/tests/coinKlines.test.js
node server/tests/klineMappingsAdmin.test.js
```

Expected: all pass.

- [ ] **Step 2: Run targeted frontend tests**

Run:

```bash
npm test -- --runInBand src/components/__tests__/KlineMappingSettings.test.jsx src/components/__tests__/OtcCycleChart.test.jsx --watchAll=false
```

Expected: all pass.

- [ ] **Step 3: Build**

Run: `npm run build`

Expected: build exits 0. Existing lint warnings may remain.

- [ ] **Step 4: Inspect diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; status shows only planned files plus existing hover-fix files.
