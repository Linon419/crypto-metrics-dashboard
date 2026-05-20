import { buildPeriodQualityMarkers } from './periodQualityMarkers';

describe('buildPeriodQualityMarkers', () => {
  test('marks only entries into high and low quality regimes', () => {
    const markers = buildPeriodQualityMarkers([
      { timeKey: 't1', date: '2026-01-01', periodQuality: '观察型进场' },
      { timeKey: 't2', date: '2026-01-02', periodQuality: '高质量进场' },
      { timeKey: 't3', date: '2026-01-03', periodQuality: '高质量进场' },
      { timeKey: 't4', date: '2026-01-04', periodQuality: '低质量进场' },
      { timeKey: 't5', date: '2026-01-05', periodQuality: '低质量进场（需调仓）' },
      { timeKey: 't6', date: '2026-01-06', periodQuality: '观察型进场' },
      { timeKey: 't7', date: '2026-01-07', periodQuality: '高质量退场' },
    ]);

    expect(markers.map(marker => ({
      timeKey: marker.timeKey,
      type: marker.type,
      label: marker.label,
      periodQuality: marker.periodQuality,
    }))).toEqual([
      { timeKey: 't2', type: 'high', label: '高质量', periodQuality: '高质量进场' },
      { timeKey: 't4', type: 'low', label: '低质量', periodQuality: '低质量进场' },
      { timeKey: 't7', type: 'high', label: '高质量', periodQuality: '高质量退场' },
    ]);
  });
});
