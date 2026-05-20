#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const axios = require('axios');

function printUsageAndExit() {
  console.error([
    'Usage:',
    '  node server/scripts/apply-cloud-patch.js <patch.json> --dry-run',
    '  node server/scripts/apply-cloud-patch.js <patch.json> --apply',
    '',
    'Environment:',
    '  CLOUD_API_BASE_URL=https://your-domain.example',
    '  CLOUD_API_TOKEN=<admin jwt token>',
  ].join('\n'));
  process.exit(1);
}

function parseArgs(argv) {
  const patchPath = argv.find(arg => !arg.startsWith('--'));
  const apply = argv.includes('--apply');
  const dryRun = argv.includes('--dry-run');

  if (!patchPath || apply === dryRun) {
    printUsageAndExit();
  }

  return {
    patchPath,
    mode: apply ? 'apply' : 'dry-run',
  };
}

function buildEndpoint(baseUrl, mode) {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const apiBase = normalizedBase.endsWith('/api')
    ? normalizedBase
    : `${normalizedBase}/api`;

  return `${apiBase}/admin/database-patches/${mode === 'apply' ? 'apply' : 'dry-run'}`;
}

async function main() {
  const { patchPath, mode } = parseArgs(process.argv.slice(2));
  const baseUrl = process.env.CLOUD_API_BASE_URL;
  const token = process.env.CLOUD_API_TOKEN;

  if (!baseUrl || !token) {
    printUsageAndExit();
  }

  const absolutePatchPath = path.resolve(process.cwd(), patchPath);
  const patch = JSON.parse(fs.readFileSync(absolutePatchPath, 'utf8'));
  const endpoint = buildEndpoint(baseUrl, mode);

  const response = await axios.post(endpoint, patch, {
    timeout: 120000,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  console.log(JSON.stringify(response.data, null, 2));
}

main().catch(error => {
  if (error.response) {
    console.error(JSON.stringify(error.response.data, null, 2));
    process.exitCode = 1;
    return;
  }

  console.error(error.message);
  process.exitCode = 1;
});
