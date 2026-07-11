const OPTION_TUNING_LABELS = {
  deltaTarget: {
    neutral: 'Delta 中性',
  },
  vegaTarget: {
    positive: 'Vega 正',
    negative: 'Vega 负',
  },
  strategy: {
    iron_condor: 'Iron Condor',
    gamma_squeeze: 'Gamma Squeeze',
  },
};

export function getOptionTuningLabel(group, value) {
  if (!value) return null;
  return OPTION_TUNING_LABELS[group]?.[value] || String(value).replace(/_/g, ' ');
}
