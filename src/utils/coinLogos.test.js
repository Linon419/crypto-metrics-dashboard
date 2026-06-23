import { getCoinLogoFallbackUrl, getCoinLogoUrl } from './coinLogos';

describe('coinLogos', () => {
  afterEach(() => {
    delete window.runtimeConfig;
  });

  test('uses backend logo cache route by default', () => {
    expect(getCoinLogoUrl('BTC')).toBe('http://localhost:3001/api/logos/BTC?v=20260623-new-symbol-logos-v2');
    expect(getCoinLogoUrl('pltr')).toBe('http://localhost:3001/api/logos/PLTR?v=20260623-new-symbol-logos-v2');
  });

  test('uses runtime API base URL when configured', () => {
    window.runtimeConfig = { API_BASE_URL: 'https://example.com/custom-api/' };

    expect(getCoinLogoUrl('ETH')).toBe('https://example.com/custom-api/logos/ETH?v=20260623-new-symbol-logos-v2');
  });

  test('keeps data and blob logo URLs inline', () => {
    expect(getCoinLogoUrl('BTC', 'data:image/svg+xml;utf8,abc')).toBe('data:image/svg+xml;utf8,abc');
    expect(getCoinLogoUrl('BTC', 'blob:http://localhost/logo')).toBe('blob:http://localhost/logo');
  });

  test('creates stable SVG fallback logos for synthetic symbols', () => {
    const fallbackUrl = getCoinLogoFallbackUrl('CN_AI_ETF');

    expect(fallbackUrl).toMatch(/^data:image\/svg\+xml;utf8,/);
    expect(fallbackUrl).toContain(encodeURIComponent('CN_A'));
  });
});
