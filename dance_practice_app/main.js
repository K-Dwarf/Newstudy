// Christmas Dance Practice - Electron main process.
// Serves the app folder from a small web server on 127.0.0.1 so the YouTube player works
// (YouTube refuses to play inside pages opened as plain files: error 153).

const { app, BrowserWindow, Menu, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'app');
const PREFERRED_PORT = 17865; // fixed so saved bookmarks/notes stay with the same address
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let p;
      try { p = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) { res.writeHead(400); res.end(); return; }
      if (p === '/') p = '/index.html';
      const full = path.normalize(path.join(ROOT, p));
      if (!full.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
      fs.readFile(full, (err, data) => {
        if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
        res.writeHead(200, {
          'Content-Type': TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-cache'
        });
        res.end(data);
      });
    });
    const listen = (port) => {
      server.once('error', (e) => {
        if (port !== 0 && e.code === 'EADDRINUSE') listen(0); // preferred port busy: take any free port
        else reject(e);
      });
      server.listen(port, '127.0.0.1', () => resolve(server));
    };
    listen(PREFERRED_PORT);
  });
}

// Present a plain Chrome user agent so the YouTube player treats the app like a normal browser.
app.userAgentFallback = app.userAgentFallback
  .replace(/\sElectron\/\S+/, '')
  .replace(/\schristmas-dance-practice\/\S+/i, '');

let win = null;

async function createWindow() {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;

  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0e15',
    title: '크리스마스 댄스 연습실',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  Menu.setApplicationMenu(null);

  // Links that try to open new windows go to the normal web browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(base)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });

  win.on('closed', () => { win = null; server.close(); });
  win.loadURL(base + 'index.html');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
