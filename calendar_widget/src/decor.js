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
const NAME_RE = /^[a-f0-9]{24}\.(png|jpg|gif|webp)$/;

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
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

const NOT_IMAGE = 'jpg, png, gif, webp 이미지 파일만 넣을 수 있습니다.';

function saveBuffer(buf) {
  if (buf.length > MAX_BYTES) throw new Error('이미지가 너무 큽니다 (30MB 이하만 가능).');
  const ext = sniff(buf);
  if (!ext) throw new Error(NOT_IMAGE);
  fs.mkdirSync(dir(), { recursive: true });
  const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(dir(), name), buf);
  return { file: name };
}

// 탐색기에서 끌어다 놓은 파일 (경로)
function importPath(p) {
  const src = String(p || '');
  if (!src || !fs.existsSync(src) || !fs.statSync(src).isFile()) throw new Error('파일을 찾을 수 없습니다.');
  if (fs.statSync(src).size > MAX_BYTES) throw new Error('이미지가 너무 큽니다 (30MB 이하만 가능).');
  return saveBuffer(fs.readFileSync(src));
}

// 붙여넣기(Ctrl+V) 등 경로 없이 내용만 있는 이미지
function importBytes(data) {
  const buf = Buffer.from(data instanceof Uint8Array ? data : new Uint8Array(data || []));
  return saveBuffer(buf);
}

async function pickImage(win, title) {
  const r = await dialog.showOpenDialog(win, {
    title: title || '이미지 선택',
    filters: [{ name: '이미지 (jpg, jpeg, png, gif, webp)', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const src = r.filePaths[0];
  const size = fs.statSync(src).size;
  if (size > MAX_BYTES) throw new Error('이미지가 너무 큽니다 (30MB 이하만 가능).');
  return saveBuffer(fs.readFileSync(src));
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
      .map(sanitizeSticker),
  };
}

// 스티커 하나
//   anchor 'screen': 위젯 화면 기준. cx, cy = 스티커 중심 위치(위젯 너비·높이 대비 비율), w = 위젯 너비 대비 비율
//   anchor 'date'  : 달력 날짜 칸 기준. date = 'YYYY-MM-DD', cx, cy = 칸 안에서의 중심 비율, w = 칸 너비 대비 비율
//   rot = 회전 각도(도), opacity = 투명도, flip = 좌우 뒤집기, back = 글자 뒤에 놓기
// 예전 형식(x, y, w 픽셀)은 기본 창 크기(460×600) 기준으로 바꿔서 읽음
function sanitizeSticker(s) {
  const legacy = s.cx === undefined && s.x !== undefined;
  const isDate = s.anchor === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(String(s.date));
  const lw = num(s.w, 16, 2000, 120);
  return {
    id: String(s.id || crypto.randomBytes(6).toString('hex')).slice(0, 32),
    file: s.file,
    anchor: isDate ? 'date' : 'screen',
    date: isDate ? String(s.date) : null,
    cx: legacy ? (num(s.x, -2000, 4000, 20) + lw / 2) / 460 : num(s.cx, -1, 2, 0.5),
    cy: legacy ? (num(s.y, -2000, 4000, 60) + lw / 2) / 600 : num(s.cy, -1, 2, 0.5),
    w: legacy ? lw / 460 : num(s.w, 0.03, 4, 0.3),
    rot: num(s.rot, -360, 360, 0),
    opacity: num(s.opacity, 0.1, 1, 1),
    flip: !!s.flip,
    back: !!s.back,
  };
}

function get() {
  return sanitize(store.getSettings().decor || {});
}

// 저장 후, 더 이상 쓰지 않는 이미지 파일은 지움
// (스티커 편집 중에는 되돌리기(Ctrl+Z)로 다시 쓸 수 있으므로 cleanup=false 로 정리를 미룸)
function save(d, cleanup = true) {
  const clean = sanitize(d);
  store.saveSettings({ decor: clean });
  if (!cleanup) return clean;
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

module.exports = { registerScheme, handleProtocol, pickImage, importPath, importBytes, get, save };
