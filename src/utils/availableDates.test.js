import dayjs from 'dayjs';
import {
  findNearestAvailableDate,
  isDateAvailable,
  normalizeAvailableDates,
} from './availableDates';

describe('availableDates', () => {
  test('normalizes dates into a sorted unique list', () => {
    expect(normalizeAvailableDates([
      '2026-05-18',
      'bad',
      '2026-05-06',
      '2026-05-18',
    ])).toEqual(['2026-05-06', '2026-05-18']);
  });

  test('checks dayjs date availability', () => {
    const availableDates = ['2026-05-06', '2026-05-18'];

    expect(isDateAvailable(dayjs('2026-05-18'), availableDates)).toBe(true);
    expect(isDateAvailable(dayjs('2026-05-19'), availableDates)).toBe(false);
  });

  test('finds the nearest available date at or before target', () => {
    const availableDates = ['2026-05-06', '2026-05-18'];

    expect(findNearestAvailableDate('2026-05-19', availableDates)).toBe('2026-05-18');
    expect(findNearestAvailableDate('2026-05-07', availableDates)).toBe('2026-05-06');
    expect(findNearestAvailableDate('2026-05-01', availableDates)).toBe('2026-05-06');
  });
});
