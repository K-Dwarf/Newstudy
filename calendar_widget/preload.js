'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('cal', {
  status: call('cal:status'),
  importClient: call('cal:importClient'),
  login: call('cal:login'),
  logout: call('cal:logout'),
  list: call('cal:list'),
  holidays: call('cal:holidays'),
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
  resizeTo: call('win:resizeTo'),
  minimize: call('win:minimize'),
  close: call('win:close'),
  openLink: call('app:openLink'),
  decorGet: call('decor:get'),
  decorSave: call('decor:save'),
  decorPick: call('decor:pick'),
  onFocus: (fn) => ipcRenderer.on('win:focus', () => fn()),
  onPrefs: (fn) => ipcRenderer.on('prefs:changed', (_e, p) => fn(p)),
});
