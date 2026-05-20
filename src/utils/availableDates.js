import dayjs from 'dayjs';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const normalizeAvailableDates = (dates = []) => {
  if (!Array.isArray(dates)) return [];

  return Array.from(new Set(
    dates.filter(date => typeof date === 'string' && DATE_PATTERN.test(date))
  )).sort();
};

export const isDateAvailable = (date, availableDates = []) => {
  if (!date || !Array.isArray(availableDates) || availableDates.length === 0) {
    return false;
  }

  return availableDates.includes(dayjs(date).format('YYYY-MM-DD'));
};

export const findNearestAvailableDate = (targetDate, availableDates = []) => {
  const normalizedDates = normalizeAvailableDates(availableDates);
  if (normalizedDates.length === 0) return null;

  const target = dayjs(targetDate);
  if (!target.isValid()) return normalizedDates[normalizedDates.length - 1];

  const targetStr = target.format('YYYY-MM-DD');
  const earlierOrSame = normalizedDates.filter(date => date <= targetStr);

  if (earlierOrSame.length > 0) {
    return earlierOrSame[earlierOrSame.length - 1];
  }

  return normalizedDates[0];
};
