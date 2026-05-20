process.env.TZ = 'Australia/Sydney';

const { formatMetricAxisTick, formatMetricDisplayTime } = require('./timeDisplay');

describe('formatMetricDisplayTime', () => {
  test('shows minute precision when timestamp has full time', () => {
    expect(formatMetricDisplayTime({
      date: '2026-05-18',
      timestamp: '2026-05-18T15:01:00.000Z',
      timePrecision: 'minute',
    })).toBe('2026-05-19 01:01');
  });

  test('uses browser local timezone for snake_case API field', () => {
    expect(formatMetricDisplayTime({
      date: '2026-05-18',
      timestamp: '2026-05-18T13:01:00.000Z',
      time_precision: 'minute',
    })).toBe('2026-05-18 23:01');
  });

  test('shows hour precision when metric precision is hour', () => {
    expect(formatMetricDisplayTime({
      date: '2026-05-18',
      timestamp: '2026-05-18T15:01:00.000Z',
      timePrecision: 'hour',
    })).toBe('2026-05-19 01:00');
  });

  test('keeps date-only display for day precision', () => {
    expect(formatMetricDisplayTime({
      date: '2026-05-18',
      timestamp: '2026-05-18T23:01:00',
      timePrecision: 'day',
    })).toBe('2026-05-18');
  });

  test('formats axis tick in local timezone', () => {
    expect(formatMetricAxisTick({
      date: '2026-05-18',
      timestamp: '2026-05-18T13:01:00.000Z',
      timePrecision: 'minute',
    })).toBe('5/18 23:01');
  });
});
