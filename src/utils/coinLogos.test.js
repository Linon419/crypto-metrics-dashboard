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

  test('uses Brandfetch auto-detection for a newly added stock symbol', () => {
    window.runtimeConfig = { BRANDFETCH_CLIENT_ID: 'client-123' };

    // fallback/404：Brandfetch 认不出时返回 404，<img> 的 onError 才会退回字母头像，
    // 否则会得到一张 200 的空白图，页面上什么都不显示
    expect(getCoinLogoUrl('GLW')).toBe('https://cdn.brandfetch.io/GLW/fallback/404?c=client-123');
  });

  test('looks up Brandfetch by official domain when one is configured', () => {
    window.runtimeConfig = { BRANDFETCH_CLIENT_ID: 'client-123' };

    expect(getCoinLogoUrl('ANTHROPIC', 'anthropic.com'))
      .toBe('https://cdn.brandfetch.io/anthropic.com/fallback/404?c=client-123');
    expect(getCoinLogoUrl('OPENAI', ' OpenAI.com '))
      .toBe('https://cdn.brandfetch.io/openai.com/fallback/404?c=client-123');
    // 内置标的填了域名也以域名为准
    expect(getCoinLogoUrl('BTC', 'bitcoin.org'))
      .toBe('https://cdn.brandfetch.io/bitcoin.org/fallback/404?c=client-123');
  });

  test('sends configured domains to the backend when Brandfetch is unconfigured', () => {
    window.runtimeConfig = {};

    expect(getCoinLogoUrl('ANTHROPIC', 'anthropic.com')).toContain('/api/logos/ANTHROPIC');
  });

  test('does not treat arbitrary text as a domain', () => {
    window.runtimeConfig = { BRANDFETCH_CLIENT_ID: 'client-123' };

    expect(getCoinLogoUrl('GLW', 'not a domain'))
      .toBe('https://cdn.brandfetch.io/GLW/fallback/404?c=client-123');
  });

  test('keeps backend artwork for special assets', () => {
    window.runtimeConfig = { BRANDFETCH_CLIENT_ID: 'client-123' };

    expect(getCoinLogoUrl('GOLD')).toContain('/api/logos/GOLD');
    expect(getCoinLogoUrl('CN_HOG')).toContain('/api/logos/CN_HOG');
  });

  test.each(['PUMP', 'SUI', 'ETH', 'BTC', 'SOL', 'NASDAQ', 'CIRCLE', 'SPCX', 'CN_PCB'])(
    'keeps authoritative backend resolution for %s',
    symbol => {
      window.runtimeConfig = { BRANDFETCH_CLIENT_ID: 'client-123' };

      expect(getCoinLogoUrl(symbol)).toContain(`/api/logos/${symbol}`);
    }
  );

  test('keeps backend resolution when Brandfetch is unconfigured', () => {
    window.runtimeConfig = {};

    expect(getCoinLogoUrl('GLW')).toContain('/api/logos/GLW');
  });

  test('keeps manually configured remote logos on the backend route', () => {
    window.runtimeConfig = { BRANDFETCH_CLIENT_ID: 'client-123' };

    expect(getCoinLogoUrl('GLW', 'https://example.com/glw.png')).toContain('/api/logos/GLW');
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
