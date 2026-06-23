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

export function getCoinLogoUrl(symbol, explicitLogoUrl) {
  const trimmedLogoUrl = String(explicitLogoUrl || '').trim();
  if (trimmedLogoUrl.startsWith('data:image/') || trimmedLogoUrl.startsWith('blob:')) {
    return trimmedLogoUrl;
  }

  const normalizedSymbol = normalizeSymbol(symbol);
  if (!normalizedSymbol) return getCoinLogoFallbackUrl(symbol);

  return `${getApiBaseUrl()}/logos/${encodeURIComponent(normalizedSymbol)}?v=${LOGO_CACHE_VERSION}`;
}
