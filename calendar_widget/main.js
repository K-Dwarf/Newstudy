'use strict';
// 바탕화면 캘린더 위젯 - Electron 메인 프로세스
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');

const DEMO = process.argv.includes('--demo') || process.env.CAL_WIDGET_DEMO === '1';
if (DEMO) app.setPath('userData', path.join(app.getPath('temp'), 'calendar-widget-demo'));

const store = require('./src/store');
const backend = DEMO ? require('./src/demo') : require('./src/google');

let win = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
}

function visibleBounds(b) {
  if (!b) return null;
  const area = screen.getDisplayMatching(b).workArea;
  const inside =
    b.x < area.x + area.width - 40 && b.x + b.width > area.x + 40 && b.y >= area.y - 10 && b.y < area.y + area.height - 40;
  return inside ? b : null;
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
    minWidth: 360,
    minHeight: 440,
    frame: false,
    backgroundColor: '#1f2430',
    alwaysOnTop: !!settings.alwaysOnTop,
    title: '캘린더 위젯',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.setOpacity(Math.min(1, Math.max(0.4, Number(settings.opacity) || 1)));
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.once('ready-to-show', () => win.show());

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
  win.on('focus', () => win.webContents.send('win:focus'));
  win.on('closed', () => {
    win = null;
  });
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
handle('cal:holidays', (timeMin, timeMax) => backend.listHolidays(String(timeMin), String(timeMax)));
handle('cal:create', (input) => backend.createEvent(input));
handle('cal:update', (id, input) => backend.updateEvent(String(id), input));
handle('cal:delete', (id) => backend.deleteEvent(String(id)));

handle('app:prefs', () => {
  const s = store.getSettings();
  return {
    alwaysOnTop: !!s.alwaysOnTop,
    opacity: Number(s.opacity) || 1,
    showHolidays: s.showHolidays !== false,
    autostart: app.getLoginItemSettings().openAtLogin,
    packaged: app.isPackaged,
    demo: DEMO,
  };
});
handle('app:setAutostart', (on) => {
  app.setLoginItemSettings({ openAtLogin: !!on });
  return app.getLoginItemSettings().openAtLogin;
});
handle('app:setShowHolidays', (on) => store.saveSettings({ showHolidays: !!on }).showHolidays);
handle('win:alwaysOnTop', (on) => {
  win.setAlwaysOnTop(!!on);
  store.saveSettings({ alwaysOnTop: !!on });
  return !!on;
});
handle('win:opacity', (v) => {
  const o = Math.min(1, Math.max(0.4, Number(v) || 1));
  win.setOpacity(o);
  store.saveSettings({ opacity: o });
  return o;
});
handle('win:minimize', () => win.minimize());
handle('win:close', () => win.close());
handle('app:openLink', (url) => {
  const u = new URL(String(url));
  const okHost = ['www.google.com', 'calendar.google.com', 'console.cloud.google.com'].includes(u.hostname);
  if (u.protocol !== 'https:' || !okHost) throw new Error('열 수 없는 주소입니다.');
  return shell.openExternal(u.toString());
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
