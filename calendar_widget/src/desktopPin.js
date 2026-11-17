'use strict';
// 윈도우 전용: 위젯을 "항상 맨 아래"(다른 창과 폴더 창보다 뒤, 바탕화면 바로 위)에 고정합니다.
// - 바탕화면 창(Progman)을 위젯의 "소유자"로 지정하면, 바탕화면 보기(Win+D)를 눌러도
//   위젯이 숨겨지지 않는 것으로 알려져 있습니다 (Rainmeter 같은 바탕화면 위젯이 쓰는 방식).
// - 위젯을 클릭해서 앞으로 올라오면 다시 맨 아래로 내립니다.
// 윈도우가 아니거나 호출에 실패하면 아무것도 하지 않습니다(위젯은 일반 창으로 동작).

const GWLP_HWNDPARENT = -8;
const HWND_BOTTOM = 1;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;

let api = null;

function load() {
  if (api !== null) return api;
  api = false;
  if (process.platform !== 'win32') return api;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    api = {
      FindWindowW: user32.func('intptr_t __stdcall FindWindowW(str16 lpClassName, str16 lpWindowName)'),
      SetWindowLongPtrW: user32.func('intptr_t __stdcall SetWindowLongPtrW(intptr_t hWnd, int nIndex, intptr_t dwNewLong)'),
      SetWindowPos: user32.func(
        'int __stdcall SetWindowPos(intptr_t hWnd, intptr_t hWndInsertAfter, int X, int Y, int cx, int cy, uint32_t uFlags)',
      ),
    };
  } catch (e) {
    console.error('[desktopPin] user32 불러오기 실패:', e.message);
    api = false;
  }
  return api;
}

function hwndOf(win) {
  const buf = win.getNativeWindowHandle();
  return buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0);
}

function supported() {
  return !!load();
}

// 고정: 소유자를 바탕화면(Progman)으로 바꾸고 맨 아래로 내림
function attach(win) {
  const a = load();
  if (!a) return false;
  const progman = a.FindWindowW('Progman', null);
  if (!progman) return false;
  a.SetWindowLongPtrW(hwndOf(win), GWLP_HWNDPARENT, progman);
  toBottom(win);
  return true;
}

// 고정 해제: 소유자 없음으로 되돌림
function detach(win) {
  const a = load();
  if (!a) return false;
  a.SetWindowLongPtrW(hwndOf(win), GWLP_HWNDPARENT, 0);
  return true;
}

function toBottom(win) {
  const a = load();
  if (!a || win.isDestroyed()) return false;
  return !!a.SetWindowPos(hwndOf(win), HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
}

module.exports = { supported, attach, detach, toBottom };
