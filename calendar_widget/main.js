'use strict';
// 바탕화면 캘린더 위젯 - Electron 메인 프로세스
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, dialog, shell, screen, Tray, Menu, nativeImage } = require('electron');

const DEMO = process.argv.includes('--demo') || process.env.CAL_WIDGET_DEMO === '1';
if (DEMO) app.setPath('userData', path.join(app.getPath('temp'), 'calendar-widget-demo'));

const store = require('./src/store');
const pin = require('./src/desktopPin');
const decor = require('./src/decor');
const backend = DEMO ? require('./src/demo') : require('./src/google');

const MIN_W = 360;
const MIN_H = 440;

let win = null;
let tray = null;
let pinned = false; // 지금 "항상 맨 아래" 고정 중인지
let peek = false; // 트레이에서 "앞으로 가져오기"를 눌러 잠깐 앞에 보여 주는 중인지

decor.registerScheme();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => bringToFront());
}

function visibleBounds(b) {
  if (!b) return null;
  const area = screen.getDisplayMatching(b).workArea;
  const inside =
    b.x < area.x + area.width - 40 && b.x + b.width > area.x + 40 && b.y >= area.y - 10 && b.y < area.y + area.height - 40;
  return inside ? b : null;
}

function prefs() {
  const s = store.getSettings();
  return {
    alwaysOnTop: !!s.alwaysOnTop,
    opacity: Number(s.opacity) || 1,
    bgOpacity: Number.isFinite(Number(s.bgOpacity)) ? Number(s.bgOpacity) : 0.92,
    showHolidays: s.showHolidays !== false,
    readable: s.readable !== false,
    pinDesktop: pinned,
    pinSupported: pin.supported(),
    autostart: app.getLoginItemSettings().openAtLogin,
    packaged: app.isPackaged,
    demo: DEMO,
  };
}

function notifyPrefs() {
  if (win && !win.isDestroyed()) win.webContents.send('prefs:changed', prefs());
  updateTrayMenu();
}

// 바탕화면 고정 켜기/끄기 (항상 위와는 동시에 쓸 수 없음)
function applyPin(on) {
  if (!win) return false;
  if (on) {
    if (!pin.supported()) throw new Error('바탕화면 고정은 윈도우에서만 쓸 수 있습니다.');
    win.setAlwaysOnTop(false);
    store.saveSettings({ alwaysOnTop: false });
    win.setSkipTaskbar(true);
    pinned = pin.attach(win);
    if (!pinned) {
      win.setSkipTaskbar(false);
      throw new Error('바탕화면 고정에 실패했습니다. 일반 창으로 둡니다.');
    }
  } else {
    if (pinned) pin.detach(win);
    pinned = false;
    win.setSkipTaskbar(false);
  }
  store.saveSettings({ pinDesktop: !!on });
  return pinned;
}

function bringToFront() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  peek = pinned; // 고정 중이면 다른 곳을 클릭할 때까지만 앞에 둠
  win.show();
  win.moveTop();
  win.focus();
}

function createWindow() {
  const settings = store.getSettings();
  const area = screen.getPrimaryDisplay().workArea;
  const def = { width: 460, height: 600 };
  const b = visibleBounds(settings.bounds) || {
    ...def,
    x: area.x + area.width - def.width - 24,
    y: area.y + 24,
  };

  win = new BrowserWindow({
    ...b,
    minWidth: MIN_W,
    minHeight: MIN_H,
    frame: false,
    // 배경을 투명하게 할 수 있도록 투명 창으로 만듦. 투명 창은 테두리로 크기 조절이 안 되는 경우가 있어
    // 화면 오른쪽 아래 손잡이로 크기를 바꿉니다.
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    alwaysOnTop: !!settings.alwaysOnTop,
    title: '캘린더 위젯',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.setOpacity(Math.min(1, Math.max(0.3, Number(settings.opacity) || 1)));
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.once('ready-to-show', () => {
    win.showInactive();
    // 윈도우에서는 처음부터 바탕화면 고정 (설정에서 끈 경우 제외)
    const wantPin = settings.pinDesktop !== undefined ? !!settings.pinDesktop : pin.supported();
    if (wantPin && pin.supported()) {
      try {
        applyPin(true);
      } catch (e) {
        console.error(e.message);
      }
    }
    notifyPrefs();
  });

  // 외부 페이지 이동/새 창 차단
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  let t;
  const saveBounds = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (win && !win.isDestroyed() && !win.isMinimized()) store.saveSettings({ bounds: win.getBounds() });
    }, 400);
  };
  win.on('move', saveBounds);
  win.on('resize', saveBounds);
  win.on('focus', () => {
    win.webContents.send('win:focus');
    // 고정 중에 위젯을 클릭하면 윈도우가 위젯을 맨 앞으로 올리므로 다시 맨 아래로 내림
    if (pinned && !peek) setTimeout(() => pinned && !peek && pin.toBottom(win), 30);
  });
  win.on('blur', () => {
    if (pinned) {
      peek = false;
      pin.toBottom(win);
    }
  });
  // 고정 중에는 최소화되지 않게 (바탕화면 보기 등으로 내려가도 다시 표시)
  win.on('minimize', () => {
    if (pinned) {
      setTimeout(() => {
        if (!win || win.isDestroyed()) return;
        win.restore();
        win.showInactive();
        pin.toBottom(win);
      }, 150);
    }
  });
  win.on('closed', () => {
    win = null;
  });
}

function trayIcon() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  return img.isEmpty() ? img : img.resize({ width: 16, height: 16 });
}

function updateTrayMenu() {
  if (!tray) return;
  const p = prefs();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '위젯 앞으로 가져오기', click: bringToFront },
      { type: 'separator' },
      {
        label: '바탕화면에 고정 (항상 맨 아래)',
        type: 'checkbox',
        checked: p.pinDesktop,
        enabled: p.pinSupported,
        click: (item) => {
          try {
            applyPin(item.checked);
          } catch (e) {
            dialog.showErrorBox('캘린더 위젯', e.message);
          }
          notifyPrefs();
        },
      },
      { type: 'separator' },
      { label: '종료', click: () => app.quit() },
    ]),
  );
}

function createTray() {
  try {
    tray = new Tray(trayIcon());
    tray.setToolTip('캘린더 위젯');
    tray.on('click', bringToFront);
    updateTrayMenu();
  } catch (e) {
    console.error('트레이 아이콘을 만들지 못했습니다:', e.message);
  }
}

// ipc 응답은 {ok, data} / {ok:false, error, code} 형태로 통일 (오류 코드 보존)
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err.message || String(err), code: err.code || null };
    }
  });
}

handle('cal:status', () => backend.status());
handle('cal:importClient', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '구글 OAuth 클라이언트 JSON 파일 선택',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return backend.status();
  const text = fs.readFileSync(r.filePaths[0], 'utf8');
  return backend.setClient(backend.parseClientJson(text));
});
handle('cal:login', () => backend.login());
handle('cal:logout', () => backend.logout());
handle('cal:list', (timeMin, timeMax) => backend.listEvents(String(timeMin), String(timeMax)));
handle('cal:calendarColor', () => backend.calendarColor());
handle('cal:holidays', (timeMin, timeMax) => backend.listHolidays(String(timeMin), String(timeMax)));
handle('cal:create', (input) => backend.createEvent(input));
handle('cal:update', (id, input) => backend.updateEvent(String(id), input));
handle('cal:delete', (id) => backend.deleteEvent(String(id)));

handle('app:prefs', () => prefs());
handle('app:setAutostart', (on) => {
  app.setLoginItemSettings({ openAtLogin: !!on });
  return app.getLoginItemSettings().openAtLogin;
});
handle('app:setShowHolidays', (on) => store.saveSettings({ showHolidays: !!on }).showHolidays);
handle('win:alwaysOnTop', (on) => {
  if (on && pinned) applyPin(false);
  win.setAlwaysOnTop(!!on);
  store.saveSettings({ alwaysOnTop: !!on });
  notifyPrefs();
  return prefs();
});
handle('win:pinDesktop', (on) => {
  applyPin(!!on);
  notifyPrefs();
  return prefs();
});
handle('win:opacity', (v) => {
  const o = Math.min(1, Math.max(0.3, Number(v) || 1));
  win.setOpacity(o);
  store.saveSettings({ opacity: o });
  return o;
});
handle('win:bgOpacity', (v) => {
  const o = Math.min(1, Math.max(0, Number(v)));
  store.saveSettings({ bgOpacity: Number.isFinite(o) ? o : 0.92 });
  return o;
});
handle('app:setReadable', (on) => store.saveSettings({ readable: !!on }).readable);
handle('win:resizeTo', (w, h) => {
  const area = screen.getDisplayMatching(win.getBounds()).workArea;
  const width = Math.round(Math.min(area.width, Math.max(MIN_W, Number(w) || MIN_W)));
  const height = Math.round(Math.min(area.height, Math.max(MIN_H, Number(h) || MIN_H)));
  const b = win.getBounds();
  // 투명 창은 평소 resizable=false 로 두므로, 바꾸는 순간에만 잠깐 허용
  win.setResizable(true);
  win.setBounds({ x: b.x, y: b.y, width, height });
  win.setResizable(false);
  return { width, height };
});
handle('win:minimize', () => win.minimize());
handle('win:close', () => app.quit());
handle('app:openLink', (url) => {
  const u = new URL(String(url));
  const okHost = ['www.google.com', 'calendar.google.com', 'console.cloud.google.com'].includes(u.hostname);
  if (u.protocol !== 'https:' || !okHost) throw new Error('열 수 없는 주소입니다.');
  return shell.openExternal(u.toString());
});

handle('decor:get', () => decor.get());
handle('decor:save', (d, cleanup) => decor.save(d, cleanup !== false));
handle('decor:pick', (title) => decor.pickImage(win, String(title || '')));
handle('decor:importPath', (p) => decor.importPath(p));
handle('decor:importBytes', (data) => decor.importBytes(data));

app.whenReady().then(() => {
  decor.handleProtocol();
  createWindow();
  createTray();
});
app.on('window-all-closed', () => app.quit());
