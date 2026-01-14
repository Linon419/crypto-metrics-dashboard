// server/routes/mcpGateway.js
// MCP Gateway：通过 HTTP(JSON-RPC 2.0) 暴露 tools/list 与 tools/call，把调用转发到现有 REST API
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const router = express.Router();

function nowMs() {
  return Date.now();
}

function newSessionId() {
  return crypto.randomUUID();
}

function toTextResult(text) {
  return { content: [{ type: 'text', text: String(text) }] };
}

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message, data) {
  const err = { code, message };
  if (data !== undefined) err.data = data;
  return { jsonrpc: '2.0', id, error: err };
}

function requireGatewayAuth(req) {
  const expected = process.env.MCP_GATEWAY_TOKEN;
  if (!expected) {
    return {
      ok: false,
      status: 500,
      message: '服务器未配置 MCP_GATEWAY_TOKEN，已拒绝请求',
    };
  }
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!token || token !== expected) {
    return { ok: false, status: 401, message: '未授权：MCP Gateway Token 无效' };
  }
  return { ok: true };
}

// 基于 Mcp-Session-Id 维护“后端 JWT Token”会话，避免把网关鉴权头误当作后端鉴权头
const sessions = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 分钟

function getOrCreateSession(req, res) {
  const headerName = 'Mcp-Session-Id';
  let sessionId = req.header(headerName);
  if (!sessionId) {
    sessionId = newSessionId();
    res.setHeader(headerName, sessionId);
  }

  const existing = sessions.get(sessionId);
  const session = existing || { id: sessionId, createdAt: nowMs(), lastSeenAt: nowMs(), backendAuth: null };
  session.lastSeenAt = nowMs();
  sessions.set(sessionId, session);

  return session;
}

function pruneSessions() {
  const cutoff = nowMs() - SESSION_TTL_MS;
  for (const [id, s] of sessions.entries()) {
    if (!s.lastSeenAt || s.lastSeenAt < cutoff) sessions.delete(id);
  }
}

function getApiBaseUrl() {
  // 优先显式配置；否则默认指向本机同端口后端 API
  if (process.env.CRYPTO_API_BASE_URL) return process.env.CRYPTO_API_BASE_URL.replace(/\/$/, '');
  const port = process.env.PORT || '3001';
  return `http://127.0.0.1:${port}/api`;
}

function getProtocolVersion(req) {
  return req.header('mcp-protocol-version') || '2024-11-05';
}

const tools = {
  auth_login: {
    description: '用户登录获取 JWT（并写入当前 MCP 会话）',
    inputSchema: {
      type: 'object',
      properties: {
        username: { type: 'string' },
        password: { type: 'string' },
      },
      required: ['username', 'password'],
    },
    handler: async ({ args, session }) => {
      const api = axios.create({ baseURL: getApiBaseUrl(), timeout: 30000 });
      const response = await api.post('/auth/login', {
        username: args.username,
        password: args.password,
      });
      const token = response?.data?.token;
      if (token) {
        session.backendAuth = `Bearer ${token}`;
      }
      return response.data;
    },
  },
  auth_register: {
    description: '用户注册（若后端返回 token 同样写入当前 MCP 会话）',
    inputSchema: {
      type: 'object',
      properties: {
        username: { type: 'string' },
        password: { type: 'string' },
        email: { type: 'string' },
      },
      required: ['username', 'password', 'email'],
    },
    handler: async ({ args, session }) => {
      const api = axios.create({ baseURL: getApiBaseUrl(), timeout: 30000 });
      const response = await api.post('/auth/register', {
        username: args.username,
        password: args.password,
        email: args.email,
      });
      const token = response?.data?.token;
      if (token) {
        session.backendAuth = `Bearer ${token}`;
      }
      return response.data;
    },
  },
  auth_verify: {
    description: '验证 JWT（优先使用入参 token，其次使用当前 MCP 会话 token）',
    inputSchema: {
      type: 'object',
      properties: { token: { type: 'string' } },
      required: [],
    },
    handler: async ({ args, session }) => {
      const api = axios.create({ baseURL: getApiBaseUrl(), timeout: 30000 });
      const auth = args.token ? `Bearer ${args.token}` : session.backendAuth;
      const response = await api.get('/auth/verify', {
        headers: auth ? { Authorization: auth } : {},
      });
      return response.data;
    },
  },
  auth_change_password: {
    description: '修改密码（优先使用入参 token，其次使用当前 MCP 会话 token）',
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string' },
        currentPassword: { type: 'string' },
        newPassword: { type: 'string' },
        userId: { type: 'number' },
      },
      required: ['currentPassword', 'newPassword', 'userId'],
    },
    handler: async ({ args, session }) => {
      const api = axios.create({ baseURL: getApiBaseUrl(), timeout: 30000 });
      const auth = args.token ? `Bearer ${args.token}` : session.backendAuth;
      const response = await api.put(
        '/auth/change-password',
        {
          currentPassword: args.currentPassword,
          newPassword: args.newPassword,
          userId: args.userId,
        },
        { headers: auth ? { Authorization: auth } : {} }
      );
      return response.data;
    },
  },
  get_latest_data: {
    description: '获取最新指标数据',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: async () => {
      const api = axios.create({ baseURL: getApiBaseUrl(), timeout: 30000 });
      const response = await api.get('/data/latest');
      return response.data;
    },
  },
  get_historical_data: {
    description: '按日期获取历史数据（YYYY-MM-DD）',
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string' } },
      required: ['date'],
    },
    handler: async ({ args }) => {
      const api = axios.create({ baseURL: getApiBaseUrl(), timeout: 30000 });
      const response = await api.get(`/data/by-date/${encodeURIComponent(args.date)}`);
      return response.data;
    },
  },
  get_dashboard_data: {
    description: '获取仪表盘数据（可选 date=YYYY-MM-DD）',
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string' } },
      required: [],
    },
    handler: async ({ args }) => {
      const api = axios.create({ baseURL: getApiBaseUrl(), timeout: 30000 });
      const response = await api.get('/dashboard', { params: args.date ? { date: args.date } : {} });
      return response.data;
    },
  },
  get_coins: {
    description: '获取币种列表',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: async () => {
      const api = axios.create({ baseURL: getApiBaseUrl(), timeout: 30000 });
      const response = await api.get('/coins');
      return response.data;
    },
  },
  get_coin_by_symbol: {
    description: '根据 symbol 获取单个币种',
    inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
    handler: async ({ args }) => {
      const api = axios.create({ baseURL: getApiBaseUrl(), timeout: 30000 });
      const response = await api.get(`/coins/${encodeURIComponent(args.symbol)}`);
      return response.data;
    },
  },
  get_coin_metrics: {
    description: '获取币种历史指标（可选 startDate/endDate）',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string' },
        startDate: { type: 'string' },
        endDate: { type: 'string' },
      },
      required: ['symbol'],
    },
    handler: async ({ args }) => {
      const api = axios.create({ baseURL: getApiBaseUrl(), timeout: 30000 });
      const response = await api.get(`/coins/${encodeURIComponent(args.symbol)}/metrics`, {
        params: {
          ...(args.startDate ? { startDate: args.startDate } : {}),
          ...(args.endDate ? { endDate: args.endDate } : {}),
        },
      });
      return response.data;
    },
  },
  get_liquidity_data: {
    description: '获取流动性概览（可选 date）',
    inputSchema: { type: 'object', properties: { date: { type: 'string' } }, required: [] },
    handler: async ({ args }) => {
      const api = axios.create({ baseURL: getApiBaseUrl(), timeout: 30000 });
      const response = await api.get('/liquidity', { params: args.date ? { date: args.date } : {} });
      return response.data;
    },
  },
  get_liquidity_by_date: {
    description: '获取指定日期流动性概览（YYYY-MM-DD）',
    inputSchema: { type: 'object', properties: { date: { type: 'string' } }, required: ['date'] },
    handler: async ({ args }) => {
      const api = axios.create({ baseURL: getApiBaseUrl(), timeout: 30000 });
      const response = await api.get(`/liquidity/${encodeURIComponent(args.date)}`);
      return response.data;
    },
  },
  get_favorites: {
    description: '获取收藏列表（需要先 auth_login 或传 token）',
    inputSchema: { type: 'object', properties: { token: { type: 'string' } }, required: [] },
    handler: async ({ args, session }) => {
      const api = axios.create({ baseURL: getApiBaseUrl(), timeout: 30000 });
      const auth = args.token ? `Bearer ${args.token}` : session.backendAuth;
      const response = await api.get('/favorites', { headers: auth ? { Authorization: auth } : {} });
      return response.data;
    },
  },
  add_favorite: {
    description: '添加收藏（需要先 auth_login 或传 token）',
    inputSchema: {
      type: 'object',
      properties: { token: { type: 'string' }, symbol: { type: 'string' } },
      required: ['symbol'],
    },
    handler: async ({ args, session }) => {
      const api = axios.create({ baseURL: getApiBaseUrl(), timeout: 30000 });
      const auth = args.token ? `Bearer ${args.token}` : session.backendAuth;
      const response = await api.post(
        '/favorites',
        { symbol: args.symbol },
        { headers: auth ? { Authorization: auth } : {} }
      );
      return response.data;
    },
  },
  remove_favorite: {
    description: '删除收藏（需要先 auth_login 或传 token）',
    inputSchema: {
      type: 'object',
      properties: { token: { type: 'string' }, symbol: { type: 'string' } },
      required: ['symbol'],
    },
    handler: async ({ args, session }) => {
      const api = axios.create({ baseURL: getApiBaseUrl(), timeout: 30000 });
      const auth = args.token ? `Bearer ${args.token}` : session.backendAuth;
      const response = await api.delete(`/favorites/${encodeURIComponent(args.symbol)}`, {
        headers: auth ? { Authorization: auth } : {},
      });
      return response.data;
    },
  },
  get_db_status: {
    description: '获取数据库状态（需要后端鉴权，建议先 auth_login）',
    inputSchema: { type: 'object', properties: { token: { type: 'string' } }, required: [] },
    handler: async ({ args, session }) => {
      const api = axios.create({ baseURL: getApiBaseUrl(), timeout: 30000 });
      const auth = args.token ? `Bearer ${args.token}` : session.backendAuth;
      const response = await api.get('/debug/db-status', { headers: auth ? { Authorization: auth } : {} });
      return response.data;
    },
  },
  get_date_range: {
    description: '获取数据库日期范围（需要后端鉴权，建议先 auth_login）',
    inputSchema: { type: 'object', properties: { token: { type: 'string' } }, required: [] },
    handler: async ({ args, session }) => {
      const api = axios.create({ baseURL: getApiBaseUrl(), timeout: 30000 });
      const auth = args.token ? `Bearer ${args.token}` : session.backendAuth;
      const response = await api.get('/data/debug/date-range', { headers: auth ? { Authorization: auth } : {} });
      return response.data;
    },
  },
};

function listTools() {
  return Object.entries(tools).map(([name, def]) => ({
    name,
    description: def.description,
    inputSchema: def.inputSchema,
  }));
}

router.post('/mcp', async (req, res) => {
  pruneSessions();

  // 让浏览器/代理能读到会话与协议头
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, mcp-protocol-version');

  const rpcId = (req.body && Object.prototype.hasOwnProperty.call(req.body, 'id')) ? req.body.id : null;

  const auth = requireGatewayAuth(req);
  if (!auth.ok) {
    return res.status(auth.status).json(jsonRpcError(rpcId, -32001, auth.message));
  }

  const session = getOrCreateSession(req, res);
  res.setHeader('mcp-protocol-version', getProtocolVersion(req));

  const { id, method, params } = req.body || {};
  if (!method) {
    return res.status(400).json(jsonRpcError(id ?? null, -32600, 'Invalid Request: missing method'));
  }

  try {
    if (method === 'initialize') {
      return res.json(
        jsonRpcResult(id ?? null, {
          protocolVersion: getProtocolVersion(req),
          serverInfo: { name: 'crypto-metrics-mcp-gateway', version: '0.1.0' },
          capabilities: { tools: {} },
        })
      );
    }

    if (method === 'ping') {
      return res.json(jsonRpcResult(id ?? null, {}));
    }

    if (method === 'tools/list') {
      return res.json(jsonRpcResult(id ?? null, { tools: listTools() }));
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const args = params?.arguments || {};
      if (!toolName || typeof toolName !== 'string') {
        return res.json(jsonRpcError(id ?? null, -32602, 'Invalid params: missing tool name'));
      }
      const tool = tools[toolName];
      if (!tool) {
        return res.json(jsonRpcError(id ?? null, -32601, `Tool not found: ${toolName}`));
      }

      const data = await tool.handler({ args, session });
      return res.json(jsonRpcResult(id ?? null, toTextResult(JSON.stringify(data, null, 2))));
    }

    return res.json(jsonRpcError(id ?? null, -32601, `Method not found: ${method}`));
  } catch (error) {
    const status = error?.response?.status;
    const details = error?.response?.data || error?.message || String(error);
    const code = status ? -32000 : -32603;
    return res.json(jsonRpcError(id ?? null, code, 'Tool execution failed', details));
  }
});

module.exports = router;
