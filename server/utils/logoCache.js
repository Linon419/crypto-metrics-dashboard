const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const CRYPTO_ICON_BASE = 'https://assets.coincap.io/assets/icons';
const MAX_LOGO_BYTES = 512 * 1024;

const DOMAIN_LOGO_HOSTS = {
  AAPL: 'apple.com',
  AMZN: 'amazon.com',
  AXTI: 'axt.com',
  BABA: 'alibaba.com',
  CIRCLE: 'circle.com',
  COIN: 'coinbase.com',
  GOOG: 'google.com',
  HOOD: 'robinhood.com',
  MSFT: 'microsoft.com',
  MU: 'micron.com',
  NASDAQ: 'nasdaq.com',
  NASDAO: 'nasdaq.com',
  NVDA: 'nvidia.com',
  ORCL: 'oracle.com',
  PLTR: 'palantir.com',
  SNDK: 'sandisk.com',
  TSLA: 'tesla.com',
};

const BRAND_LOGO_TYPES = {
  AAOI: 'aaoi',
};

const COMMODITY_LOGO_TYPES = {
  COPP: 'copper',
  COPPER: 'copper',
  GOLD: 'gold',
  OIL: 'oil',
  SILVER: 'silver',
  XAG: 'silver',
  XAU: 'gold',
};

const THEMATIC_LOGO_TYPES = {
  ESTATE: 'house',
  地产: 'house',
};

const FALLBACK_LOGO_SYMBOLS = new Set([
  'A_SHARES',
  'A_SHARES_INDEX',
  'CEMENT',
  'CN_AI_ETF',
  'CN_INDEX',
  'CN_ROBOT',
  'DOMESTIC_AI',
  'DOMESTIC_AI_ETF',
  'DOMESTIC_ROBOTICS',
  'DOMESTIC_ROBOT_ETF',
  'LIQUIDITY',
]);

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

const CONTENT_TYPE_EXTENSIONS = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
};

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function hashSymbol(symbol) {
  return normalizeSymbol(symbol)
    .split('')
    .reduce((hash, char) => hash + char.charCodeAt(0), 0);
}

function sanitizeCacheKey(symbol) {
  return normalizeSymbol(symbol).replace(/[^A-Z0-9_\u4e00-\u9fff-]/g, '_').slice(0, 80) || 'UNKNOWN';
}

function getDefaultLogoCacheDir() {
  if (process.env.LOGO_CACHE_DIR) return process.env.LOGO_CACHE_DIR;
  if (process.env.DB_STORAGE && process.env.DB_STORAGE !== ':memory:') {
    return path.join(path.dirname(process.env.DB_STORAGE), 'logos');
  }
  return path.resolve(process.cwd(), 'data', 'logos');
}

function createSvgResponse(svg, source) {
  return {
    body: Buffer.from(svg.trim(), 'utf8'),
    cacheHit: true,
    contentType: 'image/svg+xml; charset=utf-8',
    extension: 'svg',
    source,
  };
}

function buildFallbackLogoSvg(symbol) {
  const normalizedSymbol = normalizeSymbol(symbol);
  const displayText = normalizedSymbol.slice(0, 4) || '?';
  const [background, foreground] = LOGO_COLORS[hashSymbol(normalizedSymbol) % LOGO_COLORS.length];
  const fontSize = displayText.length > 3 ? 18 : displayText.length > 2 ? 21 : 24;
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="32" fill="${background}"/>
      <circle cx="50" cy="14" r="10" fill="${foreground}" opacity="0.7"/>
      <text x="32" y="38" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff">${displayText}</text>
    </svg>
  `;
}

function buildCommodityLogoSvg(type) {
  const commodityLogos = {
    gold: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <defs>
          <linearGradient id="gold-bg" x1="14" y1="8" x2="52" y2="58">
            <stop offset="0" stop-color="#fff7ad"/>
            <stop offset="0.48" stop-color="#f5b301"/>
            <stop offset="1" stop-color="#a16207"/>
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="32" fill="url(#gold-bg)"/>
        <rect x="13" y="34" width="18" height="12" rx="3" fill="#ffe08a" stroke="#92400e" stroke-width="2"/>
        <rect x="33" y="34" width="18" height="12" rx="3" fill="#ffd44d" stroke="#92400e" stroke-width="2"/>
        <rect x="23" y="21" width="18" height="12" rx="3" fill="#fff1a8" stroke="#92400e" stroke-width="2"/>
      </svg>
    `,
    silver: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <defs>
          <linearGradient id="silver-bg" x1="12" y1="8" x2="52" y2="58">
            <stop offset="0" stop-color="#ffffff"/>
            <stop offset="0.48" stop-color="#cbd5e1"/>
            <stop offset="1" stop-color="#64748b"/>
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="32" fill="url(#silver-bg)"/>
        <rect x="12" y="32" width="40" height="10" rx="4" fill="#f8fafc" stroke="#64748b" stroke-width="2"/>
        <rect x="17" y="21" width="30" height="10" rx="4" fill="#e2e8f0" stroke="#64748b" stroke-width="2"/>
        <path d="M20 24h24M16 35h32" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"/>
      </svg>
    `,
    copper: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <defs>
          <linearGradient id="copper-bg" x1="11" y1="7" x2="53" y2="58">
            <stop offset="0" stop-color="#fed7aa"/>
            <stop offset="0.48" stop-color="#c2410c"/>
            <stop offset="1" stop-color="#7c2d12"/>
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="32" fill="url(#copper-bg)"/>
        <circle cx="32" cy="30" r="16" fill="none" stroke="#fff7ed" stroke-width="6"/>
        <path d="M32 46v9M22 55h20" stroke="#fff7ed" stroke-width="6" stroke-linecap="round"/>
        <circle cx="46" cy="14" r="7" fill="#fdba74" opacity="0.75"/>
      </svg>
    `,
    oil: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <defs>
          <linearGradient id="oil-bg" x1="12" y1="8" x2="52" y2="58">
            <stop offset="0" stop-color="#334155"/>
            <stop offset="0.5" stop-color="#111827"/>
            <stop offset="1" stop-color="#020617"/>
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="32" fill="url(#oil-bg)"/>
        <path d="M32 10c9 12 17 22 17 33 0 9-7 15-17 15s-17-6-17-15c0-11 8-21 17-33z" fill="#f8fafc"/>
        <path d="M32 19c6 9 10 15 10 22 0 6-4 10-10 10s-10-4-10-10c0-7 4-13 10-22z" fill="#111827"/>
      </svg>
    `,
  };

  return commodityLogos[type] || null;
}

function buildThematicLogoSvg(type) {
  const thematicLogos = {
    house: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <defs>
          <linearGradient id="house-bg" x1="12" y1="8" x2="54" y2="58">
            <stop offset="0" stop-color="#e0f2fe"/>
            <stop offset="0.52" stop-color="#2563eb"/>
            <stop offset="1" stop-color="#1e3a8a"/>
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="32" fill="url(#house-bg)"/>
        <path d="M15 31.5 32 17l17 14.5" fill="none" stroke="#eff6ff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M20 30v18h24V30" fill="#eff6ff" stroke="#1e3a8a" stroke-width="2" stroke-linejoin="round"/>
        <path d="M28 48V36h8v12" fill="#bfdbfe" stroke="#1e3a8a" stroke-width="2"/>
        <rect x="36" y="34" width="5" height="5" rx="1" fill="#60a5fa"/>
      </svg>
    `,
  };

  return thematicLogos[type] || null;
}

function buildBrandLogoSvg(type) {
  const brandLogos = {
    aaoi: `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <defs>
          <linearGradient id="aaoi-official-bg" x1="10" y1="8" x2="54" y2="56">
            <stop offset="0" stop-color="#0f172a"/>
            <stop offset="0.52" stop-color="#164e63"/>
            <stop offset="1" stop-color="#0f766e"/>
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="32" fill="url(#aaoi-official-bg)"/>
        <g transform="translate(8 18) scale(6.6)">
          <path d="m4.70128,3.28146c-.05126-.02399-.10773-.01716-.16151-.02591-.28559-.04647-.53562-.1618-.74027-.36933-.01075-.0109-.02247-.02092-.0344-.03053-.0048-.00386-.01138-.00551-.01722-.00819-.0184.01408-.00626.028-.00101.04067.03354.08097.06807.16153.10127.24264.008.01954.02281.03801.01618.06186-.01939.01565-.04213.01005-.06324.01009-.25892.00044-.51784-.00092-.77674.00135-.04917.00043-.07334-.01656-.09305-.06114-.2693-.6093-.54036-1.21781-.81136-1.82635-.0113-.02538-.01888-.05351-.04049-.07414-.03291.03813-.44779.98079-.47395,1.0753.01974.02401.04796.01544.07269.01563.17114.00135.34229.00136.51344.00217.02342.00011.04744-.00309.0693.00461.00592.02464-.00743.0414-.01502.05882-.10766.24708-.21754.49321-.32299.74122-.02058.04841-.04606.06415-.09768.06395-.4915-.00185-.983-.00104-1.47451-.00132-.02138-.00001-.04382.00461-.06379-.00787.00843-.04898,1.30689-3.00289,1.36598-3.10653h.84455c.31837.70523.63769,1.41257.95786,2.12179.02646-.01612.01679-.03243.01585-.04609-.01599-.23402-.03848-.46779-.02942-.70282.00832-.21567.04087-.42749.10893-.63272.11388-.3434.33896-.58625.67583-.71698.39066-.1516.78553-.14769,1.17508.00522.34185.13419.56508.38345.67623.73283.0219.06885.03961.13902.06098.20805.00477.01542.00213.0352.0291.05352.00037-.11833.00088-.22881.00101-.33928.00013-.11185-.00022-.22371-.00017-.33556.00004-.11112-.00043-.22227.00042-.33663h.80918c.02201.02242.01636.04777.01637.07109.00031.99352.00029,1.98704.00009,2.98056,0,.02151.00369.044-.01252.06853h-.80057c-.0056-.16644-.00321-.33426-.00724-.50184-.00406-.1684-.00673-.33684-.02054-.50676-.00577.02215-.01243.04412-.01717.06649-.10196.4804-.399.78203-.85852.93298-.09376.0308-.19118.04815-.29.05548-.0218.00162-.04403.00197-.0631.01518h-.22386Zm-.35834-1.63233c0,.05042-.00268.10101.00054.15122.00757.11831.02331.23541.06628.34714.02501.06503.06246.12092.12197.15905.1372.08793.28524.11102.44045.06144.15539-.04964.23658-.16781.27071-.3205.05176-.23151.05122-.46538.0213-.6996-.01-.0783-.0278-.15496-.0584-.22845-.03555-.08538-.09566-.14586-.17969-.18272-.15023-.0659-.29893-.05349-.44606.01092-.07134.03123-.12258.08333-.15607.15321-.01901.03966-.03293.08108-.04269.12398-.03179.1397-.04212.28144-.03834.4243Z" fill="#fff"/>
          <rect y="3.33634" width="7.28228" height=".15465" fill="#fff"/>
        </g>
      </svg>
    `,
  };

  return brandLogos[type] || null;
}

function getInlineLogoResponse(symbol) {
  const normalizedSymbol = normalizeSymbol(symbol);
  const brandType = BRAND_LOGO_TYPES[normalizedSymbol];
  if (brandType) {
    return createSvgResponse(buildBrandLogoSvg(brandType), 'inline');
  }

  const commodityType = COMMODITY_LOGO_TYPES[normalizedSymbol];
  if (commodityType) {
    return createSvgResponse(buildCommodityLogoSvg(commodityType), 'inline');
  }

  const thematicType = THEMATIC_LOGO_TYPES[normalizedSymbol];
  if (thematicType) {
    return createSvgResponse(buildThematicLogoSvg(thematicType), 'inline');
  }

  if (FALLBACK_LOGO_SYMBOLS.has(normalizedSymbol)) {
    return createSvgResponse(buildFallbackLogoSvg(normalizedSymbol), 'fallback');
  }

  return null;
}

function getRemoteLogoUrl(symbol, explicitLogoUrl) {
  const trimmedLogoUrl = String(explicitLogoUrl || '').trim();
  if (/^https?:\/\//i.test(trimmedLogoUrl)) return trimmedLogoUrl;

  const normalizedSymbol = normalizeSymbol(symbol);
  const domain = DOMAIN_LOGO_HOSTS[normalizedSymbol];
  if (domain) return `https://icons.duckduckgo.com/ip3/${domain}.ico`;

  return `${CRYPTO_ICON_BASE}/${normalizedSymbol.toLowerCase()}@2x.png`;
}

function normalizeContentType(contentType) {
  const normalized = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (normalized === 'image/jpg') return 'image/jpeg';
  return normalized;
}

function extensionForContentType(contentType, url) {
  const normalized = normalizeContentType(contentType);
  if (CONTENT_TYPE_EXTENSIONS[normalized]) return CONTENT_TYPE_EXTENSIONS[normalized];

  const pathname = new URL(url).pathname;
  const ext = path.extname(pathname).replace('.', '').toLowerCase();
  if (['gif', 'ico', 'jpg', 'jpeg', 'png', 'svg', 'webp'].includes(ext)) {
    return ext === 'jpeg' ? 'jpg' : ext;
  }
  return 'bin';
}

function buildRemoteCacheKey(symbol, url) {
  const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 12);
  return `${sanitizeCacheKey(symbol)}-${hash}`;
}

async function readCachedLogo(cacheDir, cacheKey) {
  try {
    const metaPath = path.join(cacheDir, `${cacheKey}.json`);
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
    const filePath = path.join(cacheDir, meta.fileName);
    const body = await fs.readFile(filePath);
    return {
      body,
      cacheHit: true,
      contentType: meta.contentType,
      extension: meta.extension,
      filePath,
      source: 'disk',
    };
  } catch (error) {
    return null;
  }
}

async function writeCachedLogo(cacheDir, cacheKey, payload) {
  await fs.mkdir(cacheDir, { recursive: true });
  const fileName = `${cacheKey}.${payload.extension}`;
  const filePath = path.join(cacheDir, fileName);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const metaPath = path.join(cacheDir, `${cacheKey}.json`);

  await fs.writeFile(tempPath, payload.body);
  await fs.rename(tempPath, filePath);
  await fs.writeFile(metaPath, JSON.stringify({
    cachedAt: new Date().toISOString(),
    contentType: payload.contentType,
    extension: payload.extension,
    fileName,
    sourceUrl: payload.url,
  }, null, 2));

  return filePath;
}

async function downloadRemoteLogo(url, httpClient = axios) {
  const response = await httpClient.get(url, {
    maxContentLength: MAX_LOGO_BYTES,
    responseType: 'arraybuffer',
    timeout: 10000,
    headers: {
      'user-agent': 'crypto-metrics-dashboard-logo-cache/1.0',
    },
    validateStatus: (status) => status >= 200 && status < 300,
  });

  const body = Buffer.from(response.data);
  if (body.length > MAX_LOGO_BYTES) {
    throw new Error(`Logo response too large: ${body.length} bytes`);
  }

  const contentType = normalizeContentType(response.headers?.['content-type']);
  if (!contentType.startsWith('image/')) {
    throw new Error(`Unsupported logo content type: ${contentType || 'unknown'}`);
  }

  return {
    body,
    cacheHit: false,
    contentType,
    extension: extensionForContentType(contentType, url),
    source: 'remote',
    url,
  };
}

async function getLogoResponse(symbol, {
  cacheDir = getDefaultLogoCacheDir(),
  explicitLogoUrl = null,
  forceRefresh = false,
  httpClient = axios,
} = {}) {
  const normalizedSymbol = normalizeSymbol(symbol);
  if (!normalizedSymbol) {
    return createSvgResponse(buildFallbackLogoSvg(symbol), 'fallback');
  }

  const inlineLogo = getInlineLogoResponse(normalizedSymbol);
  if (inlineLogo) return inlineLogo;

  const url = getRemoteLogoUrl(normalizedSymbol, explicitLogoUrl);
  const cacheKey = buildRemoteCacheKey(normalizedSymbol, url);

  if (!forceRefresh) {
    const cached = await readCachedLogo(cacheDir, cacheKey);
    if (cached) return cached;
  }

  try {
    const downloaded = await downloadRemoteLogo(url, httpClient);
    const filePath = await writeCachedLogo(cacheDir, cacheKey, downloaded);
    return {
      ...downloaded,
      filePath,
    };
  } catch (error) {
    return {
      ...createSvgResponse(buildFallbackLogoSvg(normalizedSymbol), 'fallback'),
      error,
    };
  }
}

module.exports = {
  buildFallbackLogoSvg,
  getDefaultLogoCacheDir,
  getLogoResponse,
  getRemoteLogoUrl,
  normalizeSymbol,
};
