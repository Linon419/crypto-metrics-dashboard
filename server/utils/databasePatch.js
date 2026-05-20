const PATCH_MODES = new Set(['dry-run', 'apply']);
const TIME_PRECISIONS = new Set(['day', 'hour', 'minute']);

class PatchValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PatchValidationError';
    this.statusCode = 400;
  }
}

const TABLE_CONFIG = {
  DailyMetrics: {
    modelKey: 'DailyMetric',
    matchFields: ['symbol', 'date'],
    setFields: new Set([
      'otc_index',
      'explosion_index',
      'schelling_point',
      'entry_exit_type',
      'entry_exit_day',
      'near_threshold',
      'momentum_indicators',
      'timestamp',
      'time_precision',
    ]),
    integerFields: new Set(['otc_index', 'explosion_index', 'entry_exit_day']),
    floatFields: new Set(['schelling_point']),
    booleanFields: new Set(['near_threshold']),
    textFields: new Set(['entry_exit_type', 'momentum_indicators']),
  },
  LiquidityOverviews: {
    modelKey: 'LiquidityOverview',
    matchFields: ['date'],
    setFields: new Set([
      'btc_fund_change',
      'eth_fund_change',
      'sol_fund_change',
      'total_market_fund_change',
      'comments',
      'daily_reminder',
      'timestamp',
      'time_precision',
    ]),
    integerFields: new Set([]),
    floatFields: new Set([
      'btc_fund_change',
      'eth_fund_change',
      'sol_fund_change',
      'total_market_fund_change',
    ]),
    booleanFields: new Set([]),
    textFields: new Set(['comments', 'daily_reminder']),
  },
  TrendingCoins: {
    modelKey: 'TrendingCoin',
    matchFields: ['symbol', 'date'],
    setFields: new Set([
      'otc_index',
      'explosion_index',
      'schelling_point',
      'entry_exit_type',
      'entry_exit_day',
      'timestamp',
      'time_precision',
    ]),
    integerFields: new Set(['otc_index', 'explosion_index', 'entry_exit_day']),
    floatFields: new Set(['schelling_point']),
    booleanFields: new Set([]),
    textFields: new Set(['entry_exit_type']),
  },
};

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PatchValidationError(`${label} must be an object`);
  }
}

function assertDateString(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new PatchValidationError(`${label} must use YYYY-MM-DD`);
  }
  return value;
}

function assertExactKeys(object, expectedKeys, label) {
  const actualKeys = Object.keys(object).sort();
  const sortedExpected = [...expectedKeys].sort();

  if (
    actualKeys.length !== sortedExpected.length ||
    actualKeys.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new PatchValidationError(`${label} must contain exactly: ${sortedExpected.join(', ')}`);
  }
}

function normalizeSymbol(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PatchValidationError(`${label} must be a non-empty string`);
  }
  return value.trim().toUpperCase();
}

function normalizeTimestamp(value, label) {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new PatchValidationError(`${label} must be a valid timestamp`);
  }
  return date;
}

function normalizeSetValue(config, field, value, label) {
  if (field === 'timestamp') {
    return normalizeTimestamp(value, label);
  }

  if (field === 'time_precision') {
    if (!TIME_PRECISIONS.has(value)) {
      throw new PatchValidationError(`${label} must be one of: day, hour, minute`);
    }
    return value;
  }

  if (value === null) return null;

  if (config.integerFields.has(field)) {
    if (!Number.isInteger(value)) {
      throw new PatchValidationError(`${label} must be an integer`);
    }
    return value;
  }

  if (config.floatFields.has(field)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new PatchValidationError(`${label} must be a finite number`);
    }
    return value;
  }

  if (config.booleanFields.has(field)) {
    if (typeof value !== 'boolean') {
      throw new PatchValidationError(`${label} must be a boolean`);
    }
    return value;
  }

  if (field === 'momentum_indicators' && Array.isArray(value)) {
    return JSON.stringify(value);
  }

  if (config.textFields.has(field)) {
    if (typeof value !== 'string') {
      throw new PatchValidationError(`${label} must be a string`);
    }
    return value;
  }

  return value;
}

function normalizeOperation(operation, index) {
  assertPlainObject(operation, `operations[${index}]`);

  const { table, match, set } = operation;
  const config = TABLE_CONFIG[table];
  if (!config) {
    throw new PatchValidationError(`operations[${index}].table is unsupported`);
  }

  assertPlainObject(match, `operations[${index}].match`);
  assertExactKeys(match, config.matchFields, `operations[${index}].match`);

  const normalizedMatch = {};
  for (const field of config.matchFields) {
    if (field === 'symbol') {
      normalizedMatch.symbol = normalizeSymbol(match.symbol, `operations[${index}].match.symbol`);
    } else if (field === 'date') {
      normalizedMatch.date = assertDateString(match.date, `operations[${index}].match.date`);
    }
  }

  assertPlainObject(set, `operations[${index}].set`);
  const setEntries = Object.entries(set);
  if (setEntries.length === 0) {
    throw new PatchValidationError(`operations[${index}].set must contain at least one field`);
  }

  const normalizedSet = {};
  for (const [field, value] of setEntries) {
    if (!config.setFields.has(field)) {
      throw new PatchValidationError(`operations[${index}].set.${field} is unsupported`);
    }
    normalizedSet[field] = normalizeSetValue(
      config,
      field,
      value,
      `operations[${index}].set.${field}`
    );
  }

  return {
    table,
    match: normalizedMatch,
    set: normalizedSet,
  };
}

function validateDatabasePatch(patch) {
  assertPlainObject(patch, 'patch');

  const reason = typeof patch.reason === 'string' ? patch.reason.trim() : '';
  if (!reason) {
    throw new PatchValidationError('patch.reason must be a non-empty string');
  }

  if (!Array.isArray(patch.operations) || patch.operations.length === 0) {
    throw new PatchValidationError('patch.operations must contain at least one operation');
  }

  if (patch.operations.length > 50) {
    throw new PatchValidationError('patch.operations supports at most 50 operations');
  }

  return {
    reason,
    operations: patch.operations.map(normalizeOperation),
  };
}

function serializeValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value.toISOString === 'function') return value.toISOString();
  return value;
}

function buildFieldDiff(before, set) {
  const diff = {};

  for (const [field, nextValue] of Object.entries(set)) {
    const beforeValue = serializeValue(before[field]);
    const afterValue = serializeValue(nextValue);
    if (beforeValue !== afterValue) {
      diff[field] = {
        before: beforeValue,
        after: afterValue,
      };
    }
  }

  return diff;
}

function serializeSet(set) {
  return Object.fromEntries(
    Object.entries(set).map(([field, value]) => [field, serializeValue(value)])
  );
}

async function resolveOperationWhere(operation, models, transaction) {
  if (operation.table === 'DailyMetrics') {
    const coin = await models.Coin.findOne({
      where: { symbol: operation.match.symbol },
      transaction,
    });

    if (!coin) {
      return {
        where: null,
        message: `Coin ${operation.match.symbol} was not found`,
      };
    }

    return {
      where: {
        coin_id: coin.id,
        date: operation.match.date,
      },
    };
  }

  if (operation.table === 'LiquidityOverviews') {
    return {
      where: { date: operation.match.date },
    };
  }

  if (operation.table === 'TrendingCoins') {
    return {
      where: {
        symbol: operation.match.symbol,
        date: operation.match.date,
      },
    };
  }

  throw new PatchValidationError(`Unsupported table: ${operation.table}`);
}

async function runDatabasePatch(patch, { models, mode = 'dry-run', transaction = null } = {}) {
  if (!PATCH_MODES.has(mode)) {
    throw new PatchValidationError('mode must be dry-run or apply');
  }

  const normalizedPatch = validateDatabasePatch(patch);
  const operations = [];
  let matchedCount = 0;
  let appliedCount = 0;

  for (let index = 0; index < normalizedPatch.operations.length; index += 1) {
    const operation = normalizedPatch.operations[index];
    const config = TABLE_CONFIG[operation.table];
    const model = models[config.modelKey];

    if (!model) {
      throw new PatchValidationError(`Model ${config.modelKey} is unavailable`);
    }

    const whereResolution = await resolveOperationWhere(operation, models, transaction);
    const operationResult = {
      index,
      table: operation.table,
      match: operation.match,
      set: serializeSet(operation.set),
      matchedCount: 0,
      appliedCount: 0,
      changes: [],
    };

    if (!whereResolution.where) {
      operationResult.message = whereResolution.message;
      operations.push(operationResult);
      continue;
    }

    const rows = await model.findAll({
      where: whereResolution.where,
      transaction,
    });

    if (rows.length > 1) {
      throw new PatchValidationError(
        `operations[${index}] matched ${rows.length} rows; refine the database before applying this patch`
      );
    }

    operationResult.matchedCount = rows.length;
    matchedCount += rows.length;

    if (rows.length === 0) {
      operations.push(operationResult);
      continue;
    }

    const row = rows[0];
    const before = typeof row.toJSON === 'function' ? row.toJSON() : row;
    const diff = buildFieldDiff(before, operation.set);
    operationResult.changes = Object.entries(diff).map(([field, change]) => ({
      field,
      before: change.before,
      after: change.after,
    }));

    if (mode === 'apply' && operationResult.changes.length > 0) {
      await row.update(operation.set, { transaction });
      operationResult.appliedCount = 1;
      appliedCount += 1;
    }

    operations.push(operationResult);
  }

  return {
    mode,
    reason: normalizedPatch.reason,
    summary: {
      operations: normalizedPatch.operations.length,
      matched: matchedCount,
      applied: appliedCount,
    },
    operations,
    normalizedPatch,
  };
}

module.exports = {
  PatchValidationError,
  TABLE_CONFIG,
  buildFieldDiff,
  runDatabasePatch,
  validateDatabasePatch,
};
