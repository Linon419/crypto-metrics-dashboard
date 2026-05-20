const HOT_ENTRY_EXPLOSION_THRESHOLD = 200;

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildPeriodRiskNotes(metric = {}) {
  const notes = [];
  const periodType = metric.entry_exit_type || metric.entryExitType;
  const periodDay = toNumber(metric.entry_exit_day ?? metric.entryExitDay);
  const explosionIndex = toNumber(metric.explosion_index ?? metric.explosionIndex);

  if (
    periodType === 'entry' &&
    periodDay === 1 &&
    explosionIndex !== null &&
    explosionIndex > HOT_ENTRY_EXPLOSION_THRESHOLD
  ) {
    notes.push('进场首日爆破高于200，短线偏热');
  }

  return notes;
}

module.exports = {
  HOT_ENTRY_EXPLOSION_THRESHOLD,
  buildPeriodRiskNotes,
};
