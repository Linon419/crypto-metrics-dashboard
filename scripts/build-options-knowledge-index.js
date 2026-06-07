const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  OPTIONS_STRATEGY_CATALOG,
  collectMatchingParagraphs,
} = require('./optionsStrategyCatalog');

const DEFAULT_SOURCE_DIR = '/Users/yang/Documents/知识星球/魔方内参';
const DEFAULT_OUTPUT_PATH = path.join(__dirname, '../src/data/optionsKnowledgeIndex.json');
const DEFAULT_REPORT_PATH = path.join(__dirname, '../local-artifacts/options/options-knowledge-index-report.json');

function parseArgs(argv) {
  const args = {
    sourceDir: DEFAULT_SOURCE_DIR,
    outputPath: DEFAULT_OUTPUT_PATH,
    reportPath: DEFAULT_REPORT_PATH,
    maxExcerptChars: 1800,
  };

  argv.forEach(arg => {
    if (arg.startsWith('--source=')) args.sourceDir = arg.slice('--source='.length);
    if (arg.startsWith('--out=')) args.outputPath = arg.slice('--out='.length);
    if (arg.startsWith('--report=')) args.reportPath = arg.slice('--report='.length);
    if (arg.startsWith('--maxExcerptChars=')) {
      args.maxExcerptChars = Number(arg.slice('--maxExcerptChars='.length)) || args.maxExcerptChars;
    }
  });

  return args;
}

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function listDocxFiles(sourceDir) {
  const originalsDir = path.join(sourceDir, '原文');
  if (!fs.existsSync(originalsDir)) {
    throw new Error(`Source originals directory is missing: ${originalsDir}`);
  }

  return fs.readdirSync(originalsDir)
    .filter(fileName => fileName.endsWith('.docx'))
    .filter(fileName => !fileName.startsWith('~$'))
    .sort()
    .map(fileName => path.join(originalsDir, fileName));
}

function readDocxText(filePath) {
  return execFileSync('/usr/bin/textutil', ['-convert', 'txt', '-stdout', filePath], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
}

function buildQuote({ sourceFile, excerpt }) {
  const compact = String(excerpt || '').trim();
  return {
    sourceFile,
    excerpt: compact,
    startHint: compact.slice(0, 28),
    endHint: compact.slice(Math.max(0, compact.length - 28)),
  };
}

function buildIndexFromSourceTexts({ sourceTexts, maxExcerptChars = 1800 }) {
  return OPTIONS_STRATEGY_CATALOG.map(strategy => {
    const quotes = sourceTexts.flatMap(source => (
      collectMatchingParagraphs(source.text, strategy.keywords, maxExcerptChars)
        .slice(0, 8)
        .map(excerpt => buildQuote({
          sourceFile: source.sourceFile,
          excerpt,
        }))
    ));

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
      quotes,
      images: strategy.imageHints,
      keywords: strategy.keywords,
    };
  });
}

function buildReport(index) {
  return {
    generatedAt: new Date().toISOString(),
    strategyCount: index.length,
    strategies: index.map(item => ({
      id: item.id,
      nameZh: item.nameZh,
      nameEn: item.nameEn,
      quoteCount: item.quotes.length,
      sourceFiles: Array.from(new Set(item.quotes.map(quote => quote.sourceFile))).sort(),
    })),
  };
}

function writeJson(filePath, payload) {
  ensureDirectory(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const files = listDocxFiles(args.sourceDir);
  const sourceTexts = files.map(filePath => ({
    sourceFile: path.basename(filePath),
    text: readDocxText(filePath),
  }));

  const index = buildIndexFromSourceTexts({
    sourceTexts,
    maxExcerptChars: args.maxExcerptChars,
  });

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
  buildIndexFromSourceTexts,
  buildReport,
  listDocxFiles,
  parseArgs,
  readDocxText,
  run,
};
