'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('cal', {
  status: call('cal:status'),
  importClient: call('cal:importClient'),
  login: call('cal:login'),
  logout: call('cal:logout'),
  list: call('cal:list'),
  create: call('cal:create'),
  update: call('cal:update'),
  remove: call('cal:delete'),
  prefs: call('app:prefs'),
  setAutostart: call('app:setAutostart'),
  setAlwaysOnTop: call('win:alwaysOnTop'),
  setOpacity: call('win:opacity'),
  minimize: call('win:minimize'),
  close: call('win:close'),
  openLink: call('app:openLink'),
  onFocus: (fn) => ipcRenderer.on('win:focus', () => fn()),
});
