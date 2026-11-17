'use strict';
// 화면에서 쓰는 일정 모양 <-> 구글 캘린더 API 일정 모양 변환
//
// 화면용 일정(입력값):
//   { title, description, allDay, startDate:'YYYY-MM-DD', startTime:'HH:MM',
//     endDate:'YYYY-MM-DD', endTime:'HH:MM', reminder:'default'|'none'|분(숫자) }
//   종일 일정의 endDate 는 "마지막 날(포함)" 입니다. 구글은 다음 날(미포함)로 저장하므로 여기서 바꿉니다.

const pad = (n) => String(n).padStart(2, '0');

function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

// 현지 시간대 오프셋을 붙인 RFC3339 문자열 (예: 2026-11-17T14:00:00+09:00)
function localDateTime(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const dt = new Date(y, m - 1, d, hh, mm, 0);
  const off = -dt.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${ymd(dt)}T${pad(hh)}:${pad(mm)}:00${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

function validate(input) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const tr = /^\d{2}:\d{2}$/;
  if (!input || typeof input.title !== 'string' || !input.title.trim()) throw new Error('제목을 입력해 주세요.');
  if (!re.test(input.startDate) || !re.test(input.endDate)) throw new Error('날짜 형식이 올바르지 않습니다.');
  if (!input.allDay && (!tr.test(input.startTime) || !tr.test(input.endTime))) {
    throw new Error('시간 형식이 올바르지 않습니다.');
  }
  const s = input.allDay ? input.startDate : input.startDate + 'T' + input.startTime;
  const e = input.allDay ? input.endDate : input.endDate + 'T' + input.endTime;
  if (input.allDay ? e < s : e <= s) throw new Error('끝나는 시간이 시작 시간보다 뒤여야 합니다.');
}

function toGoogleBody(input) {
  validate(input);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const body = {
    summary: input.title.trim(),
    description: input.description || '',
  };
  if (input.allDay) {
    body.start = { date: input.startDate, dateTime: null, timeZone: null };
    body.end = { date: addDays(input.endDate, 1), dateTime: null, timeZone: null };
  } else {
    body.start = { dateTime: localDateTime(input.startDate, input.startTime), timeZone: tz, date: null };
    body.end = { dateTime: localDateTime(input.endDate, input.endTime), timeZone: tz, date: null };
  }
  if (input.reminder === 'none') {
    body.reminders = { useDefault: false, overrides: [] };
  } else if (input.reminder === 'default' || input.reminder == null || input.reminder === '') {
    body.reminders = { useDefault: true };
  } else {
    const min = Number(input.reminder);
    if (!Number.isFinite(min) || min < 0 || min > 40320) throw new Error('알림 시간이 올바르지 않습니다.');
    body.reminders = { useDefault: false, overrides: [{ method: 'popup', minutes: min }] };
  }
  return body;
}

function fromGoogleEvent(ev) {
  const allDay = !!ev.start?.date;
  let startDate, startTime, endDate, endTime, startMs, endMs;
  if (allDay) {
    startDate = ev.start.date;
    endDate = addDays(ev.end?.date || addDays(startDate, 1), -1);
    startTime = '';
    endTime = '';
    startMs = parseYmd(startDate).getTime();
    endMs = parseYmd(addDays(endDate, 1)).getTime();
  } else {
    const s = new Date(ev.start.dateTime);
    const e = new Date(ev.end?.dateTime || ev.start.dateTime);
    startDate = ymd(s);
    endDate = ymd(e);
    startTime = `${pad(s.getHours())}:${pad(s.getMinutes())}`;
    endTime = `${pad(e.getHours())}:${pad(e.getMinutes())}`;
    startMs = s.getTime();
    endMs = e.getTime();
  }
  let reminder = 'default';
  if (ev.reminders && ev.reminders.useDefault === false) {
    const o = (ev.reminders.overrides || [])[0];
    reminder = o ? o.minutes : 'none';
  }
  return {
    id: ev.id,
    title: ev.summary || '(제목 없음)',
    description: ev.description || '',
    allDay,
    startDate,
    startTime,
    endDate,
    endTime,
    startMs,
    endMs,
    colorId: ev.colorId || null,
    htmlLink: ev.htmlLink || null,
    recurring: !!ev.recurringEventId,
    reminder,
  };
}

module.exports = { toGoogleBody, fromGoogleEvent, ymd, addDays, parseYmd, validate };
