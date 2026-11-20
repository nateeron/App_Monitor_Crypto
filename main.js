const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'];
const HEADER_HEIGHT = 30;
const BINANCE_HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];
const DEFAULT_WATCH = [
  { id: 'binance:XRPUSDT', source: 'binance', symbol: 'XRPUSDT', label: 'XRP' },
  { id: 'binance:BTCUSDT', source: 'binance', symbol: 'BTCUSDT', label: 'BTC' },
];
const YAHOO_BARS = {
  '1m': { interval: '1m', seconds: 60, lookback: 7 * 86400 },
  '3m': { interval: '1m', seconds: 60, bucket: 180, lookback: 7 * 86400 },
  '5m': { interval: '5m', seconds: 300, lookback: 59 * 86400 },
  '15m': { interval: '15m', seconds: 900, lookback: 59 * 86400 },
  '30m': { interval: '30m', seconds: 1800, lookback: 59 * 86400 },
  '1h': { interval: '60m', seconds: 3600, lookback: 730 * 86400 },
  '2h': { interval: '60m', seconds: 3600, bucket: 7200, lookback: 730 * 86400 },
  '4h': { interval: '60m', seconds: 3600, bucket: 14400, lookback: 730 * 86400 },
  '1d': { interval: '1d', seconds: 86400, lookback: 20 * 365 * 86400 },
};

const windows = new Map();
let watchlist = DEFAULT_WATCH.map((item) => ({ ...item }));
let dockTop = null;
let dockWidth = 300;
let dockHeight = 300;
let tray = null;
let dragSession = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function configPath() {
  return path.join(app.getPath('userData'), 'monitor-config.json');
}

function readConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

let saveTimer = null;
function saveConfig() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const data = { dockTop, dockWidth, dockHeight, watchlist, windows: {} };
    for (const [id, entry] of windows) data.windows[id] = entry.state;
    try {
      fs.mkdirSync(path.dirname(configPath()), { recursive: true });
      fs.writeFileSync(configPath(), JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('save config failed', error);
    }
  }, 150);
}

function normalizeState(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const chartSize = clamp(Math.round(Number(src.chartSize) || 300), 200, 900);
  const width = clamp(Math.round(Number(src.width) || chartSize), 200, 1600);
  const height = clamp(Math.round(Number(src.height) || chartSize + HEADER_HEIGHT), 230, 1600);
  const x = Number(src.x);
  const y = Number(src.y);
  return {
    interval: INTERVALS.includes(src.interval) ? src.interval : '15m',
    chartSize,
    width,
    height,
    independent: Boolean(src.independent),
    alwaysOnTop: src.alwaysOnTop !== false,
    hidden: Boolean(src.hidden),
    x: Number.isFinite(x) ? x : null,
    y: Number.isFinite(y) ? y : null,
  };
}

function normalizeSymbol(source, raw) {
  const text = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (source === 'binance') {
    const symbol = text.endsWith('USDT') ? text : `${text}USDT`;
    return /^[A-Z0-9]{5,20}$/.test(symbol) ? symbol : null;
  }
  return /^[A-Z0-9^=.\-]{1,16}$/.test(text) ? text : null;
}

function defaultLabel(source, symbol) {
  if (source === 'binance') return symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol;
  if (symbol === 'GC=F') return 'ทอง';
  if (symbol === 'GLD') return 'GLD';
  return symbol;
}

function normalizeWatch(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw.source === 'yahoo' ? 'yahoo' : 'binance';
  const symbol = normalizeSymbol(source, raw.symbol);
  if (!symbol) return null;
  const label = String(raw.label || defaultLabel(source, symbol)).trim().slice(0, 16);
  return { id: `${source}:${symbol}`, source, symbol, label: label || defaultLabel(source, symbol) };
}

function loadWatchlist(saved) {
  const raw = Array.isArray(saved.watchlist) ? saved.watchlist : DEFAULT_WATCH;
  const seen = new Set();
  watchlist = [];
  for (const item of raw.map(normalizeWatch).filter(Boolean)) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    watchlist.push(item);
  }
  if (!watchlist.length) watchlist = DEFAULT_WATCH.map((item) => ({ ...item }));
}

function savedStateFor(saved, item) {
  const stored = saved.windows && saved.windows[item.id];
  if (stored) return stored;
  if (item.source === 'binance' && saved[item.symbol]) return saved[item.symbol];
  return {};
}

function loadShared(saved) {
  const legacy = Number(saved.dockSize);
  const width = Number(saved.dockWidth);
  const height = Number(saved.dockHeight);
  dockWidth = clamp(Math.round(Number.isFinite(width) ? width : (Number.isFinite(legacy) ? legacy : 300)), 200, 1600);
  dockHeight = clamp(Math.round(Number.isFinite(height) ? height : (Number.isFinite(legacy) ? legacy : 300)), 200, 900);
  const top = Number(saved.dockTop);
  dockTop = Number.isFinite(top) ? top : null;
  const states = watchlist.map((item) => savedStateFor(saved, item));
  if (states.length && states.every((state) => state.hidden)) {
    for (const item of watchlist) {
      const state = savedStateFor(saved, item);
      if (state && typeof state === 'object') state.hidden = false;
    }
  }
}

function markIgnore(win) {
  win.ignoreLayout = (win.ignoreLayout || 0) + 1;
  setTimeout(() => {
    win.ignoreLayout = Math.max(0, (win.ignoreLayout || 1) - 1);
  }, 250);
}

function sameBounds(current, next) {
  return Math.abs(current.x - next.x) <= 1
    && Math.abs(current.y - next.y) <= 1
    && Math.abs(current.width - next.width) <= 1
    && Math.abs(current.height - next.height) <= 1;
}

function dockedEntries() {
  return watchlist
    .map((item) => windows.get(item.id))
    .filter((entry) => entry && !entry.win.isDestroyed() && !entry.state.independent && !entry.state.hidden);
}

function stackRange(totalHeight, area) {
  const overflow = totalHeight - area.height;
  return {
    minTop: Math.round(area.y - Math.max(0, overflow)),
    maxTop: Math.round(area.y + Math.max(0, area.height - totalHeight)),
  };
}

let layingOut = false;
function layoutDocked(preferredTop) {
  if (layingOut) return;
  layingOut = true;
  try {
    const area = screen.getPrimaryDisplay().workArea;
    const docked = dockedEntries();
    if (!docked.length) return;

    const sizes = docked.map((entry) => ({
      width: clamp(entry.state.width || dockWidth, 200, area.width),
      height: clamp(entry.state.height || dockHeight + HEADER_HEIGHT, HEADER_HEIGHT + 200, area.height),
    }));
    const totalHeight = sizes.reduce((sum, size) => sum + size.height, 0);
    const { minTop, maxTop } = stackRange(totalHeight, area);
    let top = Number.isFinite(preferredTop) ? preferredTop : dockTop;
    if (!Number.isFinite(top)) top = area.y;
    top = clamp(Math.round(top), Math.min(minTop, maxTop), Math.max(minTop, maxTop));
    dockTop = top;

    docked.forEach((entry, index) => {
      const { width, height } = sizes[index];
      const x = Math.round(area.x + area.width - width);
      const next = { x, y: top, width, height };
      entry.state.chartSize = width;
      entry.state.width = width;
      entry.state.height = height;
      entry.state.x = x;
      entry.state.y = top;
      const bounds = entry.win.getContentBounds();
      if (!sameBounds(bounds, next)) {
        markIgnore(entry.win);
        entry.win.setContentBounds(next);
      }
      top += height;
    });
  } finally {
    layingOut = false;
  }
}

function ensureOnScreen(win) {
  const bounds = win.getContentBounds();
  const visible = screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    return cx >= area.x && cx <= area.x + area.width && cy >= area.y && cy <= area.y + area.height;
  });
  if (visible) return;
  const area = screen.getPrimaryDisplay().workArea;
  markIgnore(win);
  win.setContentPosition(area.x + 24, area.y + 24);
}

function publish(entry) {
  if (entry.win.isDestroyed()) return;
  entry.win.webContents.send('state', publicState(entry));
}

function publicState(entry) {
  return {
    ...entry.state,
    id: entry.id,
    symbol: entry.symbol,
    source: entry.source,
    label: entry.label,
    headerHeight: HEADER_HEIGHT,
  };
}

function entryFromEvent(event) {
  for (const entry of windows.values()) {
    if (entry.win.webContents === event.sender) return entry;
  }
  return null;
}

function readAppIcon() {
  const image = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
  return image.isEmpty() ? null : image;
}

function windowIconPath() {
  const pngPath = path.join(__dirname, 'icon.png');
  try {
    const png = fs.readFileSync(pngPath);
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);
    const entry = Buffer.alloc(16);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(22, 12);
    const icoPath = path.join(app.getPath('userData'), 'app-icon.ico');
    fs.writeFileSync(icoPath, Buffer.concat([header, entry, png]));
    return icoPath;
  } catch (error) {
    console.error('app icon failed', error);
    return pngPath;
  }
}

function createChartWindow(item, saved) {
  const state = normalizeState(saved);
  if (!state.independent) {
    state.width = clamp(state.width || dockWidth, 200, 1600);
    state.height = clamp(state.height || dockHeight + HEADER_HEIGHT, HEADER_HEIGHT + 200, 1200);
    state.chartSize = state.width;
  }
  const options = {
    width: state.width,
    height: state.height,
    useContentSize: true,
    minWidth: 200,
    minHeight: HEADER_HEIGHT + 200,
    show: false,
    frame: false,
    thickFrame: true,
    roundedCorners: false,
    transparent: false,
    resizable: true,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    hasShadow: true,
    backgroundColor: '#0b0e11',
    title: item.label,
    icon: windowIconPath(),
    alwaysOnTop: state.alwaysOnTop,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
  if (state.independent && state.x != null && state.y != null) {
    options.x = state.x;
    options.y = state.y;
  }

  const win = new BrowserWindow(options);
  win.setAlwaysOnTop(state.alwaysOnTop, 'floating');
  win.setMenuBarVisibility(false);
  const entry = { id: item.id, symbol: item.symbol, source: item.source, label: item.label, win, state, ready: false };
  windows.set(item.id, entry);

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error('failed to load', code, description, url);
  });
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) console.error(`[${item.label}] ${message}`);
  });

  win.on('maximize', () => win.unmaximize());
  win.on('move', () => {
    if (win.ignoreLayout || layingOut || state.independent) return;
    layoutDocked(dockTop);
  });
  win.on('moved', () => {
    if (win.ignoreLayout || !state.independent) return;
    const bounds = win.getContentBounds();
    state.x = bounds.x;
    state.y = bounds.y;
    saveConfig();
  });
  win.on('resized', () => {
    if (win.ignoreLayout || layingOut) return;
    const bounds = win.getContentBounds();
    if (state.independent) {
      state.width = bounds.width;
      state.height = bounds.height;
      state.x = bounds.x;
      state.y = bounds.y;
      saveConfig();
      return;
    }
    state.width = clamp(Math.round(bounds.width), 200, 1600);
    state.height = clamp(Math.round(bounds.height), HEADER_HEIGHT + 200, 1200);
    state.chartSize = state.width;
    layoutDocked(dockTop);
    saveConfig();
  });
  win.on('closed', () => {
    if (entry.removing) return;
    windows.delete(item.id);
    layoutDocked();
  });

  win.once('ready-to-show', () => {
    entry.ready = true;
    revealWhenReady();
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  return entry;
}

function panelSnapshot() {
  return watchlist.map((item) => {
    const entry = windows.get(item.id);
    return {
      id: item.id,
      symbol: item.symbol,
      label: item.label,
      open: Boolean(entry && !entry.state.hidden),
    };
  });
}

function broadcastPanels() {
  const panels = panelSnapshot();
  for (const entry of windows.values()) {
    if (!entry.win.isDestroyed()) entry.win.webContents.send('panels', panels);
  }
}

function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    ...watchlist.map((item) => ({
      label: item.label,
      type: 'checkbox',
      checked: !windows.get(item.id)?.state.hidden,
      click: () => setWindowShown(item.id, Boolean(windows.get(item.id)?.state.hidden)),
    })),
    { type: 'separator' },
    { label: 'ออก', click: () => app.quit() },
  ]));
}

function createTrayIcon() {
  const image = readAppIcon();
  if (image) return image.resize({ width: 32, height: 32, quality: 'best' });
  const size = 16;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const edge = x < 1 || y < 1 || x > size - 2 || y > size - 2;
      pixels[i] = edge ? 17 : 0;
      pixels[i + 1] = edge ? 23 : 152;
      pixels[i + 2] = edge ? 14 : 255;
      pixels[i + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size });
}

function ensureTray() {
  if (tray) return;
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Crypto Monitor');
  tray.on('double-click', () => {
    watchlist.forEach((item) => setWindowShown(item.id, true));
  });
  refreshTray();
}

function setWindowShown(id, shown) {
  const entry = windows.get(id);
  if (!entry || entry.win.isDestroyed()) return null;
  entry.state.hidden = !shown;
  if (shown) {
    if (!entry.state.independent) layoutDocked(dockTop);
    else ensureOnScreen(entry.win);
    if (entry.win.isMinimized()) entry.win.restore();
    entry.win.show();
  } else {
    entry.win.hide();
    layoutDocked(dockTop);
  }
  saveConfig();
  broadcastPanels();
  refreshTray();
  return publicState(entry);
}

function revealWhenReady() {
  if (!watchlist.every((item) => windows.get(item.id)?.ready)) return;
  layoutDocked(dockTop);
  for (const item of watchlist) {
    const entry = windows.get(item.id);
    if (!entry || entry.win.isDestroyed() || entry.state.hidden || entry.win.isVisible()) continue;
    if (entry.state.independent) ensureOnScreen(entry.win);
    entry.win.show();
  }
  ensureTray();
  broadcastPanels();
}

function bucketRows(rows, seconds) {
  const buckets = new Map();
  for (const row of rows) {
    const openSec = Math.floor(Number(row[0]) / 1000 / seconds) * seconds;
    const current = buckets.get(openSec);
    if (!current) {
      buckets.set(openSec, [openSec * 1000, row[1], row[2], row[3], row[4]]);
      continue;
    }
    current[2] = String(Math.max(Number(current[2]), Number(row[2])));
    current[3] = String(Math.min(Number(current[3]), Number(row[3])));
    current[4] = row[4];
  }
  return [...buckets.values()];
}

async function fetchBinance(symbol, interval, limit, endTime) {
  const params = new URLSearchParams({
    symbol,
    interval,
    limit: String(limit),
  });
  if (endTime != null) params.set('endTime', String(endTime));
  const query = `/api/v3/klines?${params.toString()}`;
  let lastError = null;
  for (const host of BINANCE_HOSTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${host}${query}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'CryptoMonitor/1.0' },
      });
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      const data = await response.json();
      if (!Array.isArray(data)) {
        lastError = new Error('unexpected payload');
        continue;
      }
      return data;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('Binance unavailable');
}

async function fetchYahoo(symbol, interval, limit, endTime) {
  const spec = YAHOO_BARS[interval];
  if (!spec) throw new Error('bad interval');
  const period2 = endTime != null ? Math.floor(endTime / 1000) : Math.floor(Date.now() / 1000);
  const multiplier = spec.bucket ? spec.bucket / spec.seconds : 1;
  const barsNeeded = Math.ceil(limit * multiplier) + 4;
  const period1 = Math.max(period2 - barsNeeded * spec.seconds, period2 - spec.lookback);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${spec.interval}&period1=${Math.floor(period1)}&period2=${period2}&includePrePost=false`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const result = payload?.chart?.result?.[0];
    if (!result) throw new Error(payload?.chart?.error?.description || 'ไม่พบข้อมูล');
    const times = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};
    const rows = [];
    for (let index = 0; index < times.length; index += 1) {
      const open = Number(quote.open?.[index]);
      const high = Number(quote.high?.[index]);
      const low = Number(quote.low?.[index]);
      const close = Number(quote.close?.[index]);
      if (![open, high, low, close].every(Number.isFinite)) continue;
      rows.push([times[index] * 1000, String(open), String(high), String(low), String(close)]);
    }
    const bucketed = spec.bucket ? bucketRows(rows, spec.bucket) : rows;
    const sliced = bucketed.slice(-limit);
    if (!sliced.length) throw new Error('ไม่พบข้อมูล');
    return sliced;
  } finally {
    clearTimeout(timer);
  }
}

function fetchKlinesFor(item, interval, limit, endTime) {
  if (item.source === 'yahoo') return fetchYahoo(item.symbol, interval, limit, endTime);
  return fetchBinance(item.symbol, interval, limit, endTime);
}

function registerIpc() {
  ipcMain.handle('get-state', (event) => {
    const entry = entryFromEvent(event);
    return entry ? publicState(entry) : null;
  });

  ipcMain.handle('update-settings', (event, partial) => {
    const entry = entryFromEvent(event);
    if (!entry || !partial || typeof partial !== 'object') return null;
    if (INTERVALS.includes(partial.interval)) {
      entry.state.interval = partial.interval;
      saveConfig();
    }
    publish(entry);
    return publicState(entry);
  });

  ipcMain.handle('set-chart-size', (event, size) => {
    const entry = entryFromEvent(event);
    const width = clamp(Math.round(Number(size?.width ?? size)), 200, 1600);
    const height = clamp(Math.round(Number(size?.height ?? size)), 200, 900);
    if (!entry || !Number.isFinite(width) || !Number.isFinite(height)) return null;
    if (entry.state.independent) {
      const bounds = entry.win.getContentBounds();
      entry.state.chartSize = width;
      entry.state.width = width;
      entry.state.height = height + HEADER_HEIGHT;
      markIgnore(entry.win);
      entry.win.setContentBounds({
        x: bounds.x,
        y: bounds.y,
        width: entry.state.width,
        height: entry.state.height,
      });
    } else {
      entry.state.chartSize = width;
      entry.state.width = width;
      entry.state.height = height + HEADER_HEIGHT;
      layoutDocked(dockTop);
    }
    saveConfig();
    publish(entry);
    return publicState(entry);
  });

  ipcMain.handle('get-panels', () => panelSnapshot());

  ipcMain.handle('set-window-open', (_event, id, open) => {
    if (!watchlist.some((item) => item.id === id)) return panelSnapshot();
    setWindowShown(id, Boolean(open));
    return panelSnapshot();
  });

  ipcMain.on('dock-drag-start', (event) => {
    const entry = entryFromEvent(event);
    if (!entry || entry.state.independent || entry.state.hidden) return;
    dragSession = {
      id: event.sender.id,
      startScreenY: null,
      startTop: Number.isFinite(dockTop) ? dockTop : screen.getPrimaryDisplay().workArea.y,
    };
  });

  ipcMain.on('dock-drag-move', (event, screenY) => {
    if (!dragSession || dragSession.id !== event.sender.id || !Number.isFinite(screenY)) return;
    if (dragSession.startScreenY == null) {
      dragSession.startScreenY = screenY;
      return;
    }
    layoutDocked(dragSession.startTop + (screenY - dragSession.startScreenY));
  });

  ipcMain.on('dock-drag-end', (event) => {
    if (!dragSession || dragSession.id !== event.sender.id) return;
    dragSession = null;
    saveConfig();
  });

  ipcMain.handle('set-independent', (event, value) => {
    const entry = entryFromEvent(event);
    if (!entry) return null;
    entry.state.independent = Boolean(value);
    const bounds = entry.win.getContentBounds();
    entry.state.x = bounds.x;
    entry.state.y = bounds.y;
    if (entry.state.independent) {
      entry.state.width = bounds.width;
      entry.state.height = bounds.height;
      ensureOnScreen(entry.win);
      layoutDocked(dockTop);
    } else {
      layoutDocked(dockTop);
    }
    saveConfig();
    publish(entry);
    return publicState(entry);
  });

  ipcMain.handle('set-always-on-top', (event, value) => {
    const entry = entryFromEvent(event);
    if (!entry) return null;
    entry.state.alwaysOnTop = Boolean(value);
    entry.win.setAlwaysOnTop(entry.state.alwaysOnTop, 'floating');
    saveConfig();
    publish(entry);
    return publicState(entry);
  });

  ipcMain.handle('redock', (event) => {
    const entry = entryFromEvent(event);
    if (!entry) return null;
    entry.state.independent = false;
    layoutDocked(dockTop);
    saveConfig();
    publish(entry);
    return publicState(entry);
  });

  ipcMain.handle('window-minimize', (event) => {
    entryFromEvent(event)?.win.minimize();
  });

  ipcMain.handle('window-close', (event) => {
    const entry = entryFromEvent(event);
    if (entry) setWindowShown(entry.id, false);
  });

  ipcMain.handle('add-watch', async (_event, raw) => {
    const item = normalizeWatch(raw);
    if (!item) throw new Error('สัญลักษณ์ไม่ถูกต้อง');
    const existing = watchlist.find((entry) => entry.id === item.id);
    if (existing) {
      setWindowShown(existing.id, true);
      return panelSnapshot();
    }
    if (watchlist.length >= 12) throw new Error('เพิ่มได้ไม่เกิน 12 รายการ');
    await fetchKlinesFor(item, '1d', 2, null);
    watchlist.push(item);
    createChartWindow(item, {});
    saveConfig();
    broadcastPanels();
    refreshTray();
    return panelSnapshot();
  });

  ipcMain.handle('remove-watch', (event) => {
    const entry = entryFromEvent(event);
    if (!entry || watchlist.length <= 1) return panelSnapshot();
    watchlist = watchlist.filter((item) => item.id !== entry.id);
    entry.removing = true;
    windows.delete(entry.id);
    if (!entry.win.isDestroyed()) entry.win.close();
    saveConfig();
    layoutDocked(dockTop);
    broadcastPanels();
    refreshTray();
    return panelSnapshot();
  });

  ipcMain.handle('fetch-klines', async (event, params) => {
    const entry = entryFromEvent(event);
    if (!entry || !params) throw new Error('missing request');
    const { interval } = params;
    const limit = clamp(Math.round(Number(params.limit) || 699), 1, 1000);
    if (params.symbol !== entry.symbol) throw new Error('symbol mismatch');
    if (!INTERVALS.includes(interval)) throw new Error('bad interval');
    let endTime = null;
    if (params.endTime != null && params.endTime !== '') {
      endTime = Math.round(Number(params.endTime));
      if (!Number.isFinite(endTime) || endTime < 0) throw new Error('bad endTime');
    }
    return fetchKlinesFor(entry, interval, limit, endTime);
  });
}

function start() {
  app.setAppUserModelId('crypto.monitor.charts');
  const saved = readConfig();
  loadWatchlist(saved);
  loadShared(saved);
  registerIpc();
  for (const item of watchlist) createChartWindow(item, savedStateFor(saved, item));
  ensureTray();
  screen.on('display-metrics-changed', () => layoutDocked(dockTop));
  setTimeout(() => {
    layoutDocked(dockTop);
    for (const entry of windows.values()) {
      if (!entry.win.isDestroyed() && !entry.state.hidden && !entry.win.isVisible()) entry.win.show();
    }
    broadcastPanels();
  }, 5000);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    for (const item of watchlist) setWindowShown(item.id, true);
  });
  app.whenReady().then(start);
  app.on('window-all-closed', () => app.quit());
}
