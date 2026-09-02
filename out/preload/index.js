"use strict";
const electron = require("electron");
const IPC = {
  sidebarToggle: "swiftkit:sidebar-toggle",
  sidebarSetOpen: "swiftkit:sidebar-set-open",
  sidebarState: "swiftkit:sidebar-state",
  sessionState: "swiftkit:session-state",
  xpState: "swiftkit:xp-state"
};
function subscribe(channel, cb) {
  const handler = (_e, value) => cb(value);
  electron.ipcRenderer.on(channel, handler);
  return () => {
    electron.ipcRenderer.off(channel, handler);
  };
}
const api = {
  sidebar: {
    toggle: () => electron.ipcRenderer.invoke(IPC.sidebarToggle),
    setOpen: (open) => electron.ipcRenderer.invoke(IPC.sidebarSetOpen, open),
    onState: (cb) => subscribe(IPC.sidebarState, cb)
  },
  session: {
    onState: (cb) => subscribe(IPC.sessionState, cb)
  },
  xp: {
    onState: (cb) => subscribe(IPC.xpState, cb)
  }
};
electron.contextBridge.exposeInMainWorld("swiftkit", api);
