'use strict';
// 테스트용 가짜 캘린더 (npm run demo). 구글에 연결하지 않고 메모리에만 저장합니다.
const { toGoogleBody, fromGoogleEvent, ymd, addDays } = require('./eventFormat');

let seq = 1;
const events = new Map();

function add(body, colorId) {
  const id = 'demo' + seq++;
  const ev = { id, htmlLink: null, ...body, ...(colorId ? { colorId: String(colorId) } : {}) };
  events.set(id, ev);
  return ev;
}

function seed() {
  const today = ymd(new Date());
  const make = (title, dayOffset, start, end, extra = {}) =>
    add(
      toGoogleBody({
        title,
        description: extra.description || '',
        allDay: !start,
        startDate: addDays(today, dayOffset),
        endDate: addDays(today, dayOffset + (extra.days || 0)),
        startTime: start || '',
        endTime: end || '',
        reminder: extra.reminder ?? 'default',
      }),
      extra.colorId,
    );
  make('주간 사례회의', 0, '10:00', '11:00', { description: '3층 회의실' });
  make('어르신 생신잔치 준비', 0, '14:00', '15:30');
  make('보조금 정산 마감', 2, null, null, { reminder: 1440, colorId: 11 });
  make('자원봉사자 교육', 3, '13:00', '17:00', { colorId: 3 });
  make('가정방문 (김○○님)', -2, '15:00', '16:00');
  make('연말 행사 주간', 7, null, null, { days: 2, colorId: 2 });
  make('운영위원회', 9, '16:00', '17:30');
  make('건강검진', 12, '09:00', '10:00', { reminder: 60 });
  make('팀 회식', 12, '18:30', '20:30');
  make('월간 보고서 제출', 12, null, null, { colorId: 5 });
  make('물품 구매 요청', 12, '11:00', '11:30');
}
seed();

let connected = true;

module.exports = {
  parseClientJson: () => ({ clientId: 'demo', clientSecret: 'demo' }),
  calendarColor: async () => null,
  status: () => ({ mode: 'demo', canEncrypt: true, hasClient: true, connected, holidayScope: connected }),
  // 테스트용 공휴일: 날짜가 매년 같은 양력 공휴일만 넣음 (음력 공휴일·대체공휴일은 실제 연결 시 구글에서 받아옴)
  async listHolidays(timeMin, timeMax) {
    const a = new Date(timeMin);
    const b = new Date(timeMax);
    const out = [];
    const fixed = [['01-01', '신정'], ['03-01', '삼일절'], ['05-05', '어린이날'], ['05-08', '어버이날', false],
      ['06-06', '현충일'], ['08-15', '광복절'], ['10-03', '개천절'], ['10-09', '한글날'], ['12-25', '기독탄신일']];
    for (let y = a.getFullYear(); y <= b.getFullYear(); y++) {
      for (const [mdStr, name, isPublic = true] of fixed) {
        const startDate = `${y}-${mdStr}`;
        const d = new Date(startDate + 'T00:00:00');
        if (d >= a && d < b) out.push({ name, startDate, endDate: addDays(startDate, 1), isPublic });
      }
    }
    return out;
  },
  setClient() {
    return this.status();
  },
  clearClient() {
    return this.status();
  },
  async login() {
    connected = true;
    return this.status();
  },
  async logout() {
    connected = false;
    return this.status();
  },
  async listEvents(timeMin, timeMax) {
    if (!connected) {
      const e = new Error('구글 로그인이 필요합니다.');
      e.code = 'NEEDS_LOGIN';
      throw e;
    }
    const a = Date.parse(timeMin);
    const b = Date.parse(timeMax);
    return [...events.values()]
      .map(fromGoogleEvent)
      .filter((e) => e.endMs > a && e.startMs < b)
      .sort((x, y) => x.startMs - y.startMs);
  },
  async createEvent(input) {
    return fromGoogleEvent(add(toGoogleBody(input)));
  },
  async updateEvent(id, input) {
    if (!events.has(id)) throw new Error('이미 삭제된 일정입니다.');
    const ev = { ...events.get(id), ...toGoogleBody(input) };
    events.set(id, ev);
    return fromGoogleEvent(ev);
  },
  async deleteEvent(id) {
    events.delete(id);
    return true;
  },
};
