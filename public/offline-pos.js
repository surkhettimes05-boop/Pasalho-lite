/* Pasalho's isolated static POS shell. No transaction is considered complete
   before its encrypted payload and signature have committed to IndexedDB. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const money = (cents) => `Rs ${(cents / 100).toFixed(2)}`;
  const date = (iso) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kathmandu", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  let db, key, config, snapshot, sales = [], cart = new Map(), syncing = false, backendOnline = false, halted = false, syncAttention = false;

  function requestResult(request) {
    return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  }
  async function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("pasalho-offline-pos", 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore("config", { keyPath: "id" });
        database.createObjectStore("sales", { keyPath: "id" });
        database.createObjectStore("keys", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Close other terminal tabs and retry."));
    });
  }
  async function read(store, id) { return requestResult(db.transaction(store, "readonly").objectStore(store).get(id)); }
  async function all(store) { return requestResult(db.transaction(store, "readonly").objectStore(store).getAll()); }
  async function write(store, record) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Device storage write failed."));
      tx.onabort = () => reject(tx.error || new Error("Device storage transaction aborted."));
    });
  }
  function bytesToBase64(bytes) { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
  function base64ToBytes(value) { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)); }
  async function deriveKey(passphrase, salt) {
    const raw = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt: base64ToBytes(salt), iterations: 250000, hash: "SHA-256" }, raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function encrypt(value) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
    return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
  }
  async function decrypt(box) {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(box.iv) }, key, base64ToBytes(box.ciphertext)));
  }
  async function requirePersistence() {
    if (!navigator.storage?.persist) throw new Error("This browser cannot guarantee persistent storage. Offline billing is disabled.");
    const granted = await navigator.storage.persisted() || await navigator.storage.persist();
    if (!granted) throw new Error("Persistent device storage was denied. Install or authorize this POS and retry before billing.");
  }
  async function api(path, options) {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options, headers: { "content-type": "application/json", ...(options?.headers || {}) } });
    let body;
    try { body = await response.json(); } catch { throw new Error("Server returned an invalid response."); }
    if (!response.ok || !body.ok) throw new Error(body.code || `HTTP ${response.status}`);
    return body;
  }
  function show(id, visible) { $(id).hidden = !visible; }
  function node(tag, text, className) { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; }
  function error(id, message) { $(id).textContent = message || ""; }

  async function loadCandidates() {
    await loadTerminals();
    try {
      const body = await api("/api/offline/provision");
      $("cashier").replaceChildren(...body.cashiers.map((person) => {
        const option = node("option", `${person.name} (${person.email})`); option.value = person.email; return option;
      }));
      $("candidates").replaceChildren(...body.products.map((product) => {
        const label = node("label", undefined, "row");
        const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.value = product.productId; checkbox.dataset.priceCents = String(product.priceCents); checkbox.checked = product.availableUnits > 0;
        const description = node("span", `${product.name} · ${product.sku} · ${money(product.priceCents)} · ${product.availableUnits} available`);
        label.append(checkbox, description); return label;
      }));
    } catch (cause) { error("setup-error", `Owner sign-in and live pricing are required: ${cause.message}`); }
  }
  async function loadTerminals() {
    try {
      const body = await api("/api/offline/terminals");
      $("terminals").replaceChildren(...body.terminals.map((terminal) => {
        const line = node("div", undefined, "row");
        line.append(node("span", `${terminal.id.slice(0, 8)} · ${terminal.cashier} · ${terminal.revokedAt ? "REVOKED" : `expires ${terminal.expiresAt ? date(terminal.expiresAt) : "unknown"}`}`));
        if (!terminal.revokedAt) {
          const revokeButton = node("button", "Revoke", "secondary");
          revokeButton.onclick = async () => {
            if (!confirm(`Revoke terminal ${terminal.id}? Preserve its local receipts for recovery.`)) return;
            try { await api("/api/offline/provision", { method: "DELETE", body: JSON.stringify({ terminalId: terminal.id }) }); await loadTerminals(); }
            catch (cause) { error("setup-error", `Revocation failed: ${cause.message}`); }
          };
          line.append(revokeButton);
        }
        return line;
      }));
    } catch (cause) { error("setup-error", `Terminal list requires owner sign-in: ${cause.message}`); }
  }
  async function provision() {
    error("setup-error", "");
    $("provision").disabled = true;
    try {
      const passphrase = $("new-passphrase").value;
      if (passphrase.length < 12) throw new Error("Choose a terminal passphrase of at least 12 characters.");
      await requirePersistence();
      const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
      const publicKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
      const terminalId = crypto.randomUUID();
      const approvedPrices = [...$("candidates").querySelectorAll("input:checked")].map((input) => ({ productId: input.value, priceCents: Number(input.dataset.priceCents) }));
      const productIds = approvedPrices.map((item) => item.productId);
      if (!productIds.length) throw new Error("Approve at least one product.");
      const salt = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
      const localKey = await deriveKey(passphrase, salt);
      const body = await api("/api/offline/provision", { method: "POST", body: JSON.stringify({ terminalId, cashierEmail: $("cashier").value, publicKey: { kty: publicKey.kty, crv: publicKey.crv, x: publicKey.x, y: publicKey.y }, productIds, approvedPrices, taxInclusiveApproved: true }) });
      key = localKey;
      const encryptedSnapshot = await encrypt(JSON.stringify(body.snapshot));
      await write("keys", { id: "device", privateKey: keyPair.privateKey });
      await write("config", { id: "terminal", terminalId, salt, encryptedSnapshot, lastSync: null });
      config = await read("config", "terminal");
      if (!config || config.terminalId !== terminalId) throw new Error("Terminal storage verification failed. Stop billing and revoke this device.");
      snapshot = JSON.parse(await decrypt(config.encryptedSnapshot));
      $("new-passphrase").value = "";
      show("setup-panel", false);
      startTerminal();
    } catch (cause) { error("setup-error", cause.message); }
    finally { $("provision").disabled = false; }
  }
  async function unlock() {
    error("unlock-error", "");
    try {
      key = await deriveKey($("passphrase").value, config.salt);
      snapshot = JSON.parse(await decrypt(config.encryptedSnapshot));
      if (snapshot.terminalId !== config.terminalId) throw new Error("Snapshot does not match this terminal.");
      sales = [];
      for (const record of await all("sales")) {
        const payload = JSON.parse(await decrypt(record.encryptedPayload));
        sales.push({ ...record, payload });
      }
      $("passphrase").value = "";
      show("unlock-panel", false);
      startTerminal();
    } catch { key = null; error("unlock-error", "Incorrect passphrase or damaged local storage. Stop billing and contact the owner."); }
  }
  function projected(productId) {
    const product = snapshot.products.find((candidate) => candidate.productId === productId);
    if (!product) return 0;
    return product.availableUnits - sales.filter((entry) => entry.payload.snapshotId === snapshot.id).reduce((sum, entry) => sum + (entry.payload.items.find((item) => item.productId === productId)?.quantity || 0), 0);
  }
  function startTerminal() {
    halted = Boolean(config.revoked);
    show("status-panel", true); show("catalog-panel", true); show("cart-panel", true); show("history-panel", true);
    $("terminal-label").textContent = `${snapshot.storeName} · ${snapshot.cashierName} · ${snapshot.terminalId.slice(0, 8)}`;
    render();
    checkConnection().then(() => syncAll()).catch(() => {});
    $("search").focus();
  }
  function renderCatalog() {
    const query = $("search").value.trim().toLowerCase();
    const matching = snapshot.products.filter((product) => !query || product.sku.toLowerCase().includes(query) || product.name.toLowerCase().includes(query) || product.barcode?.toLowerCase().includes(query)).slice(0, 30);
    $("catalog").replaceChildren(...matching.map((product) => {
      const line = node("div", undefined, "row");
      const info = node("div"); info.append(node("strong", product.name), node("small", `${product.sku} ${product.barcode || ""} · ${money(product.priceCents)} · ${projected(product.productId)} local available`));
      const add = node("button", "Add"); add.disabled = projected(product.productId) <= (cart.get(product.productId) || 0);
      add.onclick = () => { cart.set(product.productId, (cart.get(product.productId) || 0) + 1); $("search").value = ""; render(); $("search").focus(); };
      line.append(info, add); return line;
    }));
  }
  function renderCart() {
    let total = 0;
    $("cart").replaceChildren(...[...cart].map(([id, quantity]) => {
      const product = snapshot.products.find((item) => item.productId === id);
      total += product.priceCents * quantity;
      const line = node("div", undefined, "row");
      const info = node("div"); info.append(node("strong", product.name), node("small", `${quantity} × ${money(product.priceCents)} = ${money(product.priceCents * quantity)}`));
      const controls = node("div"); const minus = node("button", "−", "secondary"); minus.onclick = () => { if (quantity <= 1) cart.delete(id); else cart.set(id, quantity - 1); render(); };
      const plus = node("button", "+", "secondary"); plus.disabled = quantity >= projected(id); plus.onclick = () => { cart.set(id, quantity + 1); render(); };
      controls.append(minus, plus); line.append(info, controls); return line;
    }));
    $("total").textContent = money(total);
    $("finalize").disabled = halted || !cart.size || Date.now() > Date.parse(snapshot.expiresAt);
  }
  function renderHistory() {
    $("history").replaceChildren(...sales.slice().reverse().map((entry) => {
      const line = node("div", undefined, "row");
      const info = node("div"); info.append(node("strong", `${entry.payload.receiptNumber} · ${money(entry.payload.subtotalCents)}`), node("small", `${date(entry.payload.createdAt)} · ${entry.state}${entry.error ? ` · ${entry.error}` : ""}`));
      const print = node("button", "View / print", "secondary"); print.onclick = () => printReceipt(entry.payload, entry.state);
      line.append(info, print); return line;
    }));
  }
  function renderStatus() {
    const pending = sales.filter((entry) => entry.state === "PENDING_SYNC" || entry.state === "SYNCING").length;
    const attention = halted || syncAttention || config.revoked || sales.some((entry) => entry.state === "CONFLICT" || entry.state === "REQUIRES_REVIEW");
    $("pending").textContent = `${pending} pending`;
    const ageHours = Math.max(0, (Date.now() - Date.parse(snapshot.issuedAt)) / 3_600_000).toFixed(1);
    $("snapshot-age").textContent = `Snapshot age ${ageHours} h · issued ${date(snapshot.issuedAt)} · expires ${date(snapshot.expiresAt)}`;
    $("last-sync").textContent = config.lastSync ? date(config.lastSync) : "Never";
    $("connection").textContent = attention ? "ATTENTION REQUIRED" : syncing ? "SYNCING" : backendOnline && pending === 0 ? "ONLINE" : "OFFLINE";
    if (Date.now() > Date.parse(snapshot.expiresAt)) error("sale-error", "Offline authorization expired. Further local sales are disabled.");
  }
  function render() { if (!snapshot) return; renderCatalog(); renderCart(); renderHistory(); renderStatus(); }
  function parseTendered(value) { if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(value.trim())) throw new Error("Enter a valid cash amount with up to two decimals."); const [whole, part = ""] = value.trim().split("."); return Number(whole) * 100 + Number(part.padEnd(2, "0")); }
  async function finalize() {
    error("sale-error", ""); $("finalize").disabled = true;
    try {
      if (!navigator.locks) throw new Error("This browser lacks cross-tab sale locking. Offline billing is disabled.");
      await navigator.locks.request(`pasalho-offline-sale-${snapshot.terminalId}`, async () => {
      sales = [];
      for (const record of await all("sales")) sales.push({ ...record, payload: JSON.parse(await decrypt(record.encryptedPayload)) });
      if (halted) throw new Error("Storage state is uncertain. Stop billing and contact the owner.");
      await requirePersistence();
      if (Date.now() > Date.parse(snapshot.expiresAt) || Date.now() < Date.parse(snapshot.issuedAt) - 5 * 60_000) throw new Error("Offline authorization expired or device clock changed.");
      const items = [...cart].map(([productId, quantity]) => {
        const product = snapshot.products.find((candidate) => candidate.productId === productId);
        if (!product || quantity > projected(productId) || quantity <= 0) throw new Error("Local stock is insufficient.");
        return { productId, quantity, priceCents: product.priceCents, lineTotalCents: product.priceCents * quantity };
      });
      const subtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
      if (!items.length || !subtotalCents || subtotalCents > snapshot.maxTotalCents) throw new Error("Sale is empty or exceeds the approved NPR 50,000 limit.");
      const tenderedCents = parseTendered($("tendered").value);
      if (tenderedCents < subtotalCents) throw new Error("Cash tendered is below the total.");
      const transactionId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const payload = { version: 1, transactionId, snapshotId: snapshot.id, terminalId: snapshot.terminalId, storeId: snapshot.storeId, cashierId: snapshot.cashierId, createdAt, receiptNumber: `OFF-${transactionId.toUpperCase()}`, items, subtotalCents, discountCents: 0, taxPolicy: snapshot.taxPolicy, payment: { method: "CASH", tenderedCents } };
      const payloadText = JSON.stringify(payload);
      const privateKey = (await read("keys", "device"))?.privateKey;
      if (!privateKey) throw new Error("Device signing key is missing. Stop billing.");
      const signature = bytesToBase64(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(payloadText))));
      const encryptedPayload = await encrypt(payloadText);
      const record = { id: transactionId, state: "PENDING_SYNC", encryptedPayload, signature, error: null, updatedAt: createdAt };
      await write("sales", record);
      const persisted = await read("sales", transactionId);
      if (!persisted || await decrypt(persisted.encryptedPayload) !== payloadText || persisted.signature !== signature) throw new Error("Local transaction verification failed. Stop billing.");
      sales.push({ ...record, payload }); cart.clear(); $("tendered").value = ""; render();
      try { printReceipt(payload, "PENDING_SYNC"); }
      catch { error("sale-error", "Sale saved locally, but printing failed. Reprint it from local history."); }
      if (backendOnline) syncAll();
      if (navigator.serviceWorker?.ready) navigator.serviceWorker.ready.then((registration) => registration.sync?.register("pasalho-offline-pos")).catch(() => {});
      });
    } catch (cause) {
      error("sale-error", cause.message);
      if (/storage|verification|signing key|quota/i.test(`${cause.name} ${cause.message}`)) halted = true;
    } finally { render(); }
  }
  function printReceipt(payload, state) {
    const paper = $("receipt"); paper.replaceChildren();
    paper.append(node("h2", "PASALHO · Sales receipt"), node("p", snapshot.storeName), node("p", payload.receiptNumber), node("p", `Transaction ${payload.transactionId}`), node("p", date(payload.createdAt)), node("p", `Cashier ${snapshot.cashierName}`));
    for (const item of payload.items) {
      const product = snapshot.products.find((candidate) => candidate.productId === item.productId);
      const line = node("div", undefined, "row"); line.append(node("span", `${product?.name || item.productId} · ${item.quantity} × ${money(item.priceCents)}`), node("strong", money(item.lineTotalCents))); paper.append(line);
    }
    paper.append(node("p", `Discount: ${money(0)} · Prices tax inclusive`), node("h3", `Total: ${money(payload.subtotalCents)}`), node("p", `Cash tendered: ${money(payload.payment.tenderedCents)}`), node("p", `Change: ${money(payload.payment.tenderedCents - payload.subtotalCents)}`), node("strong", state === "SYNCED" ? "Server confirmed" : state === "REFUNDED" ? "Cash refund recorded by owner · retain refund evidence" : "OFFLINE · Locally completed · Pending server confirmation"));
    window.print();
  }
  async function checkConnection() {
    try { const response = await fetch("/api/ready", { cache: "no-store", signal: AbortSignal.timeout(5000) }); backendOnline = response.ok; }
    catch { backendOnline = false; }
    renderStatus(); return backendOnline;
  }
  async function saveState(entry, state, message) {
    const updatedAt = new Date().toISOString();
    await write("sales", { id: entry.id, state, encryptedPayload: entry.encryptedPayload, signature: entry.signature, error: message || null, updatedAt });
    entry.state = state; entry.error = message || null; entry.updatedAt = updatedAt;
    render();
  }
  async function syncAll(includeReview = false) {
    if (!snapshot || syncing || !backendOnline || halted) return;
    syncing = true; renderStatus();
    try {
      for (const entry of sales) {
        if (entry.state !== "PENDING_SYNC" && entry.state !== "SYNCING" && !(includeReview && ["CONFLICT", "REQUIRES_REVIEW"].includes(entry.state))) continue;
        try {
          await saveState(entry, "SYNCING", null);
          const payloadText = await decrypt(entry.encryptedPayload);
          const result = await api("/api/offline/sync", { method: "POST", body: JSON.stringify({ payload: payloadText, signature: entry.signature }) });
          if (result.transactionId !== entry.id || !["SYNCED", "CONFLICT", "REQUIRES_REVIEW", "REFUNDED"].includes(result.status) || (result.status === "SYNCED" && result.saleId !== entry.id) || (result.status === "REFUNDED" && result.saleId !== null)) throw new Error("Server acknowledgment did not match this sale.");
          await saveState(entry, result.status, result.reason);
          if (result.status === "SYNCED" || result.status === "REFUNDED") { syncAttention = false; config.lastSync = new Date().toISOString(); await write("config", config); }
        } catch (cause) {
          try { await saveState(entry, "PENDING_SYNC", cause.message); }
          catch { halted = true; error("sync-error", "Local storage failed while recording synchronization status. Stop billing and preserve this device."); break; }
          error("sync-error", `Synchronization paused: ${cause.message}`);
          if (["UNAUTHENTICATED", "UNAUTHORIZED_ACTION", "INVALID_OFFLINE_INPUT", "OFFLINE_SIGNATURE_INVALID", "OFFLINE_PRICE_MISMATCH"].includes(cause.message)) syncAttention = true;
          else backendOnline = false;
          break;
        }
      }
    } finally { syncing = false; render(); }
  }
  async function revoke() {
    if (!config || !confirm("Revoke this terminal? Pending local sales must be recovered and reviewed first.")) return;
    try { await api("/api/offline/provision", { method: "DELETE", body: JSON.stringify({ terminalId: config.terminalId }) }); halted = true; config.revoked = true; await write("config", config); error("sync-error", "Terminal revoked. Stop offline billing and retain this device for transaction recovery."); render(); }
    catch (cause) { error("sync-error", `Owner sign-in is required: ${cause.message}`); }
  }
  async function renew() {
    error("sync-error", "");
    if (sales.some((entry) => entry.state !== "SYNCED" && entry.state !== "REFUNDED")) { error("sync-error", "Resolve or synchronize every local sale before renewing this snapshot."); return; }
    try {
      const current = await api("/api/offline/provision");
      const byId = new Map(current.products.map((item) => [item.productId, item]));
      const approvedPrices = snapshot.products.map((previous) => {
        const latest = byId.get(previous.productId);
        if (!latest) throw new Error(`SKU ${previous.sku} no longer has an approved regular price.`);
        return { productId: previous.productId, priceCents: latest.priceCents, sku: previous.sku, name: previous.name, previousPriceCents: previous.priceCents };
      });
      const review = $("renew-review"); review.replaceChildren(node("h3", "Owner price review"), node("p", "Confirm these current Modern Trade regular prices. Prices are tax inclusive; selected SKUs only."));
      for (const item of approvedPrices) review.append(node("div", `${item.name} · ${item.sku} · ${money(item.previousPriceCents)} → ${money(item.priceCents)}`, "row"));
      const approve = node("button", "Approve listed prices and renew");
      review.append(approve); review.hidden = false;
      approve.onclick = async () => {
        approve.disabled = true;
        try { await completeRenewal(approvedPrices); review.hidden = true; }
        catch (cause) { error("sync-error", `Snapshot renewal failed: ${cause.message}`); }
        finally { approve.disabled = false; }
      };
    } catch (cause) { error("sync-error", `Snapshot renewal failed: ${cause.message}`); }
  }
  async function completeRenewal(approvedPrices) {
      const body = await api("/api/offline/provision", { method: "PUT", body: JSON.stringify({ terminalId: snapshot.terminalId, productIds: approvedPrices.map((item) => item.productId), approvedPrices: approvedPrices.map(({ productId, priceCents }) => ({ productId, priceCents })), taxInclusiveApproved: true }) });
      const encryptedSnapshot = await encrypt(JSON.stringify(body.snapshot));
      config.encryptedSnapshot = encryptedSnapshot;
      await write("config", config);
      const persisted = await read("config", "terminal");
      const verified = JSON.parse(await decrypt(persisted.encryptedSnapshot));
      if (verified.id !== body.snapshot.id) throw new Error("Renewed snapshot was not saved. Stop billing.");
      snapshot = verified; cart.clear(); render();
  }
  async function init() {
    try {
      if (!isSecureContext || !indexedDB || !crypto.subtle) throw new Error("HTTPS and a supported browser are required.");
      db = await openDatabase(); config = await read("config", "terminal");
      if (!config) { show("unlock-panel", false); show("setup-panel", true); await loadCandidates(); }
      if ("serviceWorker" in navigator) navigator.serviceWorker.register("/offline-pos-sw.js").catch(() => {});
    } catch (cause) { error("unlock-error", cause.message); }
  }
  $("unlock").onclick = unlock; $("provision").onclick = provision; $("finalize").onclick = finalize;
  $("retry").onclick = () => checkConnection().then(() => syncAll(true)); $("renew").onclick = renew; $("revoke").onclick = revoke;
  $("search").oninput = renderCatalog;
  $("search").onkeydown = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault(); const query = $("search").value.trim().toLowerCase();
    const product = snapshot?.products.find((candidate) => candidate.sku.toLowerCase() === query || candidate.barcode?.toLowerCase() === query);
    if (product && projected(product.productId) > (cart.get(product.productId) || 0)) { cart.set(product.productId, (cart.get(product.productId) || 0) + 1); $("search").value = ""; render(); }
  };
  window.addEventListener("online", () => checkConnection().then(syncAll));
  window.addEventListener("offline", () => { backendOnline = false; if (snapshot) renderStatus(); });
  navigator.serviceWorker?.addEventListener("message", (event) => { if (event.data?.type === "OFFLINE_POS_SYNC") checkConnection().then(syncAll); });
  setInterval(() => { if (snapshot) checkConnection().then(syncAll); }, 30000);
  init();
})();
