# Automatic Official Logos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically display official Brandfetch logos for newly added ordinary symbols such as GLW while preserving explicit, special-asset, and deterministic fallback logos.

**Architecture:** Extend runtime configuration with a public Brandfetch Client ID and keep logo-source selection in the focused frontend `coinLogos` utility. Explicit logo URLs and existing backend-owned special assets keep their current path; other symbols use Brandfetch's documented identifier auto-detection CDN URL and component-level image errors fall back to the existing deterministic SVG.

**Tech Stack:** React 19, Jest via react-scripts, Express 5 runtime configuration, Brandfetch Logo API.

---

## File Structure

- Create `server/utils/runtimeConfig.js`: serialize public runtime configuration safely and independently from Express startup.
- Create `server/tests/runtimeConfig.test.js`: verify Brandfetch configuration exposure and escaping.
- Modify `server/index.js`: delegate `/app-config.js` generation to the runtime-config utility.
- Modify `src/utils/coinLogos.js`: choose explicit, backend-special, Brandfetch, or backend-default logo URLs.
- Modify `src/utils/coinLogos.test.js`: cover GLW, special assets, missing configuration, and explicit logo behavior.
- Modify `docs/deployment/server-deployment.md`: document `BRANDFETCH_CLIENT_ID`.
- Modify `deploy/docker/docker-compose.prod.yml`, `deploy/docker/docker-compose-fixed.yml`, and `docker-compose.yml`: pass the Client ID into the container without embedding a credential value.

### Task 1: Runtime Brandfetch Configuration

**Files:**
- Create: `server/utils/runtimeConfig.js`
- Create: `server/tests/runtimeConfig.test.js`
- Modify: `server/index.js:75-100`

- [ ] **Step 1: Write the failing runtime-config test**

```js
const assert = require('assert');
const { buildRuntimeConfigScript } = require('../utils/runtimeConfig');

const script = buildRuntimeConfigScript({
  apiBaseUrl: 'https://dashboard.example/api',
  brandfetchClientId: 'client-123',
});

assert.match(script, /"API_BASE_URL":"https:\/\/dashboard\.example\/api"/);
assert.match(script, /"BRANDFETCH_CLIENT_ID":"client-123"/);
assert.doesNotThrow(() => new Function(script));
console.log('runtimeConfig.test.js passed');
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node server/tests/runtimeConfig.test.js`

Expected: FAIL with `Cannot find module '../utils/runtimeConfig'`.

- [ ] **Step 3: Implement safe runtime-config serialization**

```js
function buildRuntimeConfigScript({ apiBaseUrl, brandfetchClientId = '' }) {
  const config = {
    API_BASE_URL: String(apiBaseUrl || ''),
    BRANDFETCH_CLIENT_ID: String(brandfetchClientId || ''),
  };
  const serialized = JSON.stringify(config).replace(/</g, '\\u003c');
  return `window.runtimeConfig = ${serialized};`;
}

module.exports = { buildRuntimeConfigScript };
```

- [ ] **Step 4: Use the utility in `/app-config.js`**

Import `buildRuntimeConfigScript` in `server/index.js`, then replace the inline object template with:

```js
const configScript = buildRuntimeConfigScript({
  apiBaseUrl: `${apiPublicHost}${apiBasePath}`,
  brandfetchClientId: process.env.BRANDFETCH_CLIENT_ID,
});
```

Keep the existing missing-`API_PUBLIC_HOST` error response and response content type.

- [ ] **Step 5: Run the runtime-config test and verify GREEN**

Run: `node server/tests/runtimeConfig.test.js`

Expected: `runtimeConfig.test.js passed`.

- [ ] **Step 6: Commit runtime configuration**

```bash
git add server/index.js server/utils/runtimeConfig.js server/tests/runtimeConfig.test.js
git commit -m "feat(config): 暴露Brandfetch客户端配置"
```

### Task 2: Automatic Logo Source Resolution

**Files:**
- Modify: `src/utils/coinLogos.js`
- Modify: `src/utils/coinLogos.test.js`

- [ ] **Step 1: Add failing resolver tests**

Add these cases to `src/utils/coinLogos.test.js`:

```js
test('uses Brandfetch auto-detection for a newly added stock symbol', () => {
  window.runtimeConfig = { BRANDFETCH_CLIENT_ID: 'client-123' };
  expect(getCoinLogoUrl('GLW')).toBe('https://cdn.brandfetch.io/GLW?c=client-123');
});

test('keeps backend artwork for special assets', () => {
  window.runtimeConfig = { BRANDFETCH_CLIENT_ID: 'client-123' };
  expect(getCoinLogoUrl('GOLD')).toContain('/api/logos/GOLD');
  expect(getCoinLogoUrl('CN_HOG')).toContain('/api/logos/CN_HOG');
});

test('keeps backend resolution when Brandfetch is unconfigured', () => {
  window.runtimeConfig = {};
  expect(getCoinLogoUrl('GLW')).toContain('/api/logos/GLW');
});

test('keeps manually configured remote logos on the backend route', () => {
  window.runtimeConfig = { BRANDFETCH_CLIENT_ID: 'client-123' };
  expect(getCoinLogoUrl('GLW', 'https://example.com/glw.png')).toContain('/api/logos/GLW');
});
```

- [ ] **Step 2: Run the logo tests and verify RED**

Run: `CI=true npm test -- --runInBand src/utils/coinLogos.test.js`

Expected: FAIL because GLW still resolves to the backend logo route.

- [ ] **Step 3: Implement the minimal Brandfetch resolver**

Add the backend-special set and helper in `src/utils/coinLogos.js`:

```js
const BACKEND_LOGO_SYMBOLS = new Set([
  'AAOI', 'A_SHARES', 'A_SHARES_INDEX', 'CEMENT', 'CN_AI_ETF', 'CN_HOG',
  'CN_INDEX', 'CN_ROBOT', 'COPP', 'COPPER', 'DOMESTIC_AI',
  'DOMESTIC_AI_ETF', 'DOMESTIC_ROBOTICS', 'DOMESTIC_ROBOT_ETF', 'ESTATE',
  'GOLD', 'LIQUIDITY', 'OIL', 'SAMSUNG', 'SILVER', 'SK_HYNIX', 'XAG', 'XAU',
]);

function getBrandfetchClientId() {
  return String(window.runtimeConfig?.BRANDFETCH_CLIENT_ID || '').trim();
}

function getBrandfetchLogoUrl(symbol, clientId) {
  return `https://cdn.brandfetch.io/${encodeURIComponent(symbol)}?c=${encodeURIComponent(clientId)}`;
}
```

Update `getCoinLogoUrl` after explicit inline URL handling. Preserve remote explicit URLs through the backend route so its current validation and disk cache remain active:

```js
const hasExplicitRemoteLogo = /^https?:\/\//i.test(trimmedLogoUrl);
if (!hasExplicitRemoteLogo && !BACKEND_LOGO_SYMBOLS.has(normalizedSymbol)) {
  const clientId = getBrandfetchClientId();
  if (clientId) return getBrandfetchLogoUrl(normalizedSymbol, clientId);
}
return `${getApiBaseUrl()}/logos/${encodeURIComponent(normalizedSymbol)}?v=${LOGO_CACHE_VERSION}`;
```

- [ ] **Step 4: Run the logo tests and verify GREEN**

Run: `CI=true npm test -- --runInBand src/utils/coinLogos.test.js`

Expected: all `coinLogos` tests pass.

- [ ] **Step 5: Commit logo resolution**

```bash
git add src/utils/coinLogos.js src/utils/coinLogos.test.js
git commit -m "feat(logo): 自动获取新增标的官方Logo"
```

### Task 3: Deployment Configuration and Documentation

**Files:**
- Modify: `docker-compose.yml`
- Modify: `deploy/docker/docker-compose.prod.yml`
- Modify: `deploy/docker/docker-compose-fixed.yml`
- Modify: `docs/deployment/server-deployment.md`

- [ ] **Step 1: Pass through the environment variable**

Add this environment entry to the dashboard service in all three Compose files:

```yaml
- BRANDFETCH_CLIENT_ID=${BRANDFETCH_CLIENT_ID:-}
```

- [ ] **Step 2: Document setup and behavior**

Add to `docs/deployment/server-deployment.md`:

```markdown
- `BRANDFETCH_CLIENT_ID`: Public Client ID from the Brandfetch Developer Portal. Enables direct browser loading of official logos for newly added symbols. When empty, the dashboard uses its existing backend logo route and SVG fallback.
```

Document that Brandfetch Logo API images load directly in the browser and require a normal browser referrer policy.

- [ ] **Step 3: Validate Compose files**

Run:

```bash
docker compose -f docker-compose.yml config >/dev/null
docker compose -f deploy/docker/docker-compose.prod.yml config >/dev/null
docker compose -f deploy/docker/docker-compose-fixed.yml config >/dev/null
```

Expected: all commands exit 0.

- [ ] **Step 4: Commit deployment configuration**

```bash
git add docker-compose.yml deploy/docker/docker-compose.prod.yml deploy/docker/docker-compose-fixed.yml docs/deployment/server-deployment.md
git commit -m "docs(deploy): 配置Brandfetch Logo服务"
```

### Task 4: Full Verification

**Files:**
- Verify only

- [ ] **Step 1: Run backend focused tests**

Run:

```bash
node server/tests/runtimeConfig.test.js
node server/tests/logoCache.test.js
```

Expected: both scripts print `passed` and exit 0.

- [ ] **Step 2: Run the full frontend suite**

Run: `CI=true npm test -- --runInBand`

Expected: all test suites pass with zero failed tests.

- [ ] **Step 3: Build production assets**

Run: `npm run build`

Expected: exit 0; existing repository ESLint and Browserslist warnings may remain.

- [ ] **Step 4: Verify the final diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only intended files appear as modified or newly created.

- [ ] **Step 5: Configure deployment secret and smoke-test GLW**

Set `BRANDFETCH_CLIENT_ID` in the Tokyo VPS deployment environment, rebuild or redeploy the dashboard, then load `/app-config.js` and confirm it contains a non-empty `BRANDFETCH_CLIENT_ID`. Open the dashboard and verify GLW renders an official Corning logo; temporarily use an invalid symbol and verify the SVG lettermark fallback appears.
