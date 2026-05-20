import dayjs from 'dayjs';
import { preprocessRawDataForSubmit } from './inputPreprocess';

describe('preprocessRawDataForSubmit', () => {
  test('keeps a pasted ISO minute timestamp when picker override is disabled', () => {
    const rawData = '2026-05-18 23:01\nBTC 场外指数1200\n爆破指数100';

    const result = preprocessRawDataForSubmit(rawData, {
      selectedDate: dayjs('2026-05-19'),
      selectedTime: null,
      timePrecision: 'day',
      overrideTextTime: false,
    });

    expect(result).toBe(rawData);
  });

  test('replaces a pasted timestamp when picker override is enabled', () => {
    const rawData = '2026-05-18 23:01\nBTC 场外指数1200\n爆破指数100';

    const result = preprocessRawDataForSubmit(rawData, {
      selectedDate: dayjs('2026-05-19'),
      selectedTime: null,
      timePrecision: 'day',
      overrideTextTime: true,
    });

    expect(result).toBe('5.19\nBTC 场外指数1200\n爆破指数100');
  });

  test('replaces a date-only first line with the selected picker date', () => {
    const rawData = '5.18\nBTC 场外指数1200\n爆破指数100';

    const result = preprocessRawDataForSubmit(rawData, {
      selectedDate: dayjs('2026-05-19'),
      selectedTime: null,
      timePrecision: 'day',
      overrideTextTime: false,
    });

    expect(result).toBe('5.19\nBTC 场外指数1200\n爆破指数100');
  });
});
