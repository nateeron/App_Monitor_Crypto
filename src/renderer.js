const {
  VISIBLE_BARS,
  FETCH_LIMIT,
  computeSma,
  lastSma,
  parseKlines,
  pricePrecision,
  formatPrice,
} = window.Indicators;

const TIMEFRAMES = [
  { id: '1m', label: '1 นาที' },
  { id: '3m', label: '3 นาที' },
  { id: '5m', label: '5 นาที' },
  { id: '15m', label: '15 นาที' },
  { id: '30m', label: '30 นาที' },
  { id: '1h', label: '1 ชั่วโมง' },
  { id: '2h', label: '2 ชั่วโมง' },
  { id: '4h', label: '4 ชั่วโมง' },
  { id: '1d', label: '1 วัน' },
];

const SIZES = [250, 300, 400, 500];
const LATEST_BARS = 20;
const ACCENTS = { BTCUSDT: '#F7941A', XRPUSDT: '#00aae4' };

const symbolEl = document.getElementById('symbol');
const priceEl = document.getElementById('price');
const changeEl = document.getElementById('change');
const accentEl = document.getElementById('accent');
const tfBtn = document.getElementById('tfBtn');
const statusEl = document.getElementById('status');
const chartWrap = document.getElementById('chartWrap');
const chartHost = document.getElementById('chart');
const overlay = document.getElementById('overlay');
const overlayText = document.getElementById('overlayText');
const retryBtn = document.getElementById('retryBtn');
const menu = document.getElementById('menu');
const leg5 = document.getElementById('leg5');
const leg200 = document.getElementById('leg200');

const state = {
  symbol: '',
  interval: '15m',
  independent: false,
  alwaysOnTop: true,
  headerHeight: 30,
  precision: 2,
  history: [],
  dayOpen: null,
  chartReady: false,
  loadId: 0,
  socketGen: 0,
};

let chart;
let candleSeries;
let sma5Series;
let sma200Series;
let socket = null;
let reconnectTimer = null;
let pollTimer = null;

function prettySymbol(symbol) {
  if (symbol.endsWith('USDT')) return `${symbol.slice(0, -4)}/USDT`;
  return symbol;
}

function formatBangkok(time, tickMarkType) {
  const date = new Date(time * 1000);
  const base = { timeZone: 'Asia/Bangkok', hour12: false };
  if (tickMarkType === 0) return new Intl.DateTimeFormat('th-TH', { ...base, year: 'numeric' }).format(date);
  if (tickMarkType === 1) return new Intl.DateTimeFormat('th-TH', { ...base, month: 'short', year: '2-digit' }).format(date);
  if (tickMarkType === 2) return new Intl.DateTimeFormat('th-TH', { ...base, day: '2-digit', month: 'short' }).format(date);
  if (tickMarkType === true) {
    return new Intl.DateTimeFormat('th-TH', {
      ...base, year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(date);
  }
  return new Intl.DateTimeFormat('th-TH', { ...base, hour: '2-digit', minute: '2-digit' }).format(date);
}

function setOnline(online) {
  statusEl.classList.toggle('on', online);
  statusEl.title = online ? 'เชื่อมต่อ Binance แล้ว' : 'ไม่ได้เชื่อมต่อ';
}

function showOverlay(text, canRetry) {
  overlayText.textContent = text;
  retryBtn.hidden = !canRetry;
  overlay.hidden = false;
}

function hideOverlay() {
  overlay.hidden = true;
}

function applyWindowState(next) {
  state.independent = Boolean(next.independent);
  state.alwaysOnTop = next.alwaysOnTop !== false;
  if (next.headerHeight) state.headerHeight = next.headerHeight;
  document.body.classList.toggle('independent', state.independent);
  document.getElementById('header').title = state.independent
    ? 'ลากเพื่อย้ายหน้าต่าง'
    : 'ลากขึ้นลง — หน้าต่างที่ชิดขอบขวาเลื่อนพร้อมกัน';
}

function priceFormat() {
  return {
    type: 'price',
    precision: state.precision,
    minMove: Number((10 ** -state.precision).toFixed(state.precision)),
  };
}

function createSeries(definition, options) {
  const lib = window.LightweightCharts;
  if (typeof chart.addSeries === 'function' && definition) {
    return chart.addSeries(definition, options);
  }
  if (definition === lib.CandlestickSeries && chart.addCandlestickSeries) {
    return chart.addCandlestickSeries(options);
  }
  return chart.addLineSeries(options);
}

function buildChart() {
  const lib = window.LightweightCharts;
  chart = lib.createChart(chartHost, {
    autoSize: false,
    layout: {
      background: { type: 'solid', color: '#0b0e11' },
      textColor: '#9aa6b6',
      fontSize: 10,
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: '#1c2430' },
      horzLines: { color: '#1c2430' },
    },
    rightPriceScale: { borderColor: '#2a313c', scaleMargins: { top: 0.12, bottom: 0.08 } },
    timeScale: {
      borderColor: '#2a313c',
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 2,
      minBarSpacing: 0.3,
      tickMarkFormatter: (time, tickMarkType) => formatBangkok(time, tickMarkType),
    },
    localization: {
      locale: 'th-TH',
      timeFormatter: (time) => formatBangkok(time, true),
    },
    crosshair: {
      mode: lib.CrosshairMode ? lib.CrosshairMode.Normal : 0,
    },
    handleScroll: true,
    handleScale: true,
  });

  candleSeries = createSeries(lib.CandlestickSeries, {
    upColor: '#26a69a',
    downColor: '#ef5350',
    borderVisible: false,
    wickUpColor: '#26a69a',
    wickDownColor: '#ef5350',
    priceLineVisible: true,
    lastValueVisible: true,
  });
  sma5Series = createSeries(lib.LineSeries, {
    color: '#E08A09B4',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });
  sma200Series = createSeries(lib.LineSeries, {
    color: '#FFFFFFAF',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });

  chart.subscribeCrosshairMove((param) => {
    if (!param || !param.time || !param.seriesData) {
      updateLegend();
      return;
    }
    const sma5 = param.seriesData.get(sma5Series);
    const sma200 = param.seriesData.get(sma200Series);
    leg5.textContent = `SMA 5  ${sma5 ? formatPrice(sma5.value, state.precision) : '—'}`;
    leg200.textContent = `SMA 200  ${sma200 ? formatPrice(sma200.value, state.precision) : '—'}`;
  });

  const resize = () => {
    const width = chartWrap.clientWidth;
    const height = chartWrap.clientHeight;
    if (width > 0 && height > 0) chart.applyOptions({ width, height });
  };
  resize();
  new ResizeObserver(resize).observe(chartWrap);
}

function visibleBars() {
  return state.history.slice(-VISIBLE_BARS);
}

function pushSeries(fit) {
  const view = visibleBars();
  if (!view.length) return;
  const start = view[0].time;
  candleSeries.setData(view);
  sma5Series.setData(computeSma(state.history, 5).filter((point) => point.time >= start));
  sma200Series.setData(computeSma(state.history, 200).filter((point) => point.time >= start));
  state.chartReady = true;
  if (fit) showLatestBars();
  updateReadout();
}

function showLatestBars() {
  const count = visibleBars().length;
  if (!chart || !candleSeries || !count) return;
  candleSeries.priceScale().applyOptions({
    autoScale: true,
    scaleMargins: { top: 0.12, bottom: 0.08 },
  });
  const last = count - 1;
  chart.timeScale().setVisibleLogicalRange({
    from: last - (LATEST_BARS - 1),
    to: last + 2,
  });
}

function updateLegend() {
  const sma5 = lastSma(state.history, 5);
  const sma200 = lastSma(state.history, 200);
  leg5.textContent = `SMA 5  ${sma5 ? formatPrice(sma5.value, state.precision) : '—'}`;
  leg200.textContent = `SMA 200  ${sma200 ? formatPrice(sma200.value, state.precision) : '—'}`;
}

function resetPricePosition() {
  showLatestBars();
}

function updateReadout() {
  const view = visibleBars();
  const last = view[view.length - 1];
  if (!last) return;
  const base = state.dayOpen;
  const delta = Number.isFinite(base) ? last.close - base : 0;
  const pct = base ? (delta / base) * 100 : 0;
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : '';
  priceEl.textContent = formatPrice(last.close, state.precision);
  priceEl.className = direction;
  if (Number.isFinite(base)) {
    changeEl.textContent = `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
    changeEl.className = direction;
    changeEl.title = 'เปลี่ยนแปลงจากราคาเปิดของวันนี้';
  } else {
    changeEl.textContent = '';
    changeEl.removeAttribute('title');
  }
  updateLegend();
}

async function refreshDayOpen(generation) {
  try {
    const raw = await window.monitor.fetchKlines({
      symbol: state.symbol,
      interval: '1d',
      limit: 1,
    });
    if (generation !== state.loadId) return;
    const day = parseKlines(raw).at(-1);
    if (!day) return;
    state.dayOpen = day.open;
    updateReadout();
  } catch {
    // Keep the last known daily open until the next refresh.
  }
}

function validBar(bar) {
  return bar && [bar.time, bar.open, bar.high, bar.low, bar.close].every(Number.isFinite);
}

function stopSocket() {
  state.socketGen += 1;
  clearTimeout(reconnectTimer);
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
}

function applyBar(bar) {
  if (!state.chartReady || !state.history.length || !validBar(bar)) return;
  const last = state.history[state.history.length - 1];
  if (bar.time < last.time) return;
  if (bar.time === last.time) {
    state.history[state.history.length - 1] = bar;
    candleSeries.update(bar);
    const sma5 = lastSma(state.history, 5);
    const sma200 = lastSma(state.history, 200);
    if (sma5) sma5Series.update(sma5);
    if (sma200) sma200Series.update(sma200);
    updateReadout();
    return;
  }

  const range = chart.timeScale().getVisibleLogicalRange();
  const atEnd = !range || range.to >= VISIBLE_BARS - 2;
  state.history.push(bar);
  if (state.history.length > FETCH_LIMIT) {
    state.history.splice(0, state.history.length - FETCH_LIMIT);
  }
  pushSeries(false);
  if (range) {
    chart.timeScale().setVisibleLogicalRange(atEnd ? range : {
      from: range.from - 1,
      to: range.to - 1,
    });
  }
}

function connectSocket() {
  stopSocket();
  openSocket(state.socketGen, 0);
}

function openSocket(generation, hostIndex) {
  if (generation !== state.socketGen) return;
  const stream = `${state.symbol.toLowerCase()}@kline_${state.interval}`;
  const urls = [
    `wss://stream.binance.com:9443/ws/${stream}`,
    `wss://data-stream.binance.vision/ws/${stream}`,
  ];
  const ws = new WebSocket(urls[hostIndex % urls.length]);
  socket = ws;
  ws.onopen = () => {
    if (generation !== state.socketGen) return;
    setOnline(true);
  };
  ws.onmessage = (event) => {
    if (generation !== state.socketGen) return;
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    const kline = payload.k || payload.data?.k;
    if (!kline || kline.s !== state.symbol || kline.i !== state.interval) return;
    applyBar({
      time: Math.floor(Number(kline.t) / 1000),
      open: Number(kline.o),
      high: Number(kline.h),
      low: Number(kline.l),
      close: Number(kline.c),
    });
  };
  ws.onerror = () => {};
  ws.onclose = () => {
    if (generation !== state.socketGen) return;
    setOnline(false);
    reconnectTimer = setTimeout(() => openSocket(generation, hostIndex + 1), 1500);
  };
}

async function refreshTail(generation, interval) {
  try {
    const raw = await window.monitor.fetchKlines({
      symbol: state.symbol,
      interval,
      limit: 2,
    });
    if (generation !== state.loadId || interval !== state.interval) return;
    parseKlines(raw).forEach(applyBar);
    refreshDayOpen(generation);
  } catch {
    // The live socket is the primary feed. Polling is only a backup.
  }
}

async function load(interval) {
  state.loadId += 1;
  const generation = state.loadId;
  state.interval = interval;
  tfBtn.textContent = interval;
  document.title = `${prettySymbol(state.symbol)} · ${interval}`;
  showOverlay('กำลังโหลด…', false);
  state.chartReady = false;
  stopSocket();
  try {
    const raw = await window.monitor.fetchKlines({
      symbol: state.symbol,
      interval,
      limit: FETCH_LIMIT,
    });
    if (generation !== state.loadId) return;
    await window.monitor.updateSettings({ interval });
    if (generation !== state.loadId) return;
    const sample = raw[raw.length - 1]?.[4];
    state.precision = pricePrecision(sample == null ? '0.00' : sample);
    const format = priceFormat();
    candleSeries.applyOptions({ priceFormat: format });
    sma5Series.applyOptions({ priceFormat: format });
    sma200Series.applyOptions({ priceFormat: format });
    state.history = parseKlines(raw);
    state.dayOpen = null;
    pushSeries(true);
    refreshDayOpen(generation);
    hideOverlay();
    connectSocket();
    clearInterval(pollTimer);
    pollTimer = setInterval(() => refreshTail(generation, interval), 10000);
  } catch (error) {
    if (generation !== state.loadId) return;
    console.error(error);
    setOnline(false);
    showOverlay('เชื่อมต่อ Binance ไม่สำเร็จ', true);
  }
}

function sizeIsActive(size) {
  return Math.abs(window.innerWidth - size) < 2
    && Math.abs(window.innerHeight - (size + state.headerHeight)) < 4;
}

function menuRow(label, checked, onClick, extraClass, hint) {
  const button = document.createElement('button');
  button.type = 'button';
  if (extraClass) button.className = extraClass;
  const name = document.createElement('span');
  name.textContent = label;
  const mark = document.createElement('span');
  mark.className = 'mark';
  mark.textContent = hint || (checked ? '✓' : '');
  button.append(name, mark);
  button.addEventListener('click', onClick);
  return button;
}

function separator() {
  const line = document.createElement('div');
  line.className = 'sep';
  return line;
}

const menuPoint = { x: 4, y: 4 };
let panels = [
  { symbol: 'XRPUSDT', label: 'XRP', open: true },
  { symbol: 'BTCUSDT', label: 'BTC', open: true },
];

function menuCaption(text) {
  const caption = document.createElement('div');
  caption.className = 'menu-caption';
  caption.textContent = text;
  return caption;
}

function showMenu(panel) {
  menu.replaceChildren();
  if (panel === 'time') renderTimePanel();
  else if (panel === 'size') renderSizePanel();
  else renderRootPanel();
  menu.hidden = false;
  menu.style.maxHeight = `${Math.max(120, window.innerHeight - 8)}px`;
  const maxX = window.innerWidth - menu.offsetWidth - 4;
  const maxY = window.innerHeight - menu.offsetHeight - 4;
  menu.style.left = `${Math.max(4, Math.min(menuPoint.x, maxX))}px`;
  menu.style.top = `${Math.max(4, Math.min(menuPoint.y, maxY))}px`;
}

function backRow(title) {
  return menuRow(`‹  ${title}`, false, () => showMenu('root'), 'back-row');
}

function renderRootPanel() {
  menu.append(menuRow('ไทม์เฟรม', false, () => showMenu('time'), '', '›'));
  menu.append(menuRow('ขนาดกราฟ', false, () => showMenu('size'), '', '›'));
  menu.append(menuRow('รีเซ็ตตำแหน่งแท่งราคา', false, () => {
    closeMenu();
    resetPricePosition();
  }));
  menu.append(separator());
  menu.append(menuRow('หน้าต่างอิสระ', state.independent, () => {
    closeMenu();
    window.monitor.setIndependent(!state.independent);
  }));
  menu.append(menuRow('ชิดขอบขวา', !state.independent, () => {
    closeMenu();
    window.monitor.redock();
  }));
  menu.append(menuRow('อยู่บนสุดเสมอ', state.alwaysOnTop, () => {
    closeMenu();
    window.monitor.setAlwaysOnTop(!state.alwaysOnTop);
  }));
  menu.append(separator());
  menu.append(menuCaption('เปิดปิดหน้าต่าง'));
  panels.forEach((panel) => {
    menu.append(menuRow(`หน้าต่าง ${panel.label}`, panel.open, async () => {
      const hideSelf = panel.symbol === state.symbol && panel.open;
      const nextPanels = await window.monitor.setWindowOpen(panel.symbol, !panel.open);
      if (Array.isArray(nextPanels)) panels = nextPanels;
      if (hideSelf) closeMenu();
      else showMenu('root');
    }));
  });
  menu.append(separator());
  menu.append(menuRow('ย่อ', false, () => {
    closeMenu();
    window.monitor.minimize();
  }));
  menu.append(menuRow('ซ่อนหน้าต่างนี้', false, () => {
    closeMenu();
    window.monitor.close();
  }));
}

function renderTimePanel() {
  menu.append(backRow('ไทม์เฟรม'));
  menu.append(separator());
  TIMEFRAMES.forEach((frame) => {
    menu.append(menuRow(
      frame.label,
      frame.id === state.interval,
      () => {
        closeMenu();
        if (frame.id !== state.interval) load(frame.id);
      },
      frame.id === state.interval ? 'active-choice' : '',
    ));
  });
}

function renderSizePanel() {
  menu.append(backRow('ขนาดกราฟ'));
  menu.append(separator());
  SIZES.forEach((size) => {
    menu.append(menuRow(
      `${size} px`,
      sizeIsActive(size),
      () => {
        closeMenu();
        window.monitor.setChartSize(size);
      },
      sizeIsActive(size) ? 'active-choice' : '',
    ));
  });
  const form = document.createElement('form');
  form.className = 'size-form';
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '200';
  input.max = '900';
  input.step = '10';
  input.value = String(Math.round(window.innerWidth));
  const apply = document.createElement('button');
  apply.type = 'submit';
  apply.textContent = 'ใช้';
  form.append(input, apply);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const next = Number(input.value);
    if (Number.isFinite(next)) window.monitor.setChartSize(next);
    closeMenu();
  });
  menu.append(form);
}

function openMenu(x, y) {
  menuPoint.x = x;
  menuPoint.y = y;
  showMenu('root');
}

function closeMenu() {
  menu.hidden = true;
}

const measureEl = document.getElementById('measure');
const measureBox = document.getElementById('measureBox');
const measureLabel = document.getElementById('measureLabel');
let measuring = false;
let measureStart = null;

function chartLocal(event) {
  const rect = chartHost.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function timeToSeconds(time) {
  if (typeof time === 'number') return time;
  if (time && typeof time === 'object' && Number.isFinite(time.year)) {
    return Math.floor(Date.UTC(time.year, time.month - 1, time.day) / 1000);
  }
  return null;
}

function formatSpan(seconds) {
  const abs = Math.abs(Math.round(seconds));
  if (!Number.isFinite(abs) || abs <= 0) return '';
  if (abs < 3600) return `${Math.max(1, Math.round(abs / 60))} นาที`;
  if (abs < 86400) {
    const hours = Math.floor(abs / 3600);
    const minutes = Math.round((abs % 3600) / 60);
    return minutes ? `${hours} ชม. ${minutes} นาที` : `${hours} ชม.`;
  }
  const days = Math.floor(abs / 86400);
  const hours = Math.round((abs % 86400) / 3600);
  return hours ? `${days} วัน ${hours} ชม.` : `${days} วัน`;
}

function hideMeasure() {
  measuring = false;
  measureStart = null;
  measureEl.hidden = true;
  measureEl.classList.remove('up', 'down');
}

function renderMeasure(start, end) {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  measureBox.style.left = `${left}px`;
  measureBox.style.top = `${top}px`;
  measureBox.style.width = `${Math.max(1, Math.abs(end.x - start.x))}px`;
  measureBox.style.height = `${Math.max(1, Math.abs(end.y - start.y))}px`;

  const priceStart = candleSeries.coordinateToPrice(start.y);
  const priceEnd = candleSeries.coordinateToPrice(end.y);
  const logicalStart = chart.timeScale().coordinateToLogical(start.x);
  const logicalEnd = chart.timeScale().coordinateToLogical(end.x);
  const timeStart = timeToSeconds(chart.timeScale().coordinateToTime(start.x));
  const timeEnd = timeToSeconds(chart.timeScale().coordinateToTime(end.x));

  measureEl.classList.remove('up', 'down');
  let text = 'วัดระยะ';
  if (Number.isFinite(priceStart) && Number.isFinite(priceEnd) && priceStart !== 0) {
    const diff = priceEnd - priceStart;
    const pct = (diff / Math.abs(priceStart)) * 100;
    if (diff > 0) measureEl.classList.add('up');
    else if (diff < 0) measureEl.classList.add('down');
    const sign = diff > 0 ? '+' : '';
    const bars = Number.isFinite(logicalStart) && Number.isFinite(logicalEnd)
      ? Math.max(0, Math.round(Math.abs(logicalEnd - logicalStart)))
      : null;
    const span = Number.isFinite(timeStart) && Number.isFinite(timeEnd) ? formatSpan(timeEnd - timeStart) : '';
    text = `${sign}${pct.toFixed(2)}%  ${sign}${formatPrice(diff, state.precision)}`;
    if (bars != null) text += `\n${bars} แท่ง`;
    if (span) text += `, ${span}`;
  }
  measureLabel.textContent = text;
  measureEl.hidden = false;

  const width = measureLabel.offsetWidth;
  const height = measureLabel.offsetHeight;
  let labelLeft = left + measureBox.offsetWidth + 6;
  let labelTop = top;
  if (labelLeft + width > chartWrap.clientWidth - 4) labelLeft = Math.max(4, left - width - 6);
  if (labelTop + height > chartWrap.clientHeight - 4) {
    labelTop = Math.max(4, chartWrap.clientHeight - height - 4);
  }
  measureLabel.style.left = `${labelLeft}px`;
  measureLabel.style.top = `${labelTop}px`;
}

function bindMeasure() {
  chartWrap.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('#overlay button')) return;
    if (!event.shiftKey) {
      if (!measureEl.hidden) hideMeasure();
      return;
    }
    if (!chart || !candleSeries || !state.chartReady) return;
    event.preventDefault();
    event.stopPropagation();
    measuring = true;
    measureStart = chartLocal(event);
    chartWrap.setPointerCapture(event.pointerId);
    renderMeasure(measureStart, measureStart);
  }, true);

  chartWrap.addEventListener('pointermove', (event) => {
    if (!measuring || !measureStart) return;
    renderMeasure(measureStart, chartLocal(event));
  });

  const finish = (event) => {
    if (!measuring || !measureStart) return;
    renderMeasure(measureStart, chartLocal(event));
    measuring = false;
    measureStart = null;
  };
  chartWrap.addEventListener('pointerup', finish);
  chartWrap.addEventListener('pointercancel', hideMeasure);

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Shift') chartWrap.classList.add('measure-ready');
    if (event.key === 'Escape') hideMeasure();
  });
  window.addEventListener('keyup', (event) => {
    if (event.key === 'Shift') chartWrap.classList.remove('measure-ready');
  });
  window.addEventListener('blur', () => chartWrap.classList.remove('measure-ready'));
}

function bindDockDrag() {
  const header = document.getElementById('header');
  let dragging = false;
  header.addEventListener('pointerdown', (event) => {
    if (state.independent || event.button !== 0) return;
    if (event.target.closest('button')) return;
    dragging = true;
    header.setPointerCapture(event.pointerId);
    window.monitor.dockDragStart();
  });
  header.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    window.monitor.dockDragMove(event.screenY);
  });
  const finish = () => {
    if (!dragging) return;
    dragging = false;
    window.monitor.dockDragEnd();
  };
  header.addEventListener('pointerup', finish);
  header.addEventListener('pointercancel', finish);
}

function bindUi() {
  bindMeasure();
  bindDockDrag();
  tfBtn.addEventListener('click', (event) => {
    const rect = tfBtn.getBoundingClientRect();
    openMenu(rect.left, rect.bottom + 4);
    event.stopPropagation();
  });
  document.getElementById('minBtn').addEventListener('click', () => window.monitor.minimize());
  document.getElementById('closeBtn').addEventListener('click', () => window.monitor.close());
  retryBtn.addEventListener('click', () => load(state.interval));
  window.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (menu.contains(event.target)) return;
    openMenu(event.clientX, event.clientY);
  }, true);
  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (menu.hidden || menu.contains(event.target) || event.target === tfBtn) return;
    closeMenu();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });
  window.monitor.onState(applyWindowState);
  window.monitor.onPanels((next) => {
    if (Array.isArray(next)) panels = next;
  });
}

async function main() {
  if (!window.LightweightCharts || !window.Indicators) {
    showOverlay('ไม่พบไลบรารีกราฟ', false);
    return;
  }
  const saved = await window.monitor.getState();
  if (!saved || !saved.symbol) {
    showOverlay('เปิดหน้าต่างไม่สำเร็จ', false);
    return;
  }
  state.symbol = saved.symbol;
  state.interval = saved.interval || '15m';
  const loadedPanels = await window.monitor.getPanels();
  if (Array.isArray(loadedPanels)) panels = loadedPanels;
  applyWindowState(saved);
  symbolEl.textContent = prettySymbol(state.symbol);
  accentEl.style.background = ACCENTS[state.symbol] || '#8b97a8';
  document.body.dataset.symbol = state.symbol;
  tfBtn.textContent = state.interval;
  buildChart();
  bindUi();
  await load(state.interval);
}

main();
