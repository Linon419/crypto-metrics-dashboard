const TIME_FORMAT_REGEX = /^\s*(\d{1,2}\.\d{1,2}(\s+\d{1,2}(:\d{2})?)?|\d{4}-\d{2}-\d{2}(\s+\d{2}:\d{2})?|\d{2,4}\.\d{1,2}\.\d{1,2}(\s+\d{1,2}(:\d{2})?)?)\s*$/;
const CLOCK_TIME_FORMAT_REGEX = /^\s*(\d{1,2}\.\d{1,2}|\d{4}-\d{2}-\d{2}|\d{2,4}\.\d{1,2}\.\d{1,2})\s+\d{1,2}(:\d{2})?\s*$/;

export const formatDateForDisplay = (date, time, precision) => {
  if (!date) return '';
  const month = date.month() + 1;
  const day = date.date();

  switch (precision) {
    case 'minute':
      if (time) {
        return `${month}.${day} ${time.format('HH:mm')}`;
      }
      return `${month}.${day} 00:00`;
    case 'hour':
      if (time) {
        return `${month}.${day} ${time.hour()}`;
      }
      return `${month}.${day} 0`;
    case 'day':
    default:
      return `${month}.${day}`;
  }
};

export const preprocessRawDataForSubmit = (
  rawData,
  {
    selectedDate = null,
    selectedTime = null,
    timePrecision = 'day',
    overrideTextTime = false,
  } = {},
) => {
  if (!rawData) return '';
  if (!selectedDate) return rawData;

  const dateStr = formatDateForDisplay(selectedDate, selectedTime, timePrecision);
  const lines = rawData.trim().split('\n');
  const firstLine = lines[0] || '';

  if (TIME_FORMAT_REGEX.test(firstLine)) {
    if (!overrideTextTime && CLOCK_TIME_FORMAT_REGEX.test(firstLine)) {
      return rawData;
    }

    lines[0] = dateStr;
    return lines.join('\n');
  }

  return `${dateStr}\n${rawData}`;
};
