# OpenAI Prompt Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Admin settings page that lets admins edit the AI parsing system prompt and user prompt template used by data input parsing.

**Architecture:** Store editable prompt values in a small `AppSettings` table keyed by setting name. Admin APIs read, save, and reset these values. `openaiService` resolves prompts with priority: database setting, environment variable, code default.

**Tech Stack:** React, Ant Design, Express, Sequelize, SQLite, Node assertion tests, React Testing Library.

---

### Task 1: Persistent Prompt Settings

**Files:**
- Create: `server/models/appsetting.js`
- Create: `server/migrations/20260623000001-create-app-settings.js`
- Create: `server/utils/openaiPromptSettings.js`
- Modify: `server/services/openaiService.js`

- [ ] Add `AppSetting` with unique `key` and text `value`.
- [ ] Add helper functions to read, update, reset, validate, and render prompt templates.
- [ ] Update `openaiService` so data parsing uses database prompt settings when present.

### Task 2: Admin API

**Files:**
- Modify: `server/routes/admin.js`
- Modify: `server/tests/klineMappingsAdmin.test.js`
- Create: `server/tests/openaiPromptSettings.test.js`

- [ ] Add `GET /api/admin/openai-prompt-settings`.
- [ ] Add `PUT /api/admin/openai-prompt-settings`.
- [ ] Add `POST /api/admin/openai-prompt-settings/reset`.
- [ ] Add tests for validation, persistence, and reset.

### Task 3: Admin UI

**Files:**
- Create: `src/components/PromptSettings.jsx`
- Create: `src/components/__tests__/PromptSettings.test.jsx`
- Modify: `src/components/AdminSettings.jsx`
- Modify: `src/services/api.js`

- [ ] Add API client functions.
- [ ] Add an Admin tab named `AI解析 Prompt`.
- [ ] Add editable textareas, save, refresh, and restore-default actions.
- [ ] Add a component test covering load and save.

### Task 4: Verification

**Commands:**
- `node server/tests/openaiPromptSettings.test.js`
- `node server/tests/openaiMomentumSource.test.js`
- `node server/tests/klineMappingsAdmin.test.js`
- `npm test -- --runTestsByPath src/components/__tests__/PromptSettings.test.jsx --watchAll=false`
- `npm run build`

