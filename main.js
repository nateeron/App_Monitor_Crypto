const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const SYMBOLS = ['XRPUSDT', 'BTCUSDT'];
const LABELS = { XRPUSDT: 'XRP', BTCUSDT: 'BTC' };
const INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'];
const HEADER_HEIGHT = 30;
const BINANCE_HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];

const windows = new Map();
let dockTop = null;
let dockSize = 300;
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
    const data = { dockTop, dockSize };
    for (const [symbol, entry] of windows) data[symbol] = entry.state;
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

function loadShared(saved) {
  const storedSize = Number(saved.dockSize);
  const windowSize = Number(saved.XRPUSDT?.chartSize ?? saved.BTCUSDT?.chartSize);
  const size = Number.isFinite(storedSize) ? storedSize : windowSize;
  dockSize = clamp(Math.round(Number.isFinite(size) ? size : 300), 200, 900);
  const top = Number(saved.dockTop);
  dockTop = Number.isFinite(top) ? top : null;
  if (SYMBOLS.every((symbol) => saved[symbol]?.hidden)) {
    for (const symbol of SYMBOLS) {
      if (saved[symbol] && typeof saved[symbol] === 'object') saved[symbol].hidden = false;
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
  return SYMBOLS
    .map((symbol) => windows.get(symbol))
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

    const width = dockSize;
    const height = dockSize + HEADER_HEIGHT;
    const { minTop, maxTop } = stackRange(height * docked.length, area);
    let top = Number.isFinite(preferredTop) ? preferredTop : dockTop;
    if (!Number.isFinite(top)) top = area.y;
    top = clamp(Math.round(top), Math.min(minTop, maxTop), Math.max(minTop, maxTop));
    dockTop = top;

    const x = Math.round(area.x + area.width - width);
    docked.forEach((entry) => {
      const next = { x, y: top, width, height };
      entry.state.chartSize = dockSize;
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
  return { ...entry.state, symbol: entry.symbol, headerHeight: HEADER_HEIGHT };
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

function createChartWindow(symbol, saved) {
  const state = normalizeState(saved);
  if (!state.independent) {
    state.chartSize = dockSize;
    state.width = dockSize;
    state.height = dockSize + HEADER_HEIGHT;
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
    title: symbol,
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
  const entry = { symbol, win, state, ready: false };
  windows.set(symbol, entry);

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error('failed to load', code, description, url);
  });
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) console.error(`[${symbol}] ${message}`);
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
    const fromWidth = bounds.width;
    const fromHeight = bounds.height - HEADER_HEIGHT;
    const chosen = Math.abs(fromWidth - dockSize) >= Math.abs(fromHeight - dockSize) ? fromWidth : fromHeight;
    const nextSize = clamp(Math.round(chosen), 200, 900);
    if (Math.abs(nextSize - dockSize) <= 1) {
      layoutDocked(dockTop);
      return;
    }
    dockSize = nextSize;
    layoutDocked(dockTop);
    saveConfig();
  });
  win.on('closed', () => {
    windows.delete(symbol);
    layoutDocked();
  });

  win.once('ready-to-show', () => {
    entry.ready = true;
    revealWhenReady();
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

function panelSnapshot() {
  return SYMBOLS.map((symbol) => {
    const entry = windows.get(symbol);
    return {
      symbol,
      label: LABELS[symbol] || symbol,
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
    ...SYMBOLS.map((symbol) => ({
      label: LABELS[symbol] || symbol,
      type: 'checkbox',
      checked: !windows.get(symbol)?.state.hidden,
      click: () => setWindowShown(symbol, Boolean(windows.get(symbol)?.state.hidden)),
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
    SYMBOLS.forEach((symbol) => setWindowShown(symbol, true));
  });
  refreshTray();
}

function setWindowShown(symbol, shown) {
  const entry = windows.get(symbol);
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
  if (!SYMBOLS.every((symbol) => windows.get(symbol)?.ready)) return;
  layoutDocked(dockTop);
  for (const symbol of SYMBOLS) {
    const entry = windows.get(symbol);
    if (!entry || entry.win.isDestroyed() || entry.state.hidden || entry.win.isVisible()) continue;
    if (entry.state.independent) ensureOnScreen(entry.win);
    entry.win.show();
  }
  ensureTray();
  broadcastPanels();
}

async function fetchKlines(symbol, interval, limit) {
  const query = `/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
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
    const next = clamp(Math.round(Number(size)), 200, 900);
    if (!entry || !Number.isFinite(next)) return null;
    if (entry.state.independent) {
      const bounds = entry.win.getContentBounds();
      entry.state.chartSize = next;
      entry.state.width = next;
      entry.state.height = next + HEADER_HEIGHT;
      markIgnore(entry.win);
      entry.win.setContentBounds({
        x: bounds.x,
        y: bounds.y,
        width: entry.state.width,
        height: entry.state.height,
      });
    } else {
      dockSize = next;
      layoutDocked(dockTop);
    }
    saveConfig();
    publish(entry);
    return publicState(entry);
  });

  ipcMain.handle('get-panels', () => panelSnapshot());

  ipcMain.handle('set-window-open', (_event, symbol, open) => {
    if (!SYMBOLS.includes(symbol)) return panelSnapshot();
    setWindowShown(symbol, Boolean(open));
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
    if (entry) setWindowShown(entry.symbol, false);
  });

  ipcMain.handle('fetch-klines', async (event, params) => {
    const entry = entryFromEvent(event);
    if (!entry || !params) throw new Error('missing request');
    const { symbol, interval } = params;
    const limit = clamp(Math.round(Number(params.limit) || 699), 1, 1000);
    if (symbol !== entry.symbol) throw new Error('symbol mismatch');
    if (!INTERVALS.includes(interval)) throw new Error('bad interval');
    return fetchKlines(symbol, interval, limit);
  });
}

function start() {
  app.setAppUserModelId('crypto.monitor.charts');
  const saved = readConfig();
  loadShared(saved);
  registerIpc();
  for (const symbol of SYMBOLS) createChartWindow(symbol, saved[symbol]);
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
    for (const symbol of SYMBOLS) setWindowShown(symbol, true);
  });
  app.whenReady().then(start);
  app.on('window-all-closed', () => app.quit());
}
