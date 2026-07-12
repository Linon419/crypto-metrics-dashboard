const assert = require('assert');
const { buildRuntimeConfigScript } = require('../utils/runtimeConfig');

const script = buildRuntimeConfigScript({
  apiBaseUrl: 'https://dashboard.example/api',
  brandfetchClientId: 'client-123',
});

assert.match(script, /"API_BASE_URL":"https:\/\/dashboard\.example\/api"/);
assert.match(script, /"BRANDFETCH_CLIENT_ID":"client-123"/);
assert.doesNotThrow(() => new Function(script));

const escapedScript = buildRuntimeConfigScript({
  apiBaseUrl: '</script><script>alert(1)</script>',
});
assert.doesNotMatch(escapedScript, /<\/script>/);

console.log('runtimeConfig.test.js passed');
