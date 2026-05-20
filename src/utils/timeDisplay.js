import dayjs from 'dayjs';

const getPrecision = ({ timePrecision, time_precision } = {}) => timePrecision || time_precision || 'day';

const parseMetricTimestamp = (timestamp) => {
  if (!timestamp) return null;

  const parsed = dayjs(timestamp);
  return parsed.isValid() ? parsed : null;
};

export const formatMetricDisplayTime = ({ date, timestamp, timePrecision, time_precision } = {}) => {
  const precision = timePrecision || time_precision;

  if (!timestamp || precision === 'day') {
    return date || '';
  }

  const parsed = parseMetricTimestamp(timestamp);
  if (!parsed) {
    return date || '';
  }

  if (precision === 'minute') {
    return parsed.format('YYYY-MM-DD HH:mm');
  }

  if (precision === 'hour') {
    return parsed.format('YYYY-MM-DD HH:00');
  }

  return date || '';
};

export const getMetricTimeKey = (metric = {}) => {
  const precision = getPrecision(metric);
  const displayTime = formatMetricDisplayTime(metric);

  if (displayTime && precision !== 'day') {
    return displayTime;
  }

  return metric.date || displayTime || '';
};

export const getMetricSortTime = ({ date, timestamp } = {}) => {
  const parsedTimestamp = parseMetricTimestamp(timestamp);
  if (parsedTimestamp) return parsedTimestamp.valueOf();

  const parsedDate = dayjs(date);
  if (parsedDate.isValid()) return parsedDate.valueOf();

  return 0;
};

export const formatMetricAxisTick = (metric = {}) => {
  const displayTime = metric.displayTime || formatMetricDisplayTime(metric);
  const parsed = dayjs(displayTime);

  if (!parsed.isValid()) {
    return metric.date || displayTime || '';
  }

  const precision = getPrecision(metric);
  if (precision === 'minute') {
    return parsed.format('M/D HH:mm');
  }

  if (precision === 'hour') {
    return parsed.format('M/D HH:00');
  }

  return parsed.format('M/D');
};
