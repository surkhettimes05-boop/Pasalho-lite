"use strict";
const { app, BrowserWindow, protocol, ipcMain, session } = require("electron"); // eslint-disable-line @typescript-eslint/no-require-imports
const { readFile } = require("node:fs/promises"); // eslint-disable-line @typescript-eslint/no-require-imports
const { join } = require("node:path"); // eslint-disable-line @typescript-eslint/no-require-imports
const { openLedger } = require("./ledger.cjs"); // eslint-disable-line @typescript-eslint/no-require-imports
protocol.registerSchemesAsPrivileged([{scheme:"pasalho", privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const origin = "pasalho://terminal";
const page = origin + "/offline-pos.html";
let window, ledger;
if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(async () => {
  ledger = openLedger(join(app.getPath("userData"),"sales.sqlite"));
  const assets = new Map([["/offline-pos.html","text/html"],["/offline-pos.js","text/javascript"]]);
  protocol.handle("pasalho", async request => {
    const url = new URL(request.url);
    if (url.host !== "terminal" || request.method !== "GET" || !assets.has(url.pathname)) return new Response("Unavailable in review runtime",{status:503});
    return new Response(await readFile(join(__dirname,"..","public",url.pathname.slice(1))),{headers:{"Content-Type":assets.get(url.pathname),"Content-Security-Policy":"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"}});
  });
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  window = new BrowserWindow({webPreferences:{preload:join(__dirname,"preload.cjs"),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}});
  window.webContents.setWindowOpenHandler(()=>({action:"deny"}));
  window.webContents.on("will-navigate",event=>event.preventDefault());
  window.webContents.on("will-attach-webview",event=>event.preventDefault());
  ipcMain.handle("ledger:save", (event,record)=>{
    if(event.sender!==window.webContents || event.senderFrame!==window.webContents.mainFrame || event.senderFrame.url!==page) throw new Error("Untrusted ledger caller");
    ledger.save(record); return true;
  });
  ipcMain.handle("ledger:recover", event=>{
    if(event.sender!==window.webContents || event.senderFrame!==window.webContents.mainFrame || event.senderFrame.url!==page) throw new Error("Untrusted ledger caller");
    return ledger.recover();
  });
  await window.loadURL(page);
}).catch(error=>{console.error(error);app.exit(1);});
app.on("window-all-closed",()=>app.quit());
app.on("will-quit",()=>ledger?.close());
