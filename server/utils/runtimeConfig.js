function buildRuntimeConfigScript({ apiBaseUrl, brandfetchClientId = '' }) {
  const config = {
    API_BASE_URL: String(apiBaseUrl || ''),
    BRANDFETCH_CLIENT_ID: String(brandfetchClientId || ''),
  };
  const serialized = JSON.stringify(config).replace(/</g, '\\u003c');
  return `window.runtimeConfig = ${serialized};`;
}

module.exports = { buildRuntimeConfigScript };
