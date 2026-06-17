# BTC Options Live Payoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/options` live BTC options strategy setup and payoff experience described in `docs/superpowers/specs/2026-06-08-options-live-payoff-design.md`.

**Architecture:** Add a backend options market-data layer with Deribit REST caching, pure strategy blueprint and payoff utilities, then wire the frontend drawer to fetch a live setup and render editable legs, scenario metrics, and payoff charts. Keep the existing course-source index intact and add live setup as an additive layer.

**Tech Stack:** Node.js CommonJS backend, Express routes, React 19, Ant Design, ECharts via existing chart dependency, Node `assert` script tests, React Testing Library.

---

### Task 1: Backend Deribit Options Data Layer

**Files:**
- Create: `server/utils/deribitOptions.js`
- Create: `server/tests/deribitOptions.test.js`

- [ ] **Step 1: Write failing tests**

Test URL construction, option-chain normalization, TTL cache reuse, and stale-cache fallback in `server/tests/deribitOptions.test.js`.

- [ ] **Step 2: Verify failure**

Run: `node server/tests/deribitOptions.test.js`
Expected: module missing or exported functions missing.

- [ ] **Step 3: Implement data layer**

Create fetch helpers for `get_instruments`, `get_book_summary_by_currency`, and `ticker`. Normalize Deribit rows into stable fields used by blueprint and frontend code.

- [ ] **Step 4: Verify green**

Run: `node server/tests/deribitOptions.test.js`
Expected: test script prints `deribitOptions.test.js passed`.

### Task 2: Strategy Blueprints

**Files:**
- Create: `server/utils/optionsStrategyBlueprints.js`
- Create: `server/tests/optionsStrategyBlueprints.test.js`

- [ ] **Step 1: Write failing tests**

Test that all 20 catalog strategy ids have a blueprint and can generate valid legs from a mocked BTC chain.

- [ ] **Step 2: Verify failure**

Run: `node server/tests/optionsStrategyBlueprints.test.js`
Expected: module missing or missing blueprint failures.

- [ ] **Step 3: Implement blueprints**

Define leg selection rules for long/short straddles, strangles, iron condor, calendar, diagonal, butterfly, collar, put-spread collar, gamma scalping, directional spreads, risk reversal, synthetic long, crab, ratio spread, bull three-leg, and alligator.

- [ ] **Step 4: Verify green**

Run: `node server/tests/optionsStrategyBlueprints.test.js`
Expected: test script prints `optionsStrategyBlueprints.test.js passed`.

### Task 3: Payoff and Scenario Engine

**Files:**
- Create: `server/utils/optionsPayoff.js`
- Create: `server/tests/optionsPayoff.test.js`

- [ ] **Step 1: Write failing tests**

Test inverse BTC option expiry payoff, iron condor capped risk, collar with virtual 1 BTC underlying, Black-Scholes scenario output, and scenario summary metrics.

- [ ] **Step 2: Verify failure**

Run: `node server/tests/optionsPayoff.test.js`
Expected: module missing or missing function failures.

- [ ] **Step 3: Implement payoff engine**

Implement inverse BTC intrinsic values, premium accounting, virtual underlying legs, Black-Scholes repricing, IV scenarios, time scenarios, breakeven approximation, max profit/loss, and portfolio Greeks aggregation.

- [ ] **Step 4: Verify green**

Run: `node server/tests/optionsPayoff.test.js`
Expected: test script prints `optionsPayoff.test.js passed`.

### Task 4: Backend Options Routes

**Files:**
- Create: `server/routes/options.js`
- Modify: `server/index.js`
- Create: `server/tests/optionsRoutes.test.js`

- [ ] **Step 1: Write failing route tests**

Test `GET /api/options/btc/chain`, `GET /api/options/btc/strategies/:strategyId/setup`, `POST /api/options/btc/payoff`, and `GET /api/options/btc/ticker`.

- [ ] **Step 2: Verify failure**

Run: `node server/tests/optionsRoutes.test.js`
Expected: route module missing or route assertions fail.

- [ ] **Step 3: Implement routes**

Mount `/api/options` behind existing auth middleware and return `{ success, data }` responses matching frontend needs.

- [ ] **Step 4: Verify green**

Run: `node server/tests/optionsRoutes.test.js`
Expected: test script prints `optionsRoutes.test.js passed`.

### Task 5: Frontend API and Drawer UI

**Files:**
- Modify: `src/services/api.js`
- Modify: `src/components/OptionsPage.jsx`
- Modify: `src/components/OptionsStrategyDrawer.jsx`
- Create: `src/components/OptionsLegTable.jsx`
- Create: `src/components/OptionsPayoffChart.jsx`
- Create: `src/components/OptionsScenarioMetrics.jsx`
- Create: `src/components/OptionsLiveSetupPanel.jsx`
- Modify: `src/styles/design-system.css`
- Modify: `src/components/__tests__/OptionsPage.test.jsx`

- [ ] **Step 1: Write failing frontend tests**

Test that the drawer requests a live setup, shows legs and metrics, and allows quantity/price basis changes that update displayed values.

- [ ] **Step 2: Verify failure**

Run: `CI=true npm test -- --runInBand src/components/__tests__/OptionsPage.test.jsx`
Expected: assertions for live setup UI fail.

- [ ] **Step 3: Implement frontend wiring**

Add API functions, fetch live setup on drawer open, add editable controls, render leg table, render payoff chart with ECharts, and display scenario metrics.

- [ ] **Step 4: Verify green**

Run: `CI=true npm test -- --runInBand src/components/__tests__/OptionsPage.test.jsx`
Expected: tests pass.

### Task 6: Final Verification

**Files:**
- Relevant changed files from Tasks 1-5.

- [ ] **Step 1: Run backend unit tests**

Run:
```bash
node server/tests/deribitOptions.test.js
node server/tests/optionsStrategyBlueprints.test.js
node server/tests/optionsPayoff.test.js
node server/tests/optionsRoutes.test.js
```

- [ ] **Step 2: Run frontend tests**

Run:
```bash
CI=true npm test -- --runInBand src/utils/optionsKnowledge.test.js src/components/__tests__/OptionsPage.test.jsx
```

- [ ] **Step 3: Build**

Run: `npm run build`

- [ ] **Step 4: Browser check**

Open `http://localhost:3000/options`, verify the BTC DVOL chart, strategy list, iron condor detail, editable setup controls, leg table, scenario metrics, and payoff chart.

## Self Review

- Spec coverage: tasks cover data/cache, 20 strategy blueprints, payoff and scenarios, backend APIs, frontend drawer, tests, and browser verification.
- Placeholder scan: this plan has no `TBD` or unowned implementation area.
- Type consistency: backend route names, utility modules, and frontend component names match the approved design document.
