process.env.TZ = 'Australia/Sydney';

const assert = require('assert');

const { parseFlexibleDateTime, parseWallClockInOffset } = require('../utils/timeParser');

function assertLocalMinuteParse(input) {
  const parsed = parseFlexibleDateTime(input);

  assert.strictEqual(parsed.isValid, true);
  assert.strictEqual(parsed.date, '2026-05-20');
  assert.strictEqual(parsed.precision, 'minute');
  assert.strictEqual(parsed.timestamp.getFullYear(), 2026);
  assert.strictEqual(parsed.timestamp.getMonth(), 4);
  assert.strictEqual(parsed.timestamp.getDate(), 20);
  assert.strictEqual(parsed.timestamp.getHours(), 0);
  assert.strictEqual(parsed.timestamp.getMinutes(), 1);
}

function run() {
  const sydneyWallClock = parseWallClockInOffset('2026-07-11 00:04', -600);
  assert.strictEqual(sydneyWallClock.date, '2026-07-11');
  assert.strictEqual(sydneyWallClock.timestamp.toISOString(), '2026-07-10T14:04:00.000Z');
  assert.strictEqual(sydneyWallClock.precision, 'minute');

  assertLocalMinuteParse('2026-05-20 00:01');
  assertLocalMinuteParse('2026-05-20T00:01');
  assertLocalMinuteParse('2026.5.20 00:01');
  assertLocalMinuteParse('5.20 00:01');

  const dateOnly = parseFlexibleDateTime('2026-05-20');
  assert.strictEqual(dateOnly.date, '2026-05-20');
  assert.strictEqual(dateOnly.precision, 'day');
  assert.strictEqual(dateOnly.timestamp.getHours(), 0);
  assert.strictEqual(dateOnly.timestamp.getMinutes(), 0);

  console.log('timeParser.test.js passed');
}

run();
