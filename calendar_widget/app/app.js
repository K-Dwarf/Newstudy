'use strict';
/* global cal */
// 캘린더 위젯 화면 로직 (오늘 / 주 / 월 탭, 빠른 추가, 일정 수정·삭제)

const $ = (s) => document.querySelector(s);
const pad = (n) => String(n).padStart(2, '0');
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const COLORS = {
  1: '#7986cb', 2: '#33b679', 3: '#8e24aa', 4: '#e67c73', 5: '#f6bf26', 6: '#f4511e',
  7: '#039be5', 8: '#616161', 9: '#3f51b5', 10: '#0b8043', 11: '#d50000',
};
const DEFAULT_COLOR = '#4f7fe0';

function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
function todayYmd() { return ymd(new Date()); }
function md(s) { const d = parseYmd(s); return `${d.getMonth() + 1}/${d.getDate()}`; }
function dowOf(s) { return parseYmd(s).getDay(); }
function koDate(s) { const d = parseYmd(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]})`; }
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const state = {
  view: 'month', // 기본은 월 달력
  sel: todayYmd(),
  events: [],
  holidays: {}, // 'YYYY-MM-DD' -> [{ name, isPublic }]
  holidayWarned: false,
  range: null,
  status: null,
  prefs: null,
  loading: 0,
  lastLoad: 0,
  today: todayYmd(),
};

// ---------- 공통 ----------
let toastTimer;
function toast(msg, isError) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), isError ? 5000 : 2200);
}

async function call(fn, ...args) {
  const r = await fn(...args);
  if (!r.ok) {
    const err = new Error(r.error);
    err.code = r.code;
    throw err;
  }
  return r.data;
}

function colorOf(ev) { return COLORS[ev.colorId] || DEFAULT_COLOR; }

function rangeFor(view, sel) {
  if (view === 'day') return { start: sel, days: 1 };
  if (view === 'week') return { start: addDays(sel, -dowOf(sel)), days: 7 };
  const first = sel.slice(0, 8) + '01';
  return { start: addDays(first, -dowOf(first)), days: 42 };
}

function eventsOn(day) {
  const a = parseYmd(day).getTime();
  const b = parseYmd(addDays(day, 1)).getTime();
  return state.events
    .filter((e) => e.startMs < b && e.endMs > a)
    .sort((x, y) => (y.allDay - x.allDay) || (x.startMs - y.startMs) || x.title.localeCompare(y.title));
}

function timeText(ev, day) {
  if (ev.allDay) return ev.startDate === ev.endDate ? '종일' : `종일 ~${md(ev.endDate)}`;
  const startsHere = ev.startDate === day;
  const endsHere = ev.endDate === day;
  if (startsHere && endsHere) return `${ev.startTime}–${ev.endTime}`;
  if (startsHere) return `${ev.startTime}~`;
  if (endsHere) return `~${ev.endTime}`;
  return '하루 종일';
}

// ---------- 공휴일 ----------
function holidayMap(list) {
  const map = {};
  for (const h of list) {
    for (let d = h.startDate; d < h.endDate; d = addDays(d, 1)) {
      (map[d] = map[d] || []).push({ name: h.name, isPublic: h.isPublic });
    }
  }
  return map;
}
const holidaysOn = (day) => state.holidays[day] || [];
const isRedDay = (day) => holidaysOn(day).some((h) => h.isPublic);

// ---------- 불러오기 ----------
async function load() {
  const my = ++state.loading;
  try {
    state.status = await call(cal.status);
    if (!state.status.connected) {
      state.events = [];
      render();
      return;
    }
    const r = rangeFor(state.view, state.sel);
    const timeMin = parseYmd(r.start).toISOString();
    const timeMax = parseYmd(addDays(r.start, r.days)).toISOString();
    const holidayReq = state.prefs?.showHolidays
      ? call(cal.holidays, timeMin, timeMax).catch((e) => {
          // 공휴일을 못 받아도 내 일정은 그대로 보여 줌. 안내는 한 번만.
          if (!state.holidayWarned) {
            state.holidayWarned = true;
            setTimeout(() => toast(e.message, true), 2500);
          }
          return [];
        })
      : Promise.resolve([]);
    const [events, hols] = await Promise.all([call(cal.list, timeMin, timeMax), holidayReq]);
    if (my !== state.loading) return; // 더 최근 요청이 있으면 버림
    state.events = events;
    state.holidays = holidayMap(hols);
    state.range = r;
    state.lastLoad = Date.now();
    render();
  } catch (e) {
    if (my !== state.loading) return;
    if (e.code === 'NEEDS_LOGIN') {
      state.status = await call(cal.status).catch(() => state.status);
      render();
    }
    toast(e.message, true);
  }
}

function setSel(day) {
  const before = JSON.stringify(rangeFor(state.view, state.sel));
  state.sel = day;
  const after = JSON.stringify(rangeFor(state.view, state.sel));
  updateQuickDate();
  if (before !== after) load();
  else render();
}

// ---------- 그리기 ----------
function render() {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  const view = $('#view');
  view.replaceChildren();
  $('#rangeLabel').textContent = labelFor();
  updateQuickDate();

  if (state.status && !state.status.connected) {
    view.append(connectBanner());
    return;
  }
  if (state.view === 'month') renderMonth(view);
  else if (state.view === 'week') renderWeek(view);
  else renderDay(view);
}

function labelFor() {
  const d = parseYmd(state.sel);
  if (state.view === 'month') return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
  if (state.view === 'week') {
    const r = rangeFor('week', state.sel);
    return `${md(r.start)} – ${md(addDays(r.start, 6))}`;
  }
  return koDate(state.sel);
}

function connectBanner() {
  const s = state.status;
  const b = el('div', 'banner');
  b.append(el('h4', null, '구글 캘린더 연결이 필요합니다'));
  if (!s.canEncrypt) {
    b.append(el('p', null, '이 PC에서 암호화 저장을 쓸 수 없어 로그인 정보를 저장할 수 없습니다.'));
    return b;
  }
  b.append(
    el('div', null, s.hasClient
      ? '✅ OAuth 클라이언트 등록됨. 이제 구글 로그인을 눌러 주세요.'
      : '① 구글 클라우드 콘솔에서 받은 OAuth 클라이언트(데스크톱 앱) JSON 파일을 불러오고, ② 구글 로그인을 하면 됩니다. 자세한 순서는 README의 "구글 설정" 부분을 보세요.'),
  );
  const rb = el('div', 'row-buttons');
  const imp = el('button', null, '① JSON 파일 불러오기');
  imp.onclick = importClient;
  const login = el('button', null, '② 구글 로그인');
  login.disabled = !s.hasClient;
  login.onclick = doLogin;
  rb.append(imp, login);
  b.append(rb);
  return b;
}

function chip(ev) {
  const c = el('div', 'chip' + (ev.allDay ? '' : ' timed'), (ev.allDay ? '' : ev.startTime + ' ') + ev.title);
  c.style.setProperty('--c', colorOf(ev));
  if (ev.allDay) c.style.background = colorOf(ev);
  c.title = `${ev.title}\n${timeText(ev, ev.startDate)}`;
  c.onclick = (e) => { e.stopPropagation(); openEvent(ev); };
  return c;
}

function renderMonth(view) {
  const wrap = el('div', 'month');
  const dow = el('div', 'dow');
  DOW.forEach((d) => dow.append(el('div', null, d)));
  const grid = el('div', 'grid');
  const r = rangeFor('month', state.sel);
  const month = state.sel.slice(0, 7);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const day = addDays(r.start, i);
    const w = dowOf(day);
    const cell = el('div', 'cell');
    cell.classList.toggle('other', day.slice(0, 7) !== month);
    cell.classList.toggle('today', day === state.today);
    cell.classList.toggle('sel', day === state.sel);
    cell.classList.toggle('sun', w === 0);
    cell.classList.toggle('sat', w === 6);
    const head = el('div', 'cell-head');
    head.append(el('div', 'num', String(parseYmd(day).getDate())));
    const hols = holidaysOn(day);
    if (hols.length) {
      const hn = el('div', 'hol-name' + (isRedDay(day) ? '' : ' observance'), hols.map((h) => h.name).join(', '));
      hn.title = hn.textContent;
      head.append(hn);
      cell.classList.toggle('hol', isRedDay(day));
    }
    cell.append(head);
    cell.onclick = () => setSel(day);
    cell.ondblclick = () => openEvent(null, day);
    cell.title = '두 번 클릭하면 일정 추가';
    grid.append(cell);
    cells.push([cell, day]);
  }
  const panel = el('div', 'daypanel');
  wrap.append(dow, grid, panel);
  view.append(wrap);

  // 칸 높이에 맞춰 보이는 일정 수 결정
  const h = cells[0][0].clientHeight;
  const max = Math.max(1, Math.floor((h - 20) / 15));
  for (const [cell, day] of cells) {
    const list = eventsOn(day);
    const show = Math.min(list.length, max);
    list.slice(0, show).forEach((ev) => cell.append(chip(ev)));
    // 못 보여 준 개수는 날짜 숫자 옆에 표시
    if (list.length > show) cell.firstChild.append(el('div', 'more', `+${list.length - show}`));
  }
  dayList(panel, state.sel);
}

function dayList(container, day) {
  const w = dowOf(day);
  const red = w === 0 || isRedDay(day);
  const head = el('div', 'day-head' + (day === state.today ? ' today' : red ? ' sun' : w === 6 ? ' sat' : ''));
  head.append(el('span', null, koDate(day)));
  if (day === state.today) head.append(el('span', 'sub', '오늘'));
  for (const h of holidaysOn(day)) head.append(el('span', 'hol' + (h.isPublic ? '' : ' observance'), h.name));
  const add = el('button', 'add', '＋');
  add.title = '이 날짜에 일정 추가';
  add.onclick = () => openEvent(null, day);
  head.append(add);
  container.append(head);
  const list = eventsOn(day);
  if (!list.length) container.append(el('div', 'empty', '일정 없음'));
  const now = Date.now();
  for (const ev of list) {
    const row = el('div', 'ev' + (ev.endMs < now ? ' past' : ''));
    row.style.setProperty('--c', colorOf(ev));
    row.append(el('div', 'time', timeText(ev, day)));
    const body = el('div', 'title');
    body.append(el('div', null, ev.title));
    if (ev.description && state.view !== 'month') body.append(el('div', 'desc', ev.description));
    row.append(body);
    row.onclick = () => openEvent(ev);
    container.append(row);
  }
}

function renderWeek(view) {
  const list = el('div', 'list');
  const r = rangeFor('week', state.sel);
  for (let i = 0; i < 7; i++) dayList(list, addDays(r.start, i));
  view.append(list);
  const t = list.querySelector('.day-head.today');
  if (t) t.scrollIntoView({ block: 'start' });
}

function renderDay(view) {
  const list = el('div', 'list');
  dayList(list, state.sel);
  view.append(list);
}

function updateQuickDate() {
  $('#quickDate').textContent = state.sel === state.today ? '오늘' : md(state.sel) + `(${DOW[dowOf(state.sel)]})`;
}

// ---------- 빠른 추가 ----------
// 예: "14:00 회의", "오후 2시 30분 방문", "내일 9시 교육", "모레 보고서 마감"(종일)
function parseQuick(text, baseDay) {
  let t = text.trim();
  let day = baseDay;
  const rel = t.match(/^(오늘|내일|모레)\s+/);
  if (rel) {
    day = addDays(state.today, { 오늘: 0, 내일: 1, 모레: 2 }[rel[1]]);
    t = t.slice(rel[0].length);
  }
  const m = t.match(/^(오전|오후)?\s*(\d{1,2})(?::(\d{2})|시\s*(?:(\d{1,2})분|(반))?)\s*(.*)$/);
  if (m && m[6]) {
    let hh = Number(m[2]);
    const mm = Number(m[3] || m[4] || (m[5] ? 30 : 0));
    if (m[1] === '오후' && hh < 12) hh += 12;
    if (m[1] === '오전' && hh === 12) hh = 0;
    // 오전/오후를 안 쓰고 1~7시라고 하면 업무 시간 기준으로 오후로 봄 (새벽은 "오전"을 붙여 입력)
    // ("03:30"처럼 0을 붙여 쓰면 그대로 새벽)
    if (!m[1] && !m[2].startsWith('0') && hh >= 1 && hh <= 7) hh += 12;
    if (hh <= 23 && mm <= 59) {
      const start = `${pad(hh)}:${pad(mm)}`;
      const endH = hh + 1;
      const endDay = endH >= 24 ? addDays(day, 1) : day;
      return {
        title: m[6].trim(), allDay: false, description: '', reminder: 'default',
        startDate: day, startTime: start, endDate: endDay, endTime: `${pad(endH % 24)}:${pad(mm)}`,
      };
    }
  }
  return { title: t, allDay: true, description: '', reminder: 'default', startDate: day, endDate: day, startTime: '', endTime: '' };
}

$('#quickForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#quickText');
  if (!input.value.trim()) return;
  if (!state.status?.connected) return toast('먼저 구글 캘린더를 연결해 주세요.', true);
  const data = parseQuick(input.value, state.sel);
  if (!data.title) return toast('제목을 입력해 주세요.', true);
  try {
    await call(cal.create, data);
    input.value = '';
    toast(`추가됨: ${koDate(data.startDate)} ${data.allDay ? '종일' : data.startTime} ${data.title}`);
    load();
  } catch (err) {
    toast(err.message, true);
  }
});
$('#btnDetailAdd').onclick = () => openEvent(null, state.sel, $('#quickText').value);

// ---------- 일정 수정 창 ----------
const dlg = $('#eventDlg');
const form = $('#eventForm');
let editing = null;

function setTimeEnabled() {
  const allDay = form.allDay.checked;
  form.startTime.disabled = allDay;
  form.endTime.disabled = allDay;
}

function ensureReminderOption(v) {
  const sel = form.reminder;
  if (![...sel.options].some((o) => o.value === String(v))) {
    sel.append(new Option(`${v}분 전`, String(v)));
  }
  sel.value = String(v);
}

function openEvent(ev, day, presetTitle) {
  if (!state.status?.connected) return toast('먼저 구글 캘린더를 연결해 주세요.', true);
  editing = ev || null;
  $('#eventDlgTitle').textContent = ev ? '일정 수정' : '새 일정';
  $('#btnDelete').classList.toggle('hidden', !ev);
  $('#btnOpenGoogle').classList.toggle('hidden', !ev?.htmlLink);
  $('#recurNote').classList.toggle('hidden', !ev?.recurring);
  if (ev) {
    form.title.value = ev.title === '(제목 없음)' ? '' : ev.title;
    form.allDay.checked = ev.allDay;
    form.startDate.value = ev.startDate;
    form.endDate.value = ev.endDate;
    form.startTime.value = ev.startTime || '09:00';
    form.endTime.value = ev.endTime || '10:00';
    form.description.value = ev.description || '';
    ensureReminderOption(ev.reminder);
  } else {
    const parsed = presetTitle ? parseQuick(presetTitle, day) : null;
    form.title.value = parsed?.title || '';
    form.allDay.checked = parsed ? parsed.allDay : false;
    form.startDate.value = parsed?.startDate || day;
    form.endDate.value = parsed?.endDate || day;
    form.startTime.value = parsed?.startTime || '09:00';
    form.endTime.value = parsed?.endTime || '10:00';
    form.description.value = '';
    form.reminder.value = 'default';
  }
  setTimeEnabled();
  dlg.showModal();
  form.title.focus();
}

form.allDay.onchange = setTimeEnabled;
form.startDate.onchange = () => {
  if (form.endDate.value < form.startDate.value) form.endDate.value = form.startDate.value;
};
let lastStart = null;
form.startTime.onfocus = () => { lastStart = form.startTime.value; };
form.startTime.onchange = () => {
  // 시작 시간을 옮기면 종료 시간도 같은 길이만큼 옮김
  if (!lastStart || !form.startTime.value || form.startDate.value !== form.endDate.value) return;
  const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const dur = Math.max(30, toMin(form.endTime.value) - toMin(lastStart));
  const end = toMin(form.startTime.value) + dur;
  if (end < 24 * 60) form.endTime.value = `${pad(Math.floor(end / 60))}:${pad(end % 60)}`;
  lastStart = form.startTime.value;
};

$('#btnCancel').onclick = () => dlg.close();
$('#btnOpenGoogle').onclick = () => editing?.htmlLink && cal.openLink(editing.htmlLink);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    title: form.title.value,
    allDay: form.allDay.checked,
    startDate: form.startDate.value,
    endDate: form.endDate.value,
    startTime: form.startTime.value,
    endTime: form.endTime.value,
    description: form.description.value,
    reminder: form.reminder.value,
  };
  const btn = $('#btnSave');
  btn.disabled = true;
  try {
    if (editing) await call(cal.update, editing.id, data);
    else await call(cal.create, data);
    dlg.close();
    toast(editing ? '수정했습니다.' : '추가했습니다.');
    if (data.startDate !== state.sel && !editing) state.sel = data.startDate;
    load();
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
});

$('#btnDelete').onclick = async () => {
  if (!editing) return;
  if (!confirm(`"${editing.title}" 일정을 삭제할까요?\n구글 캘린더(휴대폰 포함)에서도 지워집니다.`)) return;
  try {
    await call(cal.remove, editing.id);
    dlg.close();
    toast('삭제했습니다.');
    load();
  } catch (err) {
    toast(err.message, true);
  }
};

// ---------- 연결 / 설정 ----------
async function importClient() {
  try {
    state.status = await call(cal.importClient);
    refreshSettings();
    render();
    if (state.status.hasClient) toast('OAuth 클라이언트를 등록했습니다. 이제 구글 로그인을 해 주세요.');
  } catch (e) {
    toast(e.message, true);
  }
}

async function doLogin() {
  toast('브라우저에서 구글 로그인을 진행해 주세요…');
  try {
    state.status = await call(cal.login);
    state.holidayWarned = false;
    toast('구글 캘린더에 연결했습니다.');
    refreshSettings();
    load();
  } catch (e) {
    toast(e.message, true);
  }
}

function refreshSettings() {
  const s = state.status || {};
  const p = $('#connState');
  if (s.mode === 'demo') {
    p.textContent = '테스트 모드 (구글에 연결하지 않음)';
    p.className = 'state bad';
  } else if (s.connected) {
    p.textContent = s.holidayScope
      ? '✅ 연결됨 (기본 캘린더 + 공휴일)'
      : '✅ 연결됨 (기본 캘린더) · 공휴일을 보려면 로그아웃 후 다시 로그인';
    p.className = 'state ok';
  } else {
    p.textContent = s.hasClient ? '로그인 필요' : 'OAuth 클라이언트 JSON 파일을 먼저 불러와 주세요';
    p.className = 'state bad';
  }
  $('#btnLogin').disabled = !s.hasClient;
  $('#btnLogout').disabled = !s.connected;
  if (state.prefs) {
    $('#optAutostart').checked = state.prefs.autostart;
    $('#optAutostart').disabled = !state.prefs.packaged;
    $('#optAutostart').parentElement.title = state.prefs.packaged ? '' : '설치(패키징)된 프로그램에서만 설정할 수 있습니다.';
    $('#optOnTop').checked = state.prefs.alwaysOnTop;
    $('#optHolidays').checked = state.prefs.showHolidays;
    $('#optOpacity').value = state.prefs.opacity;
  }
  $('#btnPin').classList.toggle('on', !!state.prefs?.alwaysOnTop);
}

$('#btnImport').onclick = importClient;
$('#btnLogin').onclick = doLogin;
$('#btnLogout').onclick = async () => {
  if (!confirm('구글 캘린더 연결을 해제할까요? (구글 계정의 위젯 권한도 해제됩니다)')) return;
  state.status = await call(cal.logout).catch((e) => toast(e.message, true));
  refreshSettings();
  load();
};
$('#optAutostart').onchange = async (e) => {
  state.prefs.autostart = await call(cal.setAutostart, e.target.checked).catch((err) => toast(err.message, true));
  refreshSettings();
};
async function setOnTop(on) {
  state.prefs.alwaysOnTop = await call(cal.setAlwaysOnTop, on);
  refreshSettings();
}
$('#optHolidays').onchange = async (e) => {
  state.prefs.showHolidays = await call(cal.setShowHolidays, e.target.checked).catch(() => e.target.checked);
  state.holidayWarned = false;
  if (!state.prefs.showHolidays) state.holidays = {};
  load();
};
$('#optOnTop').onchange = (e) => setOnTop(e.target.checked);
$('#optOpacity').oninput = (e) => {
  cal.setOpacity(e.target.value);
  state.prefs.opacity = Number(e.target.value);
};
$('#btnSettings').onclick = async () => {
  state.status = await call(cal.status).catch(() => state.status);
  refreshSettings();
  $('#settingsDlg').showModal();
};

// ---------- 상단 버튼 / 탭 ----------
$('#btnPin').onclick = () => setOnTop(!state.prefs.alwaysOnTop);
$('#btnMin').onclick = () => cal.minimize();
$('#btnClose').onclick = () => cal.close();
$('#btnRefresh').onclick = () => { load(); toast('새로고침'); };
document.querySelectorAll('.tabs button').forEach((b) => {
  b.onclick = () => {
    state.view = b.dataset.view;
    load();
  };
});
function step(dir) {
  if (state.view === 'day') return setSel(addDays(state.sel, dir));
  if (state.view === 'week') return setSel(addDays(state.sel, 7 * dir));
  const d = parseYmd(state.sel.slice(0, 8) + '01');
  d.setMonth(d.getMonth() + dir);
  const key = ymd(d).slice(0, 7);
  setSel(state.today.slice(0, 7) === key ? state.today : ymd(d));
}
$('#btnPrev').onclick = () => step(-1);
$('#btnNext').onclick = () => step(1);
$('#btnToday').onclick = () => setSel(state.today);

document.addEventListener('keydown', (e) => {
  if (dlg.open || $('#settingsDlg').open || e.target.matches('input, textarea, select')) return;
  if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'ArrowRight') step(1);
  else if (e.key === 'F5') load();
});

let resizeT;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => state.view === 'month' && render(), 120);
});

// 자동 새로고침: 5분마다, 그리고 창을 다시 눌렀을 때(1분 이상 지났으면)
setInterval(load, 5 * 60 * 1000);
cal.onFocus(() => { if (Date.now() - state.lastLoad > 60 * 1000) load(); });
// 날짜가 바뀌면 "오늘" 표시 갱신
setInterval(() => {
  const t = todayYmd();
  if (t !== state.today) {
    if (state.sel === state.today) state.sel = t;
    state.today = t;
    load();
  }
}, 60 * 1000);

(async function init() {
  state.prefs = await call(cal.prefs).catch(() => ({ alwaysOnTop: false, opacity: 1, autostart: false, showHolidays: true }));
  if (state.prefs.demo) $('#modeTag').classList.remove('hidden');
  refreshSettings();
  await load();
  refreshSettings();
})();

// 테스트에서 쓰기 위해 노출
window.__widget = { state, parseQuick, openEvent, setSel };
