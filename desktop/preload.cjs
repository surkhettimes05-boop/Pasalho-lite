"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("pasalhoDesktop",Object.freeze({saveEnvelope:record=>ipcRenderer.invoke("ledger:save",record)}));
