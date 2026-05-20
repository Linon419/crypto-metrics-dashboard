const HIGH_COLOR = '#16a34a';
const LOW_COLOR = '#dc2626';

export function getPeriodQualityMarkerType(periodQuality) {
  if (!periodQuality) return null;
  if (String(periodQuality).includes('高质量')) return 'high';
  if (String(periodQuality).includes('低质量')) return 'low';
  return null;
}

export function buildPeriodQualityMarkers(rows = []) {
  const markers = [];
  let previousType = null;

  rows.forEach((row) => {
    const type = getPeriodQualityMarkerType(row.periodQuality || row.period_quality);
    if (type && type !== previousType) {
      markers.push({
        timeKey: row.timeKey,
        date: row.date,
        displayTime: row.displayTime || row.date,
        type,
        label: type === 'high' ? '高质量' : '低质量',
        color: type === 'high' ? HIGH_COLOR : LOW_COLOR,
        periodQuality: row.periodQuality || row.period_quality,
      });
    }

    previousType = type;
  });

  return markers;
}
