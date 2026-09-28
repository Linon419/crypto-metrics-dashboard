#!/usr/bin/env node
// crypto-metrics 只读取数脚本：给 Claude Code / Codex skill 调用，输出精简 JSON。
// 需要 Node 18+（内置 fetch），无第三方依赖。
//
// 环境变量：
//   CRYPTO_METRICS_URL    看板地址，如 https://metrics.example.com 或 http://127.0.0.1:3001
//   CRYPTO_METRICS_TOKEN  Admin 设置 → Agent 访问 里生成的 cmagent_ 开头的 Token

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const USAGE = `用法: cm.mjs <命令> [参数]

  latest                     最新一期：全部币种指标 + 策略信号 + 流动性 + 期权调参
  signals [--date D]         只看做多/做空信号（默认最新一期）
  date <YYYY-MM-DD>          指定日期的全部币种指标
  coin <SYMBOL> [--days 30]  单币历史指标（以最新有数据日期为终点）
  dates [--limit 30]         有数据的日期列表（新→旧）
  liquidity [--days 14]      资金流动性历史
  volatility                 BTC 实现波动率 vs 隐含波动率
  klines <SYMBOL> [--interval 1d] [--limit 60]   K 线（1h / 4h / 1d）
  notifications [--limit 30] [--unread]           看板通知（新→旧，只读，不会标为已读）`;

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const round = (value, digits = 1) => {
  const number = toNumber(value);
  if (number === null) return null;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
};

function formatPhase(type, day) {
  if (type === 'entry') return `进场第${day}天`;
  if (type === 'exit') return `退场第${day}天`;
  return '中性';
}

// /data/latest 是蛇形字段 + 嵌套 coin，/data/by-date 是驼峰字段，这里统一成一种
export function normalizeCoin(raw = {}) {
  const prev = raw.previous_day_data || raw.previousDayData || null;
  const signal = raw.strategy_signal || raw.strategySignal || null;
  const type = raw.entry_exit_type ?? raw.entryExitType ?? 'neutral';
  const day = toNumber(raw.entry_exit_day ?? raw.entryExitDay) ?? 0;
  const momentum = raw.momentum_indicators ?? raw.momentumIndicators;

  return {
    symbol: raw.coin?.symbol || raw.symbol,
    otc: toNumber(raw.otc_index ?? raw.otcIndex),
    otcChangePct: round(raw.otc_index_change_percent ?? raw.otcChangePercent),
    explosion: toNumber(raw.explosion_index ?? raw.explosionIndex),
    explosionChangePct: round(raw.explosion_index_change_percent ?? raw.explosionChangePercent),
    prevOtc: toNumber(prev?.otc_index ?? prev?.otcIndex),
    prevExplosion: toNumber(prev?.explosion_index ?? prev?.explosionIndex),
    schelling: toNumber(raw.schelling_point ?? raw.schellingPoint),
    phase: formatPhase(type, day),
    periodQuality: raw.period_quality || raw.periodQuality || null,
    nearThreshold: Boolean(raw.near_threshold ?? raw.nearThreshold),
    momentum: Array.isArray(momentum) && momentum.length > 0 ? momentum.join('') : null,
    riskNotes: (raw.risk_notes || raw.riskNotes || []).filter(Boolean),
    signal: signal ? {
      direction: signal.direction || 'neutral',
      label: signal.label || '观望',
      reasons: signal.reasons || [],
      warnings: signal.warnings || [],
    } : null,
  };
}

export function normalizeLiquidity(raw) {
  if (!raw) return null;
  return {
    date: raw.date,
    btc: toNumber(raw.btc_fund_change),
    eth: toNumber(raw.eth_fund_change),
    sol: toNumber(raw.sol_fund_change),
    totalMarket: toNumber(raw.total_market_fund_change),
    comments: raw.comments || null,
    dailyReminder: raw.daily_reminder || null,
  };
}

export function buildSnapshot(payload) {
  const coins = (payload.metrics || payload.coins || [])
    .map(normalizeCoin)
    .sort((left, right) => (right.otc ?? -Infinity) - (left.otc ?? -Infinity));
  return {
    date: payload.date,
    coinCount: coins.length,
    liquidity: normalizeLiquidity(payload.liquidity || payload.liquidityOverview),
    optionTuning: payload.optionTuning || null,
    coins,
  };
}

export function pickSignals(snapshot) {
  const bySide = direction => snapshot.coins
    .filter(coin => coin.signal?.direction === direction)
    .map(coin => ({
      symbol: coin.symbol,
      label: coin.signal.label,
      reasons: coin.signal.reasons,
      warnings: coin.signal.warnings,
      otc: coin.otc,
      explosion: coin.explosion,
      phase: coin.phase,
      periodQuality: coin.periodQuality,
    }));
  return { date: snapshot.date, long: bySide('long'), short: bySide('short') };
}

function shiftDate(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--')) {
      const next = argv[index + 1];
      // 不带值的开关（如 --unread）记为 true
      if (next === undefined || next.startsWith('--')) {
        options[arg.slice(2)] = true;
      } else {
        options[arg.slice(2)] = next;
        index += 1;
      }
    } else {
      positional.push(arg);
    }
  }
  return { command: positional[0], args: positional.slice(1), options };
}

export function createClient({ baseUrl, token, fetchImpl = globalThis.fetch }) {
  if (!baseUrl || !token) {
    throw new Error('缺少环境变量 CRYPTO_METRICS_URL 或 CRYPTO_METRICS_TOKEN');
  }
  const apiBase = `${String(baseUrl).replace(/\/+$/, '').replace(/\/api$/, '')}/api`;

  return async function get(path, params = {}) {
    const url = new URL(`${apiBase}${path}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    });
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!response.ok) {
      const detail = body?.error || body?.message || text || response.statusText;
      throw new Error(`GET ${url.pathname} 失败 (${response.status}): ${detail}`);
    }
    return body;
  };
}

async function newestDate(get) {
  const result = await get('/data/available-dates');
  return result?.newestDate || null;
}

export async function runCommand({ command, args, options }, get) {
  switch (command) {
    case 'latest':
      return buildSnapshot(await get('/data/latest'));

    case 'signals': {
      const payload = options.date
        ? await get(`/data/by-date/${encodeURIComponent(options.date)}`)
        : await get('/data/latest');
      return pickSignals(buildSnapshot(payload));
    }

    case 'date': {
      if (!args[0]) throw new Error('用法: date <YYYY-MM-DD>');
      return buildSnapshot(await get(`/data/by-date/${encodeURIComponent(args[0])}`));
    }

    case 'coin': {
      const symbol = String(args[0] || '').toUpperCase();
      if (!symbol) throw new Error('用法: coin <SYMBOL> [--days 30]');
      const days = Number(options.days) || 30;
      const endDate = await newestDate(get);
      const rows = await get(`/coins/${encodeURIComponent(symbol)}/metrics`, {
        startDate: endDate ? shiftDate(endDate, -(days - 1)) : undefined,
        endDate: endDate || undefined,
      });
      return {
        symbol,
        range: { days, endDate },
        history: (rows || []).map(row => ({
          date: row.date,
          time: row.timestamp || null,
          otc: toNumber(row.otc_index),
          explosion: toNumber(row.explosion_index),
          schelling: toNumber(row.schelling_point),
          phase: formatPhase(row.entry_exit_type, toNumber(row.entry_exit_day) ?? 0),
          periodQuality: row.period_quality || null,
          nearThreshold: Boolean(row.near_threshold),
        })),
      };
    }

    case 'dates': {
      const result = await get('/data/available-dates');
      const limit = Number(options.limit) || 30;
      return {
        newestDate: result?.newestDate,
        oldestDate: result?.oldestDate,
        totalDates: result?.distinctDatesCount,
        dates: (result?.dates || []).slice(0, limit),
      };
    }

    case 'liquidity': {
      const days = Number(options.days) || 14;
      const endDate = await newestDate(get);
      const rows = await get('/liquidity', {
        startDate: endDate ? shiftDate(endDate, -(days - 1)) : undefined,
        endDate: endDate || undefined,
      });
      // 每日提醒很长且逐日重复，历史列表里只保留资金数据和评论
      return (rows || []).map(row => {
        const { dailyReminder, ...rest } = normalizeLiquidity(row);
        return rest;
      });
    }

    case 'volatility': {
      const result = await get('/volatility/btc');
      return result?.data || result;
    }

    case 'klines': {
      const symbol = String(args[0] || '').toUpperCase();
      if (!symbol) throw new Error('用法: klines <SYMBOL> [--interval 1d] [--limit 60]');
      const result = await get(`/coins/${encodeURIComponent(symbol)}/klines`, {
        interval: options.interval || '1d',
        limit: Number(options.limit) || 60,
      });
      return {
        symbol,
        interval: result?.interval,
        market: result?.market,
        klines: (result?.klines || []).map(kline => ({
          openTime: kline.openTime,
          open: kline.open,
          high: kline.high,
          low: kline.low,
          close: kline.close,
          volume: kline.volume,
        })),
      };
    }

    case 'notifications': {
      const result = await get('/notifications', {
        limit: Math.min(Number(options.limit) || 30, 100),
        unreadOnly: options.unread ? 'true' : undefined,
      });
      return {
        unreadCount: result?.unreadCount ?? 0,
        notifications: (result?.notifications || []).map(item => ({
          id: item.id,
          date: item.notificationDate,
          createdAt: item.createdAt,
          category: item.category,
          priority: item.priority,
          coin: item.coinSymbol,
          // 数据摘要涉及多个币种时 coin 为空，完整列表在 metadata.coins
          coins: item.metadata?.coins || (item.coinSymbol ? [item.coinSymbol] : []),
          groups: (item.metadata?.groups || []).map(group => ({
            category: group.category,
            priority: group.priority,
            coins: group.coins,
          })),
          title: item.title,
          content: item.content,
          read: Boolean(item.readAt),
        })),
      };
    }

    default:
      throw new Error(USAGE);
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.command || parsed.command === 'help' || parsed.options.help !== undefined) {
    console.log(USAGE);
    return;
  }
  const get = createClient({
    baseUrl: process.env.CRYPTO_METRICS_URL,
    token: process.env.CRYPTO_METRICS_TOKEN,
  });
  const result = await runCommand(parsed, get);
  console.log(JSON.stringify(result));
}

// skill 目录通常是软链接，比较真实路径才能判断是否被直接执行
const isDirectRun = process.argv[1]
  && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));

if (isDirectRun) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
