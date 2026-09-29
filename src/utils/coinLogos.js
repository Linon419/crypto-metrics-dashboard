const LOGO_COLORS = [
  ['#f59e0b', '#fef3c7'],
  ['#2563eb', '#dbeafe'],
  ['#16a34a', '#dcfce7'],
  ['#7c3aed', '#ede9fe'],
  ['#dc2626', '#fee2e2'],
  ['#0891b2', '#cffafe'],
  ['#4f46e5', '#e0e7ff'],
  ['#be123c', '#ffe4e6'],
];
const LOGO_CACHE_VERSION = '20260623-new-symbol-logos-v2';
const BACKEND_LOGO_SYMBOLS = new Set([
  'AAOI',
  'AAVE',
  'A_SHARES',
  'A_SHARES_INDEX',
  'ADA',
  'AVAX',
  'BNB',
  'BTC',
  'CEMENT',
  'CIRCLE',
  'CN_AI_ETF',
  'CN_HOG',
  'CN_INDEX',
  'CN_MLCC',
  'CN_PCB',
  'CN_ROBOT',
  'CN_SEMICONDUCTOR',
  'COPP',
  'COPPER',
  'CRV',
  'CU',
  'DOGE',
  'DOMESTIC_AI',
  'DOMESTIC_AI_ETF',
  'DOMESTIC_ROBOTICS',
  'DOMESTIC_ROBOT_ETF',
  'ESTATE',
  'ETH',
  'GOLD',
  'HYPE',
  'LDO',
  'LINK',
  'LIQUIDITY',
  'LTC',
  'NASDAQ',
  'OIL',
  'OND0',
  'PEPE',
  'PUMP',
  'SAMSUNG',
  'SEI',
  'SILVER',
  'SK_HYNIX',
  'SOL',
  'SPCX',
  'SUI',
  'TRUMP',
  'UNI',
  'VEGA',
  'WLD',
  'XAG',
  'XAU',
  'ZEC',
]);

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function hashSymbol(symbol) {
  return normalizeSymbol(symbol)
    .split('')
    .reduce((hash, char) => hash + char.charCodeAt(0), 0);
}

function buildSvgDataUrl(svg) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function getCoinLogoFallbackUrl(symbol) {
  const normalizedSymbol = normalizeSymbol(symbol);
  const displayText = normalizedSymbol.slice(0, 4) || '?';
  const [background, foreground] = LOGO_COLORS[hashSymbol(normalizedSymbol) % LOGO_COLORS.length];
  const fontSize = displayText.length > 3 ? 18 : displayText.length > 2 ? 21 : 24;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="32" fill="${background}"/>
      <circle cx="50" cy="14" r="10" fill="${foreground}" opacity="0.7"/>
      <text x="32" y="38" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff">${displayText}</text>
    </svg>
  `;
  return buildSvgDataUrl(svg);
}

function getApiBaseUrl() {
  if (typeof window !== 'undefined' && window.runtimeConfig?.API_BASE_URL) {
    return String(window.runtimeConfig.API_BASE_URL).replace(/\/$/, '');
  }

  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') {
    return '/api';
  }

  return 'http://localhost:3001/api';
}

function getBrandfetchClientId() {
  if (typeof window === 'undefined') return '';
  return String(window.runtimeConfig?.BRANDFETCH_CLIENT_ID || '').trim();
}

// Logo URL 里可以直接填官网域名（如 anthropic.com）：未上市公司没有股票代码，
// Brandfetch 只能按域名识别
const LOGO_DOMAIN_PATTERN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function parseLogoDomain(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return LOGO_DOMAIN_PATTERN.test(normalized) ? normalized : null;
}

// fallback/404：认不出时返回 404 触发 <img> 的 onError，退回字母头像；
// 不加的话 Brandfetch 会返回一张 200 的空白图，页面上什么都不显示
function getBrandfetchLogoUrl(identifier, clientId) {
  return `https://cdn.brandfetch.io/${encodeURIComponent(identifier)}/fallback/404?c=${encodeURIComponent(clientId)}`;
}

export function getCoinLogoUrl(symbol, explicitLogoUrl) {
  const trimmedLogoUrl = String(explicitLogoUrl || '').trim();
  if (trimmedLogoUrl.startsWith('data:image/') || trimmedLogoUrl.startsWith('blob:')) {
    return trimmedLogoUrl;
  }

  const normalizedSymbol = normalizeSymbol(symbol);
  if (!normalizedSymbol) return getCoinLogoFallbackUrl(symbol);

  const logoDomain = parseLogoDomain(trimmedLogoUrl);
  if (logoDomain) {
    const clientId = getBrandfetchClientId();
    if (clientId) return getBrandfetchLogoUrl(logoDomain, clientId);
  }

  const hasExplicitRemoteLogo = /^https?:\/\//i.test(trimmedLogoUrl);
  if (!hasExplicitRemoteLogo && !BACKEND_LOGO_SYMBOLS.has(normalizedSymbol)) {
    const clientId = getBrandfetchClientId();
    if (clientId) return getBrandfetchLogoUrl(normalizedSymbol, clientId);
  }

  return `${getApiBaseUrl()}/logos/${encodeURIComponent(normalizedSymbol)}?v=${LOGO_CACHE_VERSION}`;
}
