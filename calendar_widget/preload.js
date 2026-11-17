'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('cal', {
  status: call('cal:status'),
  importClient: call('cal:importClient'),
  login: call('cal:login'),
  logout: call('cal:logout'),
  list: call('cal:list'),
  holidays: call('cal:holidays'),
  calendarColor: call('cal:calendarColor'),
  create: call('cal:create'),
  update: call('cal:update'),
  remove: call('cal:delete'),
  prefs: call('app:prefs'),
  setAutostart: call('app:setAutostart'),
  setShowHolidays: call('app:setShowHolidays'),
  setAlwaysOnTop: call('win:alwaysOnTop'),
  setPinDesktop: call('win:pinDesktop'),
  setOpacity: call('win:opacity'),
  setBgOpacity: call('win:bgOpacity'),
  setReadable: call('app:setReadable'),
  resizeTo: call('win:resizeTo'),
  minimize: call('win:minimize'),
  close: call('win:close'),
  openLink: call('app:openLink'),
  decorGet: call('decor:get'),
  decorSave: call('decor:save'),
  decorPick: call('decor:pick'),
  decorImportPath: call('decor:importPath'),
  decorImportBytes: call('decor:importBytes'),
  // 끌어다 놓은 파일의 실제 경로 (붙여넣은 스크린샷처럼 경로가 없으면 빈 문자열)
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },
  onFocus: (fn) => ipcRenderer.on('win:focus', () => fn()),
  onPrefs: (fn) => ipcRenderer.on('prefs:changed', (_e, p) => fn(p)),
});
