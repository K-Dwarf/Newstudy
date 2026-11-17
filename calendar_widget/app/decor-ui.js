'use strict';
/* global cal, state, $, el, call, toast, md */
// 꾸미기 화면: 투명도 · 배경 이미지 · 스티커
// (app.js 다음에 불러옴. app.js 의 $, el, call, toast, state 등을 함께 씀)

// =====================================================================
// 투명도
// =====================================================================
const pct = (v) => Math.round(Number(v) * 100) + '%';

// 투명도 + 가독성 보호
//  - 배경 투명도(a): 위젯 바탕색의 불투명도
//  - 가독성 보호(readable): 바탕이 투명하거나 배경 이미지가 있어도, 달력·목록 글자 뒤에
//    합쳐서 약 62% 이상 불투명한 받침이 남도록 받침(--plate)을 더함. 제목줄·입력줄·일정 카드도 최소 불투명도 보장
function applyLookPrefs() {
  const p = state.prefs;
  const a = Number.isFinite(p.bgOpacity) ? p.bgOpacity : 0.92;
  const readable = p.readable !== false;
  const bg = state.decor?.background;
  let barA = 0.2 + a * 0.8;
  let rowA = 0.35 + a * 0.65;
  let plate = 0;
  if (readable) {
    const target = 0.62;
    plate = a < 1 ? Math.max(0, 1 - (1 - target) / (1 - a)) : 0;
    if (bg) {
      // 배경 이미지가 글자 뒤에서 보이는 정도(진하기 × (1-어둡게))에 비례해 받침을 더함
      const imgVis = bg.opacity * (1 - bg.dim);
      plate = Math.max(plate, Math.min(0.6, imgVis * 0.6));
    }
    barA = Math.max(barA, 0.75);
    rowA = Math.max(rowA, 0.8);
  }
  const root = document.documentElement.style;
  root.setProperty('--a', a);
  root.setProperty('--plate', plate.toFixed(3));
  root.setProperty('--bar-a', barA.toFixed(3));
  root.setProperty('--row-a', rowA.toFixed(3));
  // 받침이 약할 때만 글자 그림자로 보조
  document.body.classList.toggle('thin', !readable && (a < 0.5 || !!bg));
  $('#optBgOpacity').value = a;
  $('#bgOpacityVal').textContent = pct(a);
  $('#optOpacity').value = p.opacity;
  $('#opacityVal').textContent = pct(p.opacity);
  $('#optReadable').checked = readable;
  // 지금 값이 프리셋과 같으면 그 버튼 표시
  const cur = presetNow();
  document.querySelectorAll('.presets [data-preset]').forEach((b) => b.classList.toggle('on', b.dataset.preset === cur));
}

const PRESETS = {
  readable: { bgOpacity: 0.95, opacity: 1, readable: true, dim: 0.55 },
  balanced: { bgOpacity: 0.7, opacity: 1, readable: true, dim: 0.4 },
  clear: { bgOpacity: 0.2, opacity: 1, readable: false, dim: 0.3 },
};
function presetNow() {
  const p = state.prefs;
  const bg = state.decor?.background;
  for (const [k, v] of Object.entries(PRESETS)) {
    if (Math.abs(p.bgOpacity - v.bgOpacity) < 0.001 && Math.abs(p.opacity - v.opacity) < 0.001 &&
        (p.readable !== false) === v.readable && (!bg || Math.abs(bg.dim - v.dim) < 0.001)) return k;
  }
  return null;
}
async function applyPreset(name) {
  const v = PRESETS[name];
  if (!v) return;
  Object.assign(state.prefs, { bgOpacity: v.bgOpacity, opacity: v.opacity, readable: v.readable });
  await Promise.all([cal.setBgOpacity(v.bgOpacity), cal.setOpacity(v.opacity), cal.setReadable(v.readable)]);
  if (state.decor.background) {
    state.decor.background.dim = v.dim;
    renderBackground();
    renderDecorPanel();
    saveDecor();
  }
  applyLookPrefs();
}
document.querySelectorAll('.presets [data-preset]').forEach((b) => {
  b.onclick = () => applyPreset(b.dataset.preset);
});
$('#optReadable').onchange = (e) => {
  state.prefs.readable = e.target.checked;
  cal.setReadable(e.target.checked);
  applyLookPrefs();
};
$('#optBgOpacity').oninput = (e) => {
  state.prefs.bgOpacity = Number(e.target.value);
  applyLookPrefs();
  cal.setBgOpacity(e.target.value);
};
$('#optOpacity').oninput = (e) => {
  state.prefs.opacity = Number(e.target.value);
  applyLookPrefs();
  cal.setOpacity(e.target.value);
};
$('#btnDecor').onclick = () => {
  $('#decorPanel').classList.toggle('hidden');
  renderDecorPanel();
};
$('#btnDecorClose').onclick = () => $('#decorPanel').classList.add('hidden');

// =====================================================================
// 공통: 저장, 이미지 가져오기
// =====================================================================
state.decor = state.decor || { background: null, stickers: [] };
const MAX_STICKERS = 40;
const imgUrl = (file) => `decor://img/${encodeURIComponent(file)}`;

let editMode = false;
let saveT;
// 편집 중에는 되돌리기를 위해 안 쓰는 이미지 파일 정리를 미룸 (편집을 끝낼 때 정리)
function saveDecor(now) {
  clearTimeout(saveT);
  const run = () => call(cal.decorSave, state.decor, !editMode).catch((e) => toast(e.message, true));
  if (now) return run();
  saveT = setTimeout(run, 300);
}

async function pickImage(title) {
  try {
    return await call(cal.decorPick, title);
  } catch (e) {
    toast(e.message, true);
    return null;
  }
}

// 끌어다 놓은 파일 / 붙여넣은 이미지 → 위젯 폴더로 복사
async function importFile(f) {
  try {
    const p = cal.pathForFile(f);
    if (p) return await call(cal.decorImportPath, p);
    if (f.size > 30 * 1024 * 1024) throw new Error('이미지가 너무 큽니다 (30MB 이하만 가능).');
    return await call(cal.decorImportBytes, new Uint8Array(await f.arrayBuffer()));
  } catch (e) {
    toast(e.message, true);
    return null;
  }
}

// =====================================================================
// 배경 이미지
// =====================================================================
function renderBackground() {
  const bg = state.decor.background;
  const layer = $('#bgLayer');
  layer.replaceChildren();
  layer.classList.toggle('hidden', !bg);
  if (!bg) return;
  const img = el('div', 'img');
  img.style.backgroundImage = `url("${imgUrl(bg.file)}")`;
  img.style.backgroundSize = bg.fit;
  img.style.opacity = bg.opacity;
  const dim = el('div', 'dim');
  dim.style.opacity = bg.dim;
  layer.append(img, dim);
}

function renderDecor() {
  renderBackground();
  if (state.prefs) applyLookPrefs();
  renderStickers();
  renderDecorPanel();
}

function renderDecorPanel() {
  const bg = state.decor.background;
  $('#bgOptions').classList.toggle('hidden', !bg);
  $('#btnBgClear').disabled = !bg;
  if (bg) {
    $('#optBgImgOpacity').value = bg.opacity;
    $('#bgImgOpacityVal').textContent = pct(bg.opacity);
    $('#optBgDim').value = bg.dim;
    $('#bgDimVal').textContent = pct(bg.dim);
    $('#optBgFit').value = bg.fit;
  }
  const n = state.decor.stickers.length;
  $('#stickerCount').textContent = n ? `(${n}개)` : '';
}

$('#btnBgPick').onclick = async () => {
  const r = await pickImage('배경 이미지 선택');
  if (!r) return;
  const old = state.decor.background;
  state.decor.background = { file: r.file, opacity: old?.opacity ?? 1, dim: old?.dim ?? 0.35, fit: old?.fit || 'cover' };
  await saveDecor(true);
  renderDecor();
};
$('#btnBgClear').onclick = async () => {
  state.decor.background = null;
  await saveDecor(true);
  renderDecor();
};
for (const [id, key] of [['#optBgImgOpacity', 'opacity'], ['#optBgDim', 'dim'], ['#optBgFit', 'fit']]) {
  const handler = (e) => {
    if (!state.decor.background) return;
    state.decor.background[key] = e.target.type === 'range' ? Number(e.target.value) : e.target.value;
    renderBackground();
    applyLookPrefs();
    renderDecorPanel();
    saveDecor();
  };
  $(id).oninput = handler;
  $(id).onchange = handler;
}

// =====================================================================
// 스티커
// =====================================================================
// 스티커 정보 (src/decor.js 와 같은 형식)
//   anchor 'screen' : cx, cy = 위젯 안 중심 위치(비율), w = 위젯 너비 대비 비율 → 위젯 크기를 바꿔도 비율대로 유지
//   anchor 'date'   : date 칸 안 중심 위치(비율), w = 칸 너비 대비 비율 → 달을 넘겨도 그 날짜를 따라감
//   rot(도), opacity, flip(좌우 뒤집기), back(글자 뒤). 배열 순서 = 겹치는 순서(뒤에 있을수록 앞)
let selId = null;
const undoStack = [];
const redoStack = [];
const findSticker = (id) => state.decor.stickers.find((s) => s.id === id);
const newId = () => Math.random().toString(16).slice(2, 12);

function snapshot() {
  return JSON.stringify(state.decor.stickers);
}
function pushUndo(snap = snapshot()) {
  undoStack.push(snap);
  if (undoStack.length > 80) undoStack.shift();
  redoStack.length = 0;
  updateBar();
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  state.decor.stickers = JSON.parse(undoStack.pop());
  afterChange();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  state.decor.stickers = JSON.parse(redoStack.pop());
  afterChange();
}
function afterChange() {
  if (selId && !findSticker(selId)) selId = null;
  saveDecor();
  renderStickers();
  renderDecorPanel();
}

// 스티커가 놓일 기준 영역 (스티커 층 좌표)
function layerOrigin() {
  return $('#stickersFront').getBoundingClientRect();
}
function cellRect(day) {
  if (state.view !== 'month') return null;
  const cell = document.querySelector(`.cell[data-day="${day}"]`);
  return cell ? cell.getBoundingClientRect() : null;
}
function hostRect(s, L = layerOrigin()) {
  if (s.anchor !== 'date') return { left: 0, top: 0, width: L.width, height: L.height };
  const r = cellRect(s.date);
  return r && { left: r.left - L.left, top: r.top - L.top, width: r.width, height: r.height };
}
// 스티커 → 스티커 층 안의 픽셀 위치 {cx, cy, w}
function placeOf(s, L) {
  const h = hostRect(s, L);
  if (!h) return null;
  return { cx: h.left + s.cx * h.width, cy: h.top + s.cy * h.height, w: s.w * h.width };
}
// 픽셀 위치 → 스티커 정보에 저장 (날짜 스티커는 가장 가까운 날짜 칸으로 옮겨 붙임)
function commitPlace(s, p, L = layerOrigin()) {
  if (s.anchor === 'date') {
    const near = nearestCell(p.cx + L.left, p.cy + L.top);
    if (near) {
      s.date = near.day;
      const r = near.rect;
      s.cx = (p.cx + L.left - r.left) / r.width;
      s.cy = (p.cy + L.top - r.top) / r.height;
      s.w = p.w / r.width;
      return;
    }
  }
  s.cx = p.cx / L.width;
  s.cy = p.cy / L.height;
  s.w = p.w / L.width;
}
function nearestCell(x, y) {
  let best = null;
  for (const c of document.querySelectorAll('.cell[data-day]')) {
    const r = c.getBoundingClientRect();
    const dx = Math.max(r.left - x, 0, x - r.right);
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    const d = dx * dx + dy * dy;
    if (!best || d < best.d) best = { d, day: c.dataset.day, rect: r };
  }
  return best;
}

function transformOf(s) {
  return `translate(-50%, -50%) rotate(${s.rot || 0}deg)`;
}

function stickerNode(s, p) {
  const d = el('div', 'sticker' + (s.back ? ' back' : '') + (s.anchor === 'date' ? ' dated' : ''));
  d.dataset.id = s.id;
  d.style.left = p.cx + 'px';
  d.style.top = p.cy + 'px';
  d.style.width = p.w + 'px';
  d.style.transform = transformOf(s);
  const img = el('img');
  img.src = imgUrl(s.file);
  img.alt = '';
  img.draggable = false;
  img.style.opacity = s.opacity ?? 1;
  if (s.flip) img.style.transform = 'scaleX(-1)';
  d.append(img);
  if (editMode) {
    if (s.anchor === 'date') d.append(el('span', 'date-tag', '📅 ' + md(s.date)));
    if (s.id === selId) {
      d.classList.add('sel');
      const rs = el('div', 'h rs');
      rs.title = '끌어서 크기 조절';
      const rt = el('div', 'h rt');
      rt.title = '끌어서 회전 (Shift: 15°씩)';
      d.append(rs, rt);
    }
  }
  return d;
}

function renderStickers() {
  const back = $('#stickersBack');
  const front = $('#stickersFront');
  const edit = $('#stickersEdit');
  back.replaceChildren();
  front.replaceChildren();
  edit.replaceChildren();
  document.querySelectorAll('.day-stickers').forEach((n) => n.remove());
  const L = layerOrigin();
  for (const s of state.decor.stickers) {
    const p = placeOf(s, L);
    if (!p) {
      // 주/오늘 탭: 날짜 스티커는 날짜 제목 옆에 작게 표시
      if (s.anchor === 'date' && state.view !== 'month') {
        const head = document.querySelector(`.day-head[data-day="${s.date}"]`);
        if (head) {
          let box = head.querySelector('.day-stickers');
          if (!box) {
            box = el('span', 'day-stickers');
            head.insertBefore(box, head.querySelector('.add'));
          }
          const img = el('img');
          img.src = imgUrl(s.file);
          img.alt = '';
          img.style.opacity = s.opacity ?? 1;
          if (s.flip) img.style.transform = 'scaleX(-1)';
          box.append(img);
        }
      }
      continue;
    }
    const node = stickerNode(s, p);
    if (editMode) edit.append(node);
    else (s.back ? back : front).append(node);
  }
  updateBar();
}

// ---------- 편집 모드 ----------
function setEditMode(on) {
  editMode = !!on;
  document.body.classList.toggle('editing', editMode);
  $('#stickersEdit').classList.toggle('hidden', !editMode);
  $('#stickerBar').classList.toggle('hidden', !editMode);
  if (editMode) {
    $('#decorPanel').classList.add('hidden');
  } else {
    selId = null;
    undoStack.length = 0;
    redoStack.length = 0;
    saveDecor(true); // 편집 끝: 안 쓰는 이미지 파일 정리
  }
  renderStickers();
}

function select(id) {
  selId = id;
  renderStickers();
}

function updateBar() {
  const s = selId && findSticker(selId);
  $('#sbHint').classList.toggle('hidden', !!s);
  $('#sbTools').classList.toggle('hidden', !s);
  $('#sbUndo').disabled = !undoStack.length;
  $('#sbRedo').disabled = !redoStack.length;
  const hidden = editMode && state.view !== 'month' && state.decor.stickers.some((x) => x.anchor === 'date');
  $('#sbNote').classList.toggle('hidden', !hidden);
  if (!s) return;
  $('#sbOpacity').value = s.opacity ?? 1;
  $('#sbOpacityVal').textContent = pct(s.opacity ?? 1);
  const lay = $('#sbTools [data-act=layer]');
  lay.textContent = s.back ? '글자 뒤' : '글자 앞';
  lay.title = s.back ? '지금 글자 뒤에 있음 → 누르면 글자 앞으로' : '지금 글자 앞에 있음 → 누르면 글자 뒤로';
  const dt = $('#sbTools [data-act=date]');
  dt.textContent = s.anchor === 'date' ? `📅 ${md(s.date)} 떼기` : '📅 날짜에 붙이기';
  dt.classList.toggle('on', s.anchor === 'date');
}

// 편집 층: 빈 곳을 누르면 선택 해제, 스티커는 끌어서 이동 / 손잡이로 크기·회전
// 스티커 밖 빈 곳을 누르면 선택 해제 (편집 층은 빈 곳 클릭을 아래로 통과시킴)
document.addEventListener('pointerdown', (e) => {
  if (!editMode || !selId) return;
  if (e.target.closest('.sticker, .sticker-bar, .titlebar, .toolbar, dialog, .panel, .toast')) return;
  select(null);
});
$('#stickersEdit').addEventListener('pointerdown', (e) => {
  const node = e.target.closest('.sticker');
  if (!node) return;
  e.preventDefault();
  const s = findSticker(node.dataset.id);
  if (!s) return;
  if (selId !== s.id) {
    select(s.id);
  }
  const target = document.querySelector(`#stickersEdit .sticker[data-id="${s.id}"]`);
  const handle = e.target.classList.contains('rs') ? 'rs' : e.target.classList.contains('rt') ? 'rt' : 'move';
  dragSticker(e, s, target, handle);
});

function dragSticker(e, s, node, mode) {
  const L = layerOrigin();
  const p0 = placeOf(s, L);
  if (!p0) return;
  const before = snapshot();
  const start = { x: e.clientX, y: e.clientY };
  const center = { x: p0.cx + L.left, y: p0.cy + L.top };
  const dist0 = Math.hypot(start.x - center.x, start.y - center.y) || 1;
  const p = { ...p0 };
  let moved = false;
  node.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const dx = ev.clientX - start.x;
    const dy = ev.clientY - start.y;
    if (!moved && Math.hypot(dx, dy) < 2) return;
    moved = true;
    if (mode === 'move') {
      p.cx = p0.cx + dx;
      p.cy = p0.cy + dy;
      node.style.left = p.cx + 'px';
      node.style.top = p.cy + 'px';
    } else if (mode === 'rs') {
      // 중심에서 멀어진 만큼 비율 유지하며 크기 조절
      const k = Math.hypot(ev.clientX - center.x, ev.clientY - center.y) / dist0;
      p.w = Math.max(20, Math.min(L.width * 3, p0.w * k));
      node.style.width = p.w + 'px';
    } else {
      let deg = (Math.atan2(ev.clientY - center.y, ev.clientX - center.x) * 180) / Math.PI + 90;
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
      else {
        const snap = Math.round(deg / 45) * 45; // 45° 근처에서는 딱 맞춤
        if (Math.abs(deg - snap) < 4) deg = snap;
      }
      s.rot = ((Math.round(deg) + 540) % 360) - 180;
      node.style.transform = transformOf(s);
    }
  };
  const up = () => {
    node.removeEventListener('pointermove', move);
    node.removeEventListener('pointerup', up);
    node.removeEventListener('pointercancel', up);
    if (!moved) return;
    commitPlace(s, p, L);
    pushUndo(before);
    saveDecor();
    renderStickers();
  };
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
}

// ---------- 선택한 스티커 도구 ----------
function act(name) {
  const s = selId && findSticker(selId);
  if (!s) return;
  const before = snapshot();
  const list = state.decor.stickers;
  const i = list.indexOf(s);
  switch (name) {
    case 'flip':
      s.flip = !s.flip;
      break;
    case 'reset':
      s.rot = 0;
      s.flip = false;
      break;
    case 'dup': {
      if (list.length >= MAX_STICKERS) return toast(`스티커는 ${MAX_STICKERS}개까지 붙일 수 있습니다.`, true);
      const c = { ...s, id: newId(), cx: s.cx + 0.05, cy: s.cy + 0.05 };
      list.splice(i + 1, 0, c);
      selId = c.id;
      break;
    }
    case 'top':
      list.splice(i, 1);
      list.push(s);
      break;
    case 'bottom':
      list.splice(i, 1);
      list.unshift(s);
      break;
    case 'layer':
      s.back = !s.back;
      toast(s.back ? '글자 뒤로 보냈습니다.' : '글자 앞으로 꺼냈습니다.');
      break;
    case 'date': {
      const L = layerOrigin();
      const p = placeOf(s, L);
      if (s.anchor === 'date') {
        s.anchor = 'screen';
        s.date = null;
        commitPlace(s, p, L);
        toast('날짜에서 떼었습니다. 이제 위젯 화면 위치에 고정됩니다.');
      } else {
        if (state.view !== 'month') return toast('월 탭에서 스티커를 원하는 날짜 칸 위에 놓고 누르세요.', true);
        s.anchor = 'date';
        commitPlace(s, p, L);
        // 날짜 칸에 비해 크면 일정 글자를 가리므로 칸 너비의 절반 정도로 줄임
        if (s.w > 0.6) s.w = 0.5;
        toast(`${md(s.date)}에 붙였습니다. 달을 넘겨도 이 날짜를 따라다닙니다.`);
      }
      break;
    }
    case 'del':
      list.splice(i, 1);
      selId = null;
      break;
    default:
      return;
  }
  pushUndo(before);
  afterChange();
}
document.querySelectorAll('#sbTools [data-act]').forEach((b) => {
  b.onclick = () => act(b.dataset.act);
});

// 투명도: 끄는 동안은 화면만 바꾸고, 놓을 때 한 번 저장 (되돌리기 한 번에 되돌아감)
let opacityBefore = null;
$('#sbOpacity').addEventListener('pointerdown', () => {
  opacityBefore = snapshot();
});
$('#sbOpacity').oninput = (e) => {
  const s = selId && findSticker(selId);
  if (!s) return;
  s.opacity = Number(e.target.value);
  $('#sbOpacityVal').textContent = pct(s.opacity);
  const img = document.querySelector(`#stickersEdit .sticker[data-id="${s.id}"] img`);
  if (img) img.style.opacity = s.opacity;
};
$('#sbOpacity').onchange = () => {
  if (opacityBefore) pushUndo(opacityBefore);
  opacityBefore = null;
  saveDecor();
};

$('#sbUndo').onclick = undo;
$('#sbRedo').onclick = redo;
$('#sbDone').onclick = () => setEditMode(false);
$('#sbAdd').onclick = () => addFromDialog();

// ---------- 스티커 추가 (파일 선택 / 끌어다 놓기 / 붙여넣기) ----------
function addSticker(file, clientX, clientY) {
  if (state.decor.stickers.length >= MAX_STICKERS) {
    toast(`스티커는 ${MAX_STICKERS}개까지 붙일 수 있습니다.`, true);
    return null;
  }
  const L = layerOrigin();
  const x = clientX ?? L.left + L.width / 2;
  const y = clientY ?? L.top + L.height / 2;
  const w = Math.min(140, L.width * 0.35);
  const s = {
    id: newId(),
    file,
    anchor: 'screen',
    date: null,
    cx: (x - L.left) / L.width,
    cy: (y - L.top) / L.height,
    w: w / L.width,
    rot: 0,
    opacity: 1,
    flip: false,
    back: false,
  };
  state.decor.stickers.push(s);
  return s;
}

async function addFiles(files, clientX, clientY) {
  const before = snapshot();
  let last = null;
  let i = 0;
  for (const f of files) {
    const r = await importFile(f);
    if (!r) continue;
    const s = addSticker(r.file, clientX != null ? clientX + i * 16 : undefined, clientY != null ? clientY + i * 16 : undefined);
    if (!s) break;
    last = s;
    i++;
  }
  if (!last) return;
  if (!editMode) setEditMode(true);
  pushUndo(before);
  selId = last.id;
  afterChange();
  toast(i > 1 ? `스티커 ${i}개를 붙였습니다.` : '스티커를 붙였습니다. 끌어서 옮기고 모서리로 크기를 바꾸세요.');
}

async function addFromDialog() {
  const r = await pickImage('스티커로 붙일 이미지 선택');
  if (!r) return;
  const before = snapshot();
  const s = addSticker(r.file);
  if (!s) return;
  if (!editMode) setEditMode(true);
  pushUndo(before);
  selId = s.id;
  afterChange();
}
$('#btnStickerAdd').onclick = addFromDialog;
$('#btnStickerEdit').onclick = () => setEditMode(true);

// 탐색기 등에서 이미지 파일을 위젯으로 끌어다 놓기
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
document.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  $('#dropHint').classList.remove('hidden');
});
document.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $('#dropHint').classList.add('hidden');
});
document.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('#dropHint').classList.add('hidden');
  const files = [...e.dataTransfer.files];
  if (files.length) addFiles(files, e.clientX, e.clientY);
});

// Ctrl+V: 복사한 이미지(스크린샷, 탐색기에서 복사한 이미지 파일)를 스티커로
document.addEventListener('paste', (e) => {
  if ($('#eventDlg').open || $('#settingsDlg').open) return;
  const cd = e.clipboardData;
  if (!cd) return;
  const files = [...cd.files].filter((f) => !f.type || f.type.startsWith('image/'));
  if (!files.length) return;
  // 글자 입력칸에서는, 붙여넣을 글자가 함께 있으면 글자 붙여넣기를 우선
  if (e.target.matches?.('input, textarea') && cd.getData('text/plain')) return;
  e.preventDefault();
  addFiles(files);
});

// ---------- 단축키 (app.js 의 keydown 에서 먼저 불러줌) ----------
let lastNudge = 0;
function stickerKeydown(e) {
  if (!editMode) return false;
  if (e.target.matches?.('input[type=text], textarea')) return false;
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  const s = selId && findSticker(selId);
  if (e.key === 'Escape') {
    if (selId) select(null);
    else setEditMode(false);
  } else if (ctrl && key === 'z' && !e.shiftKey) undo();
  else if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) redo();
  else if (ctrl && key === 'd') act('dup');
  else if (s && (e.key === 'Delete' || e.key === 'Backspace')) act('del');
  else if (s && e.key.startsWith('Arrow')) {
    // 방향키로 1px (Shift: 10px) 이동. 연달아 누르면 되돌리기 한 번으로 묶음
    const step = e.shiftKey ? 10 : 1;
    const L = layerOrigin();
    const p = placeOf(s, L);
    if (!p) return true;
    if (Date.now() - lastNudge > 800) pushUndo();
    lastNudge = Date.now();
    if (e.key === 'ArrowLeft') p.cx -= step;
    if (e.key === 'ArrowRight') p.cx += step;
    if (e.key === 'ArrowUp') p.cy -= step;
    if (e.key === 'ArrowDown') p.cy += step;
    commitPlace(s, p, L);
    saveDecor();
    renderStickers();
  } else return false;
  e.preventDefault();
  return true;
}

// 테스트에서 쓰기 위해 노출
window.__widget = { state, parseQuick, openEvent, setSel, renderDecor, setEditMode, addSticker, select };
