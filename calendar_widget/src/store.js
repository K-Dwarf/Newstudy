'use strict';
// 설정 저장소
// - settings.json : 창 위치, 항상 위, 투명도 같은 일반 설정 (비밀 값 없음)
// - secure.bin    : 구글 OAuth 클라이언트 정보와 refresh token.
//                   Electron safeStorage(윈도우에서는 DPAPI)로 암호화해서 저장합니다.
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

function dir() {
  return app.getPath('userData');
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

const settingsFile = () => path.join(dir(), 'settings.json');
const secureFile = () => path.join(dir(), 'secure.bin');

function getSettings() {
  return {
    bounds: null,
    alwaysOnTop: false,
    opacity: 1,
    showHolidays: true,
    readable: true, // 글자 뒤 받침 유지 (가독성 보호)
    ...readJson(settingsFile(), {}),
  };
}

function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  fs.mkdirSync(dir(), { recursive: true });
  writeAtomic(settingsFile(), JSON.stringify(next, null, 2));
  return next;
}

function canEncrypt() {
  return safeStorage.isEncryptionAvailable();
}

function getSecure() {
  try {
    if (!canEncrypt()) return {};
    const buf = fs.readFileSync(secureFile());
    return JSON.parse(safeStorage.decryptString(buf));
  } catch {
    return {};
  }
}

function saveSecure(patch) {
  if (!canEncrypt()) {
    throw new Error('이 PC에서는 암호화 저장을 쓸 수 없어 로그인 정보를 저장하지 않았습니다.');
  }
  const next = { ...getSecure(), ...patch };
  for (const k of Object.keys(next)) if (next[k] == null) delete next[k];
  fs.mkdirSync(dir(), { recursive: true });
  writeAtomic(secureFile(), safeStorage.encryptString(JSON.stringify(next)));
  return next;
}

function clearSecure() {
  try {
    fs.unlinkSync(secureFile());
  } catch {
    /* 없으면 무시 */
  }
}

module.exports = { getSettings, saveSettings, getSecure, saveSecure, clearSecure, canEncrypt };
