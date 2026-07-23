import { getPeriodQualityMeta, normalizePeriodQualityLabel } from './periodQualityMeta';

describe('period quality metadata', () => {
  test.each([
    ['修复型进场', '低质量进场'],
    ['观察型进场', '低质量进场'],
    ['修复型退场', '低质量退场'],
    ['观察型退场', '低质量退场'],
    ['低质量进场（需调仓）', '低质量进场'],
  ])('normalizes legacy label %s to %s', (quality, expected) => {
    expect(normalizePeriodQualityLabel(quality)).toBe(expected);
    expect(getPeriodQualityMeta(quality).displayLabel).toBe(expected);
  });

  test('keeps current labels unchanged', () => {
    expect(getPeriodQualityMeta('高质量进场').displayLabel).toBe('高质量进场');
    expect(getPeriodQualityMeta('退场期 (待观察)').displayLabel).toBe('退场期 (待观察)');
  });
});
