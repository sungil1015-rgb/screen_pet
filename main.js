const { app, BrowserWindow, ipcMain, Tray, Menu, screen, nativeImage, dialog, session } = require('electron');
const fs = require('fs');
const path = require('path');
const Maru = require('./shared');

function argvValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return '';
}

const userDataArg = argvValue('--user-data-dir');
if (userDataArg) app.setPath('userData', userDataArg);
app.setAppUserModelId('com.marupet.app');
app.commandLine.appendSwitch('disable-features', 'Spellcheck');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showStudio());
  app.whenReady().then(boot).catch((err) => {
    console.error(err);
    app.quit();
  });
}

let studioWin = null;
let petWin = null;
let tray = null;
let walker = null;
let petTimer = null;
let loopHz = 0;
let settings = Maru.defaultSettings();
let spriteCache = null;
let spriteRev = 0;
let lastBoundsKey = '';
let lastPoseKey = '';
let lastConfigKey = '';
let lastTop = 0;
let lastPersist = 0;
let petOpening = null;
let quitting = false;
let petReadyWait = null;

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function userSpritePath() {
  return path.join(app.getPath('userData'), 'sprite.bin');
}

function metaPath() {
  return path.join(app.getPath('userData'), 'sprite.meta.json');
}

function demoSpritePath() {
  return path.join(__dirname, 'assets', 'demo-sheet.png');
}

function pngSize(buf) {
  if (!buf || buf.length < 24) return null;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buf.subarray(0, 8).equals(sig)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function resolveSpriteFile() {
  const user = userSpritePath();
  if (fs.existsSync(user)) return user;
  return demoSpritePath();
}

function readSpriteMeta(file) {
  if (file !== userSpritePath()) {
    const size = pngSize(fs.readFileSync(file));
    return { mime: 'image/png', width: size ? size.width : 0, height: size ? size.height : 0 };
  }
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath(), 'utf8'));
    return {
      mime: typeof meta.mime === 'string' ? meta.mime : 'image/png',
      width: meta.width | 0,
      height: meta.height | 0
    };
  } catch (err) {
    return { mime: 'application/octet-stream', width: 0, height: 0 };
  }
}

function loadSpriteInfo() {
  const file = resolveSpriteFile();
  const st = fs.statSync(file);
  if (spriteCache && spriteCache.path === file && spriteCache.mtime === st.mtimeMs && spriteCache.rev === spriteRev) {
    return spriteCache;
  }
  const buf = fs.readFileSync(file);
  const meta = readSpriteMeta(file);
  spriteCache = {
    path: file,
    mtime: st.mtimeMs,
    rev: spriteRev,
    mime: meta.mime,
    width: meta.width,
    height: meta.height,
    dataUrl: 'data:' + meta.mime + ';base64,' + buf.toString('base64')
  };
  return spriteCache;
}

function invalidateSprite() {
  spriteCache = null;
  spriteRev++;
  lastConfigKey = '';
}

function totalFor(next) {
  try {
    const info = loadSpriteInfo();
    const sized = Maru.clampSettings(next || settings, 0);
    return Maru.sheetLayout(info.width, info.height, sized.frameW, sized.frameH).total;
  } catch (err) {
    return 0;
  }
}

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    settings = Maru.clampSettings(raw, 0);
  } catch (err) {
    settings = Maru.defaultSettings();
  }
  settings = Maru.clampSettings(settings, totalFor(settings));
}

function writeSettings() {
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}

function listDisplays() {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    primary: d.id === primary.id,
    width: d.size.width,
    height: d.size.height,
    label: '모니터 ' + (i + 1) + (d.id === primary.id ? ' (주)' : '') + ' ' + d.size.width + '×' + d.size.height
  }));
}

function selectedDisplay() {
  const all = screen.getAllDisplays();
  if (settings.displayId != null) {
    const found = all.find((d) => d.id === settings.displayId);
    if (found) return found;
  }
  return screen.getPrimaryDisplay();
}

function walkMetrics() {
  const display = selectedDisplay();
  const area = display.workArea;
  const dw = settings.frameW * settings.scale;
  const dh = settings.frameH * settings.scale;
  const maxMargin = Math.max(0, Math.floor((area.width - dw) / 2) - 4);
  const margin = Math.min(settings.sideMargin, maxMargin);
  const walkable = Math.max(1, area.width - margin * 2 - dw);
  return {
    area: area,
    margin: margin,
    dw: dw,
    dh: dh,
    walkable: walkable,
    winW: Math.max(1, Math.round(dw)),
    winH: Math.max(1, Math.round(dh + 8))
  };
}

function statePayload() {
  const info = loadSpriteInfo();
  return {
    settings: settings,
    dataUrl: info.dataUrl,
    width: info.width,
    height: info.height,
    displays: listDisplays(),
    petEnabled: !!settings.petEnabled && !!petWin
  };
}

function createStudio() {
  if (studioWin && !studioWin.isDestroyed()) return;
  studioWin = new BrowserWindow({
    width: 980,
    height: 740,
    minWidth: 640,
    minHeight: 560,
    show: false,
    title: '마루펫',
    backgroundColor: '#f3ecdf',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  studioWin.setMenuBarVisibility(false);
  studioWin.on('ready-to-show', () => {
    if (studioWin && !studioWin.isDestroyed()) studioWin.show();
  });
  studioWin.on('close', (e) => {
    if (!app.isQuitting && tray) {
      e.preventDefault();
      studioWin.hide();
      return;
    }
    hidePet();
  });
  const sendVis = (visible) => {
    if (studioWin && !studioWin.isDestroyed()) studioWin.webContents.send('studio:visible', visible);
  };
  studioWin.on('hide', () => sendVis(false));
  studioWin.on('minimize', () => sendVis(false));
  studioWin.on('show', () => sendVis(true));
  studioWin.on('restore', () => sendVis(true));
  studioWin.webContents.on('will-navigate', (e) => e.preventDefault());
  studioWin.loadFile(path.join(__dirname, 'studio.html'));
}

function showStudio() {
  if (!studioWin || studioWin.isDestroyed()) {
    createStudio();
    return;
  }
  if (studioWin.isMinimized()) studioWin.restore();
  if (!studioWin.isVisible()) studioWin.show();
  studioWin.focus();
}

function raisePet() {
  if (!petWin || petWin.isDestroyed()) return;
  try {
    petWin.setAlwaysOnTop(true, 'screen-saver');
  } catch (err) {
    petWin.setAlwaysOnTop(true);
  }
  petWin.setIgnoreMouseEvents(true);
  try { petWin.setSkipTaskbar(true); } catch (err) {}
  try { petWin.setFocusable(false); } catch (err) {}
}

function poseBounds(m, pose) {
  const x = Math.round(m.area.x + m.margin + pose.xRatio * m.walkable);
  const y = Math.round(m.area.y + m.area.height - settings.floorGap - m.winH);
  return { x: x, y: y, width: m.winW, height: m.winH };
}

function movePetWindow(pose) {
  if (!petWin || petWin.isDestroyed()) return;
  const bounds = poseBounds(walkMetrics(), pose);
  const key = bounds.x + ',' + bounds.y + ',' + bounds.width + ',' + bounds.height;
  if (key !== lastBoundsKey) {
    lastBoundsKey = key;
    petWin.setBounds(bounds);
  }
}

function publishPose(pose) {
  if (!petWin || petWin.isDestroyed() || petWin.webContents.isLoading()) return;
  const key = pose.frame + ':' + pose.facing + ':' + pose.bob;
  if (key === lastPoseKey) return;
  lastPoseKey = key;
  petWin.webContents.send('pet:pose', pose);
}

function sendPetConfig(force) {
  if (!petWin || petWin.isDestroyed() || petWin.webContents.isLoading()) return;
  const info = loadSpriteInfo();
  const layout = Maru.sheetLayout(info.width, info.height, settings.frameW, settings.frameH);
  const key = [spriteRev, settings.frameW, settings.frameH, settings.scale, layout.cols, layout.rows, layout.total, info.dataUrl.length].join(':');
  if (!force && key === lastConfigKey) return;
  lastConfigKey = key;
  lastPoseKey = '';
  petWin.webContents.send('pet:config', {
    dataUrl: info.dataUrl,
    frameW: settings.frameW,
    frameH: settings.frameH,
    scale: settings.scale,
    cols: Math.max(1, layout.cols),
    rows: Math.max(1, layout.rows),
    total: layout.total
  });
}

function persistLive() {
  if (walker) {
    const live = walker.exportState();
    settings.xRatio = live.xRatio;
    settings.facing = live.facing;
  }
  try { writeSettings(); } catch (err) { console.error(err); }
}

function stopPetLoop() {
  if (petTimer) clearInterval(petTimer);
  petTimer = null;
  loopHz = 0;
}

function stepPet(dt) {
  if (!walker || !petWin || petWin.isDestroyed()) return;
  const pose = walker.tick(dt, walkMetrics().walkable);
  movePetWindow(pose);
  publishPose(pose);
  const now = Date.now();
  if (now - lastTop > 2000) {
    lastTop = now;
    raisePet();
  }
  if (now - lastPersist > 5000) {
    lastPersist = now;
    persistLive();
  }
}

function ensureLoop() {
  const hz = settings.powerSave ? 10 : 20;
  if (petTimer && loopHz === hz) return;
  stopPetLoop();
  loopHz = hz;
  let last = Date.now();
  petTimer = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(120, now - last);
    last = now;
    stepPet(dt);
  }, Math.round(1000 / hz));
}

function debugStyle() {
  if (!process.argv.includes('--debug-style') || !petWin) return;
  const handle = petWin.getNativeWindowHandle();
  let hwnd = 0n;
  if (handle.length >= 8) hwnd = handle.readBigUInt64LE(0);
  else hwnd = BigInt(handle.readUInt32LE(0));
  console.log('PET_HWND=' + hwnd.toString());
  console.log('PET_READY');
}

function showPetWindow() {
  if (!petWin || petWin.isDestroyed() || petWin.isVisible()) return;
  raisePet();
  petWin.showInactive();
  raisePet();
  setTimeout(raisePet, 50);
  setTimeout(raisePet, 300);
  debugStyle();
}

function hidePet() {
  persistLive();
  stopPetLoop();
  if (petReadyWait) clearTimeout(petReadyWait);
  petReadyWait = null;
  lastBoundsKey = '';
  lastPoseKey = '';
  lastConfigKey = '';
  walker = null;
  if (petWin && !petWin.isDestroyed()) petWin.destroy();
  petWin = null;
}

function openPetWindow() {
  const total = totalFor(settings);
  walker = Maru.createWalker(settings, total);
  const first = walker.tick(0, walkMetrics().walkable);
  const bounds = poseBounds(walkMetrics(), first);
  lastBoundsKey = bounds.x + ',' + bounds.y + ',' + bounds.width + ',' + bounds.height;
  petWin = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    transparent: true,
    frame: false,
    ...(process.platform === 'win32' ? { type: 'toolbar' } : {}),
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    fullscreenable: false,
    hasShadow: false,
    roundedCorners: false,
    thickFrame: false,
    show: false,
    backgroundColor: '#00000000',
    title: '마루펫',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false
    }
  });
  petWin.setMenuBarVisibility(false);
  petWin.on('closed', () => {
    if (petWin) petWin = null;
  });
  petWin.webContents.on('did-finish-load', () => {
    sendPetConfig(true);
    stepPet(0);
  });
  petWin.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('pet load failed', code, desc);
    settings.petEnabled = false;
    hidePet();
    writeSettings();
    broadcastPet(false);
    refreshTray();
  });
  petWin.loadFile(path.join(__dirname, 'pet.html'));
  if (petReadyWait) clearTimeout(petReadyWait);
  petReadyWait = setTimeout(showPetWindow, 3000);
  ensureLoop();
}

function showPet() {
  settings.petEnabled = true;
  if (petWin && !petWin.isDestroyed()) {
    if (!walker) walker = Maru.createWalker(settings, totalFor(settings));
    walker.configure(settings, totalFor(settings), true);
    sendPetConfig(true);
    raisePet();
    if (!petWin.isVisible()) showPetWindow();
    ensureLoop();
    return Promise.resolve();
  }
  if (petOpening) return petOpening;
  petOpening = Promise.resolve().then(openPetWindow).finally(() => {
    petOpening = null;
  });
  return petOpening;
}

function broadcastPet(enabled) {
  if (studioWin && !studioWin.isDestroyed()) {
    studioWin.webContents.send('pet:enabled-changed', !!enabled);
  }
}

function refreshTray() {
  if (!tray) return;
  const enabled = !!settings.petEnabled;
  tray.setToolTip(enabled ? '마루펫 — 떠 있음' : '마루펫 — 내려가 있음');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '스튜디오 열기', click: () => showStudio() },
    { label: enabled ? '내리기' : '띄우기', click: () => setPetEnabled(!enabled) },
    { type: 'separator' },
    { label: '종료', click: () => shutdown() }
  ]));
}

async function setPetEnabled(enabled) {
  if (enabled) {
    settings.petEnabled = true;
    await showPet();
  } else {
    settings.petEnabled = false;
    hidePet();
  }
  writeSettings();
  broadcastPet(settings.petEnabled && !!petWin);
  refreshTray();
  return !!(settings.petEnabled && petWin);
}

function loadTrayImage() {
  const file = path.join(__dirname, 'assets', 'tray.png');
  try {
    const img = nativeImage.createFromPath(file);
    if (!img.isEmpty()) return img;
  } catch (err) {}
  return nativeImage.createEmpty();
}

function createTray() {
  try {
    const img = loadTrayImage();
    if (img.isEmpty()) return;
    tray = new Tray(img);
    tray.on('click', () => showStudio());
    refreshTray();
  } catch (err) {
    console.error(err);
    tray = null;
  }
}

function applyIncoming(incoming) {
  const enabled = settings.petEnabled;
  const place = !!(incoming && incoming.place);
  const next = Maru.clampSettings(incoming, totalFor(incoming || settings));
  next.petEnabled = enabled;
  if (walker && !place) {
    const live = walker.exportState();
    next.xRatio = live.xRatio;
    next.facing = live.facing;
  }
  const hzBefore = settings.powerSave ? 10 : 20;
  settings = next;
  writeSettings();
  if (walker) walker.configure(settings, totalFor(settings), place);
  if (petWin) {
    sendPetConfig(false);
    if (place && walker) movePetWindow(walker.exportState());
    const hz = settings.powerSave ? 10 : 20;
    if (hz !== hzBefore) ensureLoop();
  }
  return settings;
}

function parseDataUrl(dataUrl) {
  const m = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl || '');
  if (!m) return null;
  return { mime: m[1].toLowerCase(), buf: Buffer.from(m[2], 'base64') };
}

function shutdown() {
  if (quitting) return;
  quitting = true;
  app.isQuitting = true;
  persistLive();
  stopPetLoop();
  if (petWin && !petWin.isDestroyed()) petWin.destroy();
  petWin = null;
  if (tray) {
    tray.destroy();
    tray = null;
  }
  app.quit();
}

function boot() {
  try {
    session.defaultSession.setSpellCheckerEnabled(false);
    session.defaultSession.setSpellCheckerDictionaryDownloadURL('http://127.0.0.1:1/');
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      const url = details.url || '';
      if (url.indexOf('.bdic') >= 0 || url.indexOf('gvt1.com') >= 0 || url.indexOf('dictionary') >= 0) {
        callback({ cancel: true });
        return;
      }
      callback({});
    });
  } catch (err) {}
  Menu.setApplicationMenu(null);
  loadSettings();
  if (process.argv.includes('--show-pet')) settings.petEnabled = true;
  writeSettings();
  createStudio();
  createTray();
  if (settings.petEnabled) showPet();
  screen.on('display-metrics-changed', () => {
    if (studioWin && !studioWin.isDestroyed()) {
      studioWin.webContents.send('displays:changed', listDisplays());
    }
    if (petWin) stepPet(0);
  });
  screen.on('display-added', () => {
    if (studioWin && !studioWin.isDestroyed()) studioWin.webContents.send('displays:changed', listDisplays());
  });
  screen.on('display-removed', () => {
    if (studioWin && !studioWin.isDestroyed()) studioWin.webContents.send('displays:changed', listDisplays());
    if (petWin) stepPet(0);
  });
  app.on('activate', () => showStudio());
  app.on('before-quit', () => {
    app.isQuitting = true;
    persistLive();
    stopPetLoop();
  });
  app.on('window-all-closed', () => {
    if (app.isQuitting || !tray) app.quit();
  });
}

ipcMain.handle('state:get', () => statePayload());

ipcMain.handle('settings:save', (_e, incoming) => applyIncoming(incoming));

ipcMain.handle('sprite:set', (_e, payload) => {
  const parsed = parseDataUrl(payload && payload.dataUrl);
  if (!parsed) throw new Error('시트를 읽지 못했습니다');
  const allowed = ['image/png', 'image/webp', 'image/gif', 'image/jpeg', 'image/jpg'];
  if (allowed.indexOf(parsed.mime) < 0) throw new Error('PNG, WEBP, GIF, JPEG만 됩니다');
  if (parsed.buf.length < 16 || parsed.buf.length > 12 * 1024 * 1024) throw new Error('시트 크기가 올바르지 않습니다');
  let width = payload.width | 0;
  let height = payload.height | 0;
  if (parsed.mime === 'image/png') {
    const size = pngSize(parsed.buf);
    if (!size) throw new Error('PNG를 읽지 못했습니다');
    width = size.width;
    height = size.height;
  }
  if (!(width > 0 && height > 0 && width <= 8192 && height <= 8192)) throw new Error('이미지 크기가 올바르지 않습니다');
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(userSpritePath(), parsed.buf);
  fs.writeFileSync(metaPath(), JSON.stringify({ mime: parsed.mime === 'image/jpg' ? 'image/jpeg' : parsed.mime, width: width, height: height }));
  invalidateSprite();
  settings = Maru.clampSettings(settings, totalFor(settings));
  writeSettings();
  if (walker) walker.configure(settings, totalFor(settings), false);
  if (petWin) sendPetConfig(true);
  const info = loadSpriteInfo();
  return { ok: true, width: info.width, height: info.height, dataUrl: info.dataUrl };
});

ipcMain.handle('sprite:clear', () => {
  fs.rmSync(userSpritePath(), { force: true });
  fs.rmSync(metaPath(), { force: true });
  invalidateSprite();
  settings = Maru.clampSettings(settings, totalFor(settings));
  writeSettings();
  if (walker) walker.configure(settings, totalFor(settings), false);
  if (petWin) sendPetConfig(true);
  const info = loadSpriteInfo();
  return { ok: true, width: info.width, height: info.height, dataUrl: info.dataUrl };
});

ipcMain.handle('pet:enabled', (_e, enabled) => setPetEnabled(enabled));

ipcMain.handle('pet:place', (_e, payload) => {
  if (!payload) return settings;
  const ratio = Number(payload.xRatio);
  const face = payload.facing === -1 ? -1 : 1;
  if (Number.isFinite(ratio)) settings.xRatio = Math.max(0, Math.min(1, ratio));
  settings.facing = face;
  if (walker) {
    walker.place(settings.xRatio, settings.facing);
    movePetWindow(walker.exportState());
  }
  writeSettings();
  return settings;
});

ipcMain.handle('app:quit', () => {
  shutdown();
});

ipcMain.on('pet:ready', () => {
  if (petReadyWait) clearTimeout(petReadyWait);
  petReadyWait = null;
  showPetWindow();
});

process.on('uncaughtException', (err) => {
  console.error(err);
  try {
    dialog.showErrorBox('마루펫', err && err.message ? err.message : '알 수 없는 오류');
  } catch (e) {}
});
