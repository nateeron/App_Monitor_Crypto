(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.Indicators = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function indicatorsFactory() {
  const VISIBLE_BARS = 500;
  const FETCH_LIMIT = VISIBLE_BARS + 199;

  function computeSma(bars, period) {
    const out = [];
    if (!Number.isInteger(period) || period <= 0) return out;
    let sum = 0;
    for (let i = 0; i < bars.length; i += 1) {
      sum += bars[i].close;
      if (i >= period) sum -= bars[i - period].close;
      if (i >= period - 1) {
        out.push({ time: bars[i].time, value: sum / period });
      }
    }
    return out;
  }

  function lastSma(bars, period) {
    if (!Number.isInteger(period) || bars.length < period) return null;
    let sum = 0;
    for (let i = bars.length - period; i < bars.length; i += 1) sum += bars[i].close;
    return { time: bars[bars.length - 1].time, value: sum / period };
  }

  function parseKlines(raw) {
    if (!Array.isArray(raw)) return [];
    const bars = [];
    for (const row of raw) {
      if (!Array.isArray(row) || row.length < 5) continue;
      const time = Math.floor(Number(row[0]) / 1000);
      const open = Number(row[1]);
      const high = Number(row[2]);
      const low = Number(row[3]);
      const close = Number(row[4]);
      if (![time, open, high, low, close].every(Number.isFinite)) continue;
      bars.push({ time, open, high, low, close });
    }
    bars.sort((a, b) => a.time - b.time);
    const deduped = [];
    for (const bar of bars) {
      const prev = deduped[deduped.length - 1];
      if (prev && prev.time === bar.time) deduped[deduped.length - 1] = bar;
      else deduped.push(bar);
    }
    return deduped;
  }

  function pricePrecision(closeText) {
    const trimmed = String(closeText).trim().replace(/0+$/, '').replace(/\.$/, '');
    const dot = trimmed.indexOf('.');
    if (dot === -1) return 2;
    return Math.min(8, Math.max(2, trimmed.length - dot - 1));
  }

  function formatPrice(value, precision) {
    if (!Number.isFinite(value)) return '—';
    return value.toLocaleString('en-US', {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
  }

  return {
    VISIBLE_BARS,
    FETCH_LIMIT,
    computeSma,
    lastSma,
    parseKlines,
    pricePrecision,
    formatPrice,
  };
});
