'use strict';
// 테스트용 가짜 캘린더 (npm run demo). 구글에 연결하지 않고 메모리에만 저장합니다.
const { toGoogleBody, fromGoogleEvent, ymd, addDays } = require('./eventFormat');

let seq = 1;
const events = new Map();

function add(body) {
  const id = 'demo' + seq++;
  const ev = { id, htmlLink: null, ...body };
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
    );
  make('주간 사례회의', 0, '10:00', '11:00', { description: '3층 회의실' });
  make('어르신 생신잔치 준비', 0, '14:00', '15:30');
  make('보조금 정산 마감', 2, null, null, { reminder: 1440 });
  make('자원봉사자 교육', 3, '13:00', '17:00');
  make('가정방문 (김○○님)', -2, '15:00', '16:00');
  make('연말 행사 주간', 7, null, null, { days: 2 });
  make('운영위원회', 9, '16:00', '17:30');
  make('건강검진', 12, '09:00', '10:00', { reminder: 60 });
  make('팀 회식', 12, '18:30', '20:30');
  make('월간 보고서 제출', 12, null, null);
  make('물품 구매 요청', 12, '11:00', '11:30');
}
seed();

let connected = true;

module.exports = {
  parseClientJson: () => ({ clientId: 'demo', clientSecret: 'demo' }),
  status: () => ({ mode: 'demo', canEncrypt: true, hasClient: true, connected }),
  setClient() {
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
