'use strict';
// 꾸미기: 위젯 배경 이미지와 스티커
// - 고른 이미지는 %APPDATA%\CalendarWidget\decor\ 에 복사해 둡니다 (원본을 옮기거나 지워도 유지).
// - 화면에서는 decor://img/<파일이름> 주소로만 읽을 수 있습니다 (이 폴더 밖 파일은 못 읽음).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, dialog, protocol, net } = require('electron');
const { pathToFileURL } = require('url');
const store = require('./store');

const MAX_BYTES = 30 * 1024 * 1024;
const MAX_STICKERS = 40;
const NAME_RE = /^[a-f0-9]{24}\.(png|jpg|gif)$/;

const dir = () => path.join(app.getPath('userData'), 'decor');

function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'decor', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

function handleProtocol() {
  protocol.handle('decor', (req) => {
    const name = decodeURIComponent(new URL(req.url).pathname.replace(/^\//, ''));
    if (!NAME_RE.test(name)) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(path.join(dir(), name)).toString());
  });
}

// 확장자가 아니라 파일 앞부분(서명)으로 실제 이미지 종류 확인
function sniff(buf) {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString('latin1', 0, 6))) return 'gif';
  return null;
}

async function pickImage(win, title) {
  const r = await dialog.showOpenDialog(win, {
    title: title || '이미지 선택',
    filters: [{ name: '이미지 (jpg, jpeg, png, gif)', extensions: ['jpg', 'jpeg', 'png', 'gif'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const src = r.filePaths[0];
  const size = fs.statSync(src).size;
  if (size > MAX_BYTES) throw new Error('이미지가 너무 큽니다 (30MB 이하만 가능).');
  const fd = fs.openSync(src, 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  const ext = sniff(head);
  if (!ext) throw new Error('jpg, png, gif 이미지 파일만 넣을 수 있습니다.');
  fs.mkdirSync(dir(), { recursive: true });
  const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
  fs.copyFileSync(src, path.join(dir(), name));
  return { file: name };
}

const num = (v, min, max, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

function sanitize(d) {
  const bg = d && d.background && NAME_RE.test(d.background.file) ? d.background : null;
  return {
    background: bg && {
      file: bg.file,
      opacity: num(bg.opacity, 0, 1, 1),
      dim: num(bg.dim, 0, 0.9, 0.35),
      fit: bg.fit === 'contain' ? 'contain' : 'cover',
    },
    stickers: (Array.isArray(d?.stickers) ? d.stickers : [])
      .filter((s) => s && NAME_RE.test(s.file))
      .slice(0, MAX_STICKERS)
      .map((s) => ({
        id: String(s.id || crypto.randomBytes(6).toString('hex')).slice(0, 32),
        file: s.file,
        x: num(s.x, -2000, 4000, 20),
        y: num(s.y, -2000, 4000, 60),
        w: num(s.w, 16, 2000, 120),
        back: !!s.back,
      })),
  };
}

function get() {
  return sanitize(store.getSettings().decor || {});
}

// 저장 후, 더 이상 쓰지 않는 이미지 파일은 지움
function save(d) {
  const clean = sanitize(d);
  store.saveSettings({ decor: clean });
  const used = new Set([clean.background?.file, ...clean.stickers.map((s) => s.file)].filter(Boolean));
  try {
    for (const f of fs.readdirSync(dir())) {
      if (NAME_RE.test(f) && !used.has(f)) fs.unlinkSync(path.join(dir(), f));
    }
  } catch {
    /* 폴더가 없으면 무시 */
  }
  return clean;
}

module.exports = { registerScheme, handleProtocol, pickImage, get, save };
