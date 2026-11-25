"use strict";
const { contextBridge, ipcRenderer } = require("electron"); // eslint-disable-line @typescript-eslint/no-require-imports
contextBridge.exposeInMainWorld("pasalhoDesktop",Object.freeze({saveEnvelope:record=>ipcRenderer.invoke("ledger:save",record),recoverEnvelopes:()=>ipcRenderer.invoke("ledger:recover")}));
