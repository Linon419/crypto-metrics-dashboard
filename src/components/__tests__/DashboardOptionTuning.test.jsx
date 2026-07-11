import { getOptionTuningLabel } from '../../utils/optionTuningLabels';

test('shows the gamma squeeze option-tuning strategy label', () => {
  expect(getOptionTuningLabel('strategy', 'gamma_squeeze')).toBe('Gamma Squeeze');
});
