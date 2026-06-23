const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  getLogoResponse,
  getRemoteLogoUrl,
} = require('../utils/logoCache');

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'logo-cache-test-'));

  try {
    assert.strictEqual(
      getRemoteLogoUrl('AAPL'),
      'https://icons.duckduckgo.com/ip3/apple.com.ico'
    );
    assert.strictEqual(
      getRemoteLogoUrl('BTC'),
      'https://assets.coincap.io/assets/icons/btc@2x.png'
    );

    const aaoiLogo = await getLogoResponse('AAOI', { cacheDir: tempDir });
    assert.strictEqual(aaoiLogo.contentType, 'image/svg+xml; charset=utf-8');
    assert.strictEqual(aaoiLogo.source, 'inline');
    assert.match(aaoiLogo.body.toString('utf8'), /aaoi-official-bg/);

    const estateLogo = await getLogoResponse('ESTATE', { cacheDir: tempDir });
    assert.strictEqual(estateLogo.contentType, 'image/svg+xml; charset=utf-8');
    assert.strictEqual(estateLogo.source, 'inline');
    assert.match(estateLogo.body.toString('utf8'), /house-bg/);

    const hogLogo = await getLogoResponse('CN_HOG', { cacheDir: tempDir });
    assert.strictEqual(hogLogo.contentType, 'image/svg+xml; charset=utf-8');
    assert.strictEqual(hogLogo.source, 'inline');
    assert.match(hogLogo.body.toString('utf8'), /hog-bg/);

    const samsungLogo = await getLogoResponse('SAMSUNG', { cacheDir: tempDir });
    assert.strictEqual(samsungLogo.contentType, 'image/svg+xml; charset=utf-8');
    assert.strictEqual(samsungLogo.source, 'inline');
    assert.match(samsungLogo.body.toString('utf8'), /samsung-bg/);

    const skHynixLogo = await getLogoResponse('SK_HYNIX', { cacheDir: tempDir });
    assert.strictEqual(skHynixLogo.contentType, 'image/svg+xml; charset=utf-8');
    assert.strictEqual(skHynixLogo.source, 'inline');
    assert.match(skHynixLogo.body.toString('utf8'), /sk-hynix-bg/);

    let downloadCount = 0;
    const httpClient = {
      async get(url) {
        downloadCount += 1;
        assert.strictEqual(url, 'https://assets.coincap.io/assets/icons/btc@2x.png');
        return {
          data: Buffer.from('fake-png'),
          headers: { 'content-type': 'image/png' },
        };
      },
    };

    const first = await getLogoResponse('BTC', { cacheDir: tempDir, httpClient });
    assert.strictEqual(first.contentType, 'image/png');
    assert.strictEqual(first.cacheHit, false);
    assert.strictEqual(downloadCount, 1);

    const second = await getLogoResponse('BTC', { cacheDir: tempDir, httpClient });
    assert.strictEqual(second.contentType, 'image/png');
    assert.strictEqual(second.cacheHit, true);
    assert.strictEqual(second.body.toString('utf8'), 'fake-png');
    assert.strictEqual(downloadCount, 1);

    const failingHttpClient = {
      async get() {
        throw new Error('remote unavailable');
      },
    };
    const fallback = await getLogoResponse('FARTCOIN', {
      cacheDir: tempDir,
      httpClient: failingHttpClient,
    });
    assert.strictEqual(fallback.contentType, 'image/svg+xml; charset=utf-8');
    assert.strictEqual(fallback.source, 'fallback');
    assert.match(fallback.body.toString('utf8'), /FART/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  console.log('logoCache.test.js passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
