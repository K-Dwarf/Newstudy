'use strict';
// 배포용 빌드 준비: 구글 OAuth 클라이언트(데스크톱 앱) JSON 을 프로그램 안에 넣습니다.
// - 이 폴더(calendar_widget)에 구글 콘솔에서 받은 client_secret_....json 을 하나 두거나,
//   환경 변수 CLIENT_JSON 에 파일 경로를 지정하면 그 파일을 씁니다.
// - 결과는 embedded-client.json (client_id, client_secret 만). 이 파일과 원본 JSON 은
//   .gitignore 에 들어 있어 저장소(깃허브)에 올라가지 않습니다.
// - JSON 이 없으면 내장 없이 빌드합니다 (받는 사람이 직접 JSON 을 불러와야 함).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'embedded-client.json');

function fail(msg) {
  console.error('\n[오류] ' + msg + '\n');
  process.exit(1);
}

let src = process.env.CLIENT_JSON ? path.resolve(process.env.CLIENT_JSON) : null;
if (!src) {
  const found = fs.readdirSync(root).filter((f) => /^client_secret.*\.json$/i.test(f) || f === 'oauth-client.json');
  if (found.length > 1) fail(`등록증 JSON 이 여러 개 있습니다 (${found.join(', ')}). 쓸 파일 하나만 남겨 주세요.`);
  src = found[0] ? path.join(root, found[0]) : null;
}

if (!src) {
  if (fs.existsSync(out)) fs.unlinkSync(out);
  console.warn('\n[안내] 등록증 JSON 이 없어 내장하지 않고 빌드합니다.');
  console.warn('       설치한 사람이 위젯 설정에서 직접 JSON 을 불러와야 로그인할 수 있습니다.\n');
  process.exit(0);
}

let obj;
try {
  obj = JSON.parse(fs.readFileSync(src, 'utf8'));
} catch (e) {
  fail(`${path.basename(src)} 을(를) 읽지 못했습니다: ${e.message}`);
}
if (obj.web) fail('"웹 애플리케이션" 유형입니다. 구글 콘솔에서 "데스크톱 앱" 유형으로 만든 JSON 을 쓰세요.');
const c = obj.installed;
if (!c || !c.client_id || !c.client_secret) fail('데스크톱 앱 OAuth 클라이언트 JSON 형식이 아닙니다 (installed.client_id / client_secret 없음).');

fs.writeFileSync(out, JSON.stringify({ installed: { client_id: c.client_id, client_secret: c.client_secret } }));
console.log(`\n[완료] 등록증을 내장합니다: ${path.basename(src)} (client_id ${c.client_id.slice(0, 10)}…)\n`);
