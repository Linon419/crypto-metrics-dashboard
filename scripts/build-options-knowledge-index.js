const fs = require('fs');
const path = require('path');

const {
  OPTIONS_STRATEGY_CATALOG,
} = require('./optionsStrategyCatalog');

const DEFAULT_OUTPUT_PATH = path.join(__dirname, '../src/data/optionsKnowledgeIndex.json');
const DEFAULT_REPORT_PATH = path.join(__dirname, '../local-artifacts/options/options-knowledge-index-report.json');

function parseArgs(argv) {
  const args = {
    outputPath: DEFAULT_OUTPUT_PATH,
    reportPath: DEFAULT_REPORT_PATH,
  };

  argv.forEach(arg => {
    if (arg.startsWith('--out=')) args.outputPath = arg.slice('--out='.length);
    if (arg.startsWith('--report=')) args.reportPath = arg.slice('--report='.length);
  });

  return args;
}

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function buildIndex() {
  return OPTIONS_STRATEGY_CATALOG.map(strategy => {
    return {
      id: strategy.id,
      nameZh: strategy.nameZh,
      nameEn: strategy.nameEn,
      marketStates: strategy.marketStates,
      strategyTypes: strategy.strategyTypes,
      whenToUse: strategy.whenToUse,
      setup: strategy.setup,
      operationSteps: strategy.operationSteps,
      coreGreeks: strategy.coreGreeks,
      risks: strategy.risks,
      sourceLessons: strategy.sourceLessons,
      images: strategy.imageHints,
      keywords: strategy.keywords,
    };
  });
}

function buildIndexFromSourceTexts() {
  return buildIndex();
}

function buildReport(index) {
  return {
    generatedAt: new Date().toISOString(),
    strategyCount: index.length,
    strategies: index.map(item => ({
      id: item.id,
      nameZh: item.nameZh,
      nameEn: item.nameEn,
      sourceLessons: item.sourceLessons,
    })),
  };
}

function writeJson(filePath, payload) {
  ensureDirectory(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const index = buildIndex();

  const report = buildReport(index);
  writeJson(args.outputPath, index);
  writeJson(args.reportPath, report);

  console.log(`Wrote ${index.length} strategies to ${args.outputPath}`);
  console.log(`Wrote extraction report to ${args.reportPath}`);
}

if (require.main === module) {
  run();
}

module.exports = {
  buildIndex,
  buildIndexFromSourceTexts,
  buildReport,
  parseArgs,
  run,
};
