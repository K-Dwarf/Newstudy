'use strict';
// 구글 캘린더 연결
// - 로그인: "데스크톱 앱" OAuth 클라이언트 + 루프백(127.0.0.1) 리디렉션 + PKCE
// - 일정: Calendar API v3 의 기본 캘린더(primary) 일정 조회/추가/수정/삭제
const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');
const store = require('./store');
const { toGoogleBody, fromGoogleEvent } = require('./eventFormat');

// calendar.events   : 내 일정 보기/추가/수정/삭제
// calendar.readonly : 공개 캘린더(대한민국 공휴일) 읽기
const SCOPE_EVENTS = 'https://www.googleapis.com/auth/calendar.events';
const SCOPE_READ = 'https://www.googleapis.com/auth/calendar.readonly';
const SCOPE = `${SCOPE_EVENTS} ${SCOPE_READ}`;
const HOLIDAY_CAL = 'ko.south_korea#holiday@group.v.calendar.google.com';
const HOLIDAY_API = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(HOLIDAY_CAL)}/events`;
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

class NeedsLoginError extends Error {
  constructor(msg = '구글 로그인이 필요합니다.') {
    super(msg);
    this.code = 'NEEDS_LOGIN';
  }
}

let accessToken = null;
let accessExpires = 0;
let loginInProgress = null;

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 구글 클라우드 콘솔에서 내려받은 JSON 파일 내용(또는 직접 입력값)을 해석
function parseClientJson(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('JSON 파일 형식이 아닙니다.');
  }
  const c = obj.installed || obj.web || obj;
  if (obj.web) {
    throw new Error('"웹 애플리케이션" 유형입니다. OAuth 클라이언트를 "데스크톱 앱" 유형으로 다시 만들어 주세요.');
  }
  if (!c.client_id || !c.client_secret) {
    throw new Error('client_id / client_secret 을 찾지 못했습니다.');
  }
  return { clientId: c.client_id, clientSecret: c.client_secret };
}

function status() {
  const s = store.getSecure();
  return {
    mode: 'google',
    canEncrypt: store.canEncrypt(),
    hasClient: !!(s.clientId && s.clientSecret),
    connected: !!s.refreshToken,
    // 로그인 때 공휴일 읽기 권한까지 허용했는지 (동의 화면에서 체크를 빼면 false)
    holidayScope: !!s.refreshToken && String(s.grantedScope || '').includes(SCOPE_READ),
  };
}

function setClient({ clientId, clientSecret }) {
  // 클라이언트를 바꾸면 기존 로그인은 무효
  store.saveSecure({ clientId, clientSecret, refreshToken: null });
  accessToken = null;
  return status();
}

async function postForm(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error_description || data.error || `HTTP ${res.status}`);
    err.oauthError = data.error;
    throw err;
  }
  return data;
}

function login() {
  if (loginInProgress) return loginInProgress;
  const s = store.getSecure();
  if (!s.clientId) return Promise.reject(new Error('먼저 OAuth 클라이언트 JSON 파일을 불러와 주세요.'));

  loginInProgress = new Promise((resolve, reject) => {
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    let redirectUri;
    let done = false;

    const finish = (err, val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      server.close();
      err ? reject(err) : resolve(val);
    };

    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/') {
        res.writeHead(404).end();
        return;
      }
      const page = (msg) =>
        `<!doctype html><meta charset="utf-8"><title>캘린더 위젯</title>` +
        `<body style="font-family:sans-serif;padding:40px;text-align:center"><h2>${msg}</h2>` +
        `<p>이 브라우저 탭은 닫아도 됩니다.</p></body>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

      if (u.searchParams.get('state') !== state) {
        res.end(page('잘못된 요청입니다. 위젯에서 다시 로그인해 주세요.'));
        return finish(new Error('로그인 응답이 올바르지 않습니다.'));
      }
      if (u.searchParams.get('error')) {
        res.end(page('로그인이 취소되었습니다.'));
        return finish(new Error('로그인이 취소되었습니다: ' + u.searchParams.get('error')));
      }
      try {
        const tok = await postForm(TOKEN_URL, {
          code: u.searchParams.get('code'),
          client_id: s.clientId,
          client_secret: s.clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          code_verifier: verifier,
        });
        if (!tok.refresh_token) throw new Error('refresh token 을 받지 못했습니다. 다시 시도해 주세요.');
        store.saveSecure({ refreshToken: tok.refresh_token, grantedScope: tok.scope || '' });
        accessToken = tok.access_token;
        accessExpires = Date.now() + (tok.expires_in - 60) * 1000;
        res.end(page('✅ 구글 캘린더 연결 완료'));
        finish(null, status());
      } catch (e) {
        res.end(page('연결에 실패했습니다: ' + String(e.message).replace(/[<>&]/g, '')));
        finish(e);
      }
    });

    const timer = setTimeout(() => finish(new Error('로그인 시간이 초과되었습니다(5분).')), 5 * 60 * 1000);

    server.listen(0, '127.0.0.1', () => {
      redirectUri = `http://127.0.0.1:${server.address().port}`;
      const url =
        AUTH_URL +
        '?' +
        new URLSearchParams({
          client_id: s.clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: SCOPE,
          access_type: 'offline',
          prompt: 'consent',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state,
        });
      shell.openExternal(url);
    });
  }).finally(() => {
    loginInProgress = null;
  });
  return loginInProgress;
}

async function logout() {
  const s = store.getSecure();
  if (s.refreshToken) {
    // 구글 쪽 권한도 해제 (실패해도 PC 쪽 정보는 지움)
    await postForm(REVOKE_URL, { token: s.refreshToken }).catch(() => {});
  }
  store.saveSecure({ refreshToken: null });
  accessToken = null;
  return status();
}

async function getAccessToken(force = false) {
  if (!force && accessToken && Date.now() < accessExpires) return accessToken;
  const s = store.getSecure();
  if (!s.refreshToken) throw new NeedsLoginError();
  try {
    const tok = await postForm(TOKEN_URL, {
      client_id: s.clientId,
      client_secret: s.clientSecret,
      refresh_token: s.refreshToken,
      grant_type: 'refresh_token',
    });
    accessToken = tok.access_token;
    accessExpires = Date.now() + (tok.expires_in - 60) * 1000;
    return accessToken;
  } catch (e) {
    if (e.oauthError === 'invalid_grant') {
      // 동의 화면이 "테스트" 상태면 7일마다 이렇게 됩니다.
      store.saveSecure({ refreshToken: null });
      accessToken = null;
      throw new NeedsLoginError('로그인이 만료되었습니다. 다시 로그인해 주세요.');
    }
    throw e;
  }
}

async function api(method, url, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAccessToken(attempt > 0);
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && attempt === 0) continue;
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error?.message || `HTTP ${res.status}`;
      if (res.status === 410) throw new Error('이미 삭제된 일정입니다.');
      throw new Error('구글 캘린더 오류: ' + msg);
    }
    return data;
  }
  throw new NeedsLoginError();
}

async function listEvents(timeMin, timeMax) {
  const out = [];
  let pageToken;
  do {
    const q = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '2500',
      ...(pageToken ? { pageToken } : {}),
    });
    const data = await api('GET', `${API}?${q}`);
    for (const ev of data.items || []) {
      if (ev.status === 'cancelled') continue;
      out.push(fromGoogleEvent(ev));
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

// 대한민국 공휴일 (구글 공개 캘린더). 같은 달은 다시 받지 않도록 6시간 동안 기억.
const holidayCache = new Map();
async function listHolidays(timeMin, timeMax) {
  if (!status().holidayScope) {
    const e = new Error('공휴일을 보려면 ⚙ 설정에서 로그아웃 후 다시 로그인해 주세요(공휴일 읽기 권한 필요).');
    e.code = 'HOLIDAY_SCOPE';
    throw e;
  }
  const key = timeMin + '|' + timeMax;
  const hit = holidayCache.get(key);
  if (hit && Date.now() - hit.at < 6 * 3600 * 1000) return hit.data;
  const q = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
  const data = await api('GET', `${HOLIDAY_API}?${q}`);
  const out = (data.items || [])
    .filter((ev) => ev.start?.date)
    .map((ev) => ({
      name: ev.summary || '',
      startDate: ev.start.date,
      endDate: ev.end?.date || ev.start.date, // 마지막 날 다음 날(미포함)
      // 구글 휴일 캘린더는 설명에 "공휴일"/"Public holiday" 또는 "기념일"/"Observance" 를 적어 둡니다.
      // 설명이 없으면 공휴일로 봅니다.
      isPublic: !/기념일|Observance/i.test(ev.description || ''),
    }));
  holidayCache.set(key, { at: Date.now(), data: out });
  return out;
}

// 내 기본 캘린더의 색 (구글 캘린더에서 정한 색). 일정에 색을 따로 안 정했을 때 이 색을 씀
async function calendarColor() {
  if (!status().holidayScope) return null; // 캘린더 보기 권한이 있어야 읽을 수 있음
  try {
    const d = await api('GET', 'https://www.googleapis.com/calendar/v3/users/me/calendarList/primary');
    return /^#[0-9a-f]{6}$/i.test(d.backgroundColor || '') ? d.backgroundColor : null;
  } catch {
    return null;
  }
}

// 새로 만들 때는 null 항목을 뺌 (null 은 수정(PATCH) 때 "종일↔시간" 전환을 위해서만 필요)
function stripNulls(obj) {
  return JSON.parse(JSON.stringify(obj, (_k, v) => (v === null ? undefined : v)));
}

async function createEvent(input) {
  return fromGoogleEvent(await api('POST', API, stripNulls(toGoogleBody(input))));
}

async function updateEvent(id, input) {
  return fromGoogleEvent(await api('PATCH', `${API}/${encodeURIComponent(id)}`, toGoogleBody(input)));
}

async function deleteEvent(id) {
  await api('DELETE', `${API}/${encodeURIComponent(id)}`);
  return true;
}

module.exports = {
  parseClientJson,
  status,
  setClient,
  login,
  logout,
  listEvents,
  listHolidays,
  calendarColor,
  createEvent,
  updateEvent,
  deleteEvent,
};
