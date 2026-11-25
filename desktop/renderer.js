(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const money = (cents) => `Rs ${(cents / 100).toFixed(2)}`;
  const show = (id, yes) => { $(id).hidden = !yes; };
  const node = (tag, label) => { const n = document.createElement(tag); if (label !== undefined) n.textContent = label; return n; };
  let state, candidates, cart = new Map(), currentId = null, busy = false;

  function message(value) { $('message').textContent = value || ''; }
  async function run(action) { if (busy) return; busy = true; try { await action(); } catch (error) { message(error.message || String(error)); } finally { busy = false; } }
  async function refresh() { state = await window.pasalho.status(); render(); }
  function projected(product) {
    const used = (state.sales || []).filter((s) => s.payload.snapshotId === state.snapshot.id).reduce((n, sale) => n + (sale.payload.items.find((i) => i.productId === product.productId)?.quantity || 0), 0);
    return product.availableUnits - used;
  }
  function render() {
    $('backend').value = state.backendUrl || '';
    const ready = state.provisioned && state.unlocked;
    show('setup', !state.provisioned && !state.ledgerError);
    show('unlock', state.provisioned && !state.unlocked);
    show('recovery', !!state.ledgerError);
    for (const id of ['status', 'catalog-panel', 'cart-panel', 'history-panel']) show(id, ready);
    if (state.ledgerError) { message(`Local database unavailable: ${state.ledgerError}`); return; }
    if (!ready) return;
    $('terminal').textContent = `${state.snapshot.storeName} · ${state.snapshot.cashierName} · ${state.snapshot.terminalId.slice(0, 8)}`;
    $('expiry').textContent = `Approval expires ${new Date(state.snapshot.expiresAt).toLocaleString('en-NP', { timeZone: 'Asia/Kathmandu' })}`;
    const pending = state.counts.find((c) => c.state === 'PENDING_SYNC')?.count || 0;
    $('connection').textContent = `${pending} pending sync`;
    renderCatalog(); renderCart(); renderHistory();
  }
  function renderCatalog() {
    const q = $('search').value.trim().toLowerCase();
    $('catalog').replaceChildren(...state.snapshot.products.filter((p) => !q || p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.barcode?.toLowerCase().includes(q)).slice(0, 30).map((p) => {
      const line = node('div'); line.className = 'row';
      line.append(node('span', `${p.name} · ${p.sku} · ${p.barcode || ''} · ${money(p.priceCents)} · ${projected(p)} local available`));
      const add = node('button', 'Add'); add.disabled = projected(p) <= (cart.get(p.productId) || 0);
      add.onclick = () => { cart.set(p.productId, (cart.get(p.productId) || 0) + 1); $('search').value = ''; render(); $('search').focus(); };
      line.append(add); return line;
    }));
  }
  function renderCart() {
    let total = 0;
    $('cart').replaceChildren(...[...cart].map(([id, quantity]) => {
      const p = state.snapshot.products.find((item) => item.productId === id);
      total += p.priceCents * quantity;
      const row = node('div'); row.className = 'row'; row.append(node('span', `${p.name} · ${quantity} × ${money(p.priceCents)}`));
      const buttons = node('span'); const minus = node('button', '−'); minus.onclick = () => { if (quantity === 1) cart.delete(id); else cart.set(id, quantity - 1); render(); };
      const plus = node('button', '+'); plus.disabled = quantity >= projected(p); plus.onclick = () => { cart.set(id, quantity + 1); render(); };
      buttons.append(minus, plus); row.append(buttons); return row;
    }));
    $('total').textContent = money(total);
    $('finalize').disabled = !cart.size || Date.now() > Date.parse(state.snapshot.expiresAt);
  }
  function renderHistory() {
    $('history').replaceChildren(...(state.sales || []).map((sale) => {
      const row = node('div'); row.className = 'row';
      row.append(node('span', `${sale.payload.receiptNumber} · ${money(sale.payload.subtotalCents)} · ${sale.state}${sale.reason ? ` · ${sale.reason}` : ''}`));
      const print = node('button', 'Reprint'); print.onclick = () => run(async () => { const result = await window.pasalho.print(sale.id); message(result.printed ? 'Receipt sent to printer.' : `Sale remains saved. Printing failed: ${result.reason}`); });
      row.append(print); return row;
    }));
  }
  function cents(raw) {
    if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(raw.trim())) throw new Error('Enter a valid cash amount with up to two decimals.');
    const [whole, fraction = ''] = raw.trim().split('.'); return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  }
  $('save-backend').onclick = () => run(async () => { await window.pasalho.configure($('backend').value); await refresh(); message('Backend URL saved. Sign in as Owner/Admin.'); });
  $('login').onclick = $('login-again').onclick = () => run(() => window.pasalho.openLogin());
  $('load-candidates').onclick = () => run(async () => {
    candidates = await window.pasalho.candidates();
    $('cashier').replaceChildren(...candidates.cashiers.map((person) => { const option = node('option', `${person.name} (${person.email})`); option.value = person.email; return option; }));
    $('candidates').replaceChildren(...candidates.products.map((p) => { const label = node('label'); const check = node('input'); check.type = 'checkbox'; check.value = p.productId; check.checked = p.availableUnits > 0; label.append(check, node('span', ` ${p.name} · ${p.sku} · ${money(p.priceCents)} · ${p.availableUnits} available`)); return label; }));
  });
  $('provision').onclick = () => run(async () => {
    if (!candidates || !confirm('Approve the selected Modern Trade regular prices for this terminal for eight hours?')) return;
    const selected = new Set([...$('candidates').querySelectorAll('input:checked')].map((i) => i.value));
    const approvedPrices = candidates.products.filter((p) => selected.has(p.productId)).map((p) => ({ productId: p.productId, priceCents: p.priceCents }));
    state = await window.pasalho.provision({ cashierEmail: $('cashier').value, approvedPrices, passphrase: $('new-passphrase').value });
    $('new-passphrase').value = ''; state.backendUrl = $('backend').value; render(); message('Terminal provisioned. Make an encrypted backup to an independent drive before billing.');
  });
  $('unlock-button').onclick = () => run(async () => { state = await window.pasalho.unlock($('passphrase').value); $('passphrase').value = ''; state.backendUrl = $('backend').value; render(); });
  $('lock').onclick = () => run(async () => { await window.pasalho.lock(); await refresh(); });
  $('search').oninput = renderCatalog;
  $('search').onkeydown = (event) => {
    if (event.key !== 'Enter' || !state?.unlocked) return;
    event.preventDefault(); const q = $('search').value.trim().toLowerCase();
    const p = state.snapshot.products.find((item) => item.barcode?.toLowerCase() === q || item.sku.toLowerCase() === q);
    if (p && projected(p) > (cart.get(p.productId) || 0)) { cart.set(p.productId, (cart.get(p.productId) || 0) + 1); $('search').value = ''; render(); }
  };
  $('finalize').onclick = () => run(async () => {
    if (!currentId) currentId = crypto.randomUUID();
    const command = { transactionId: currentId, items: [...cart].map(([productId, quantity]) => ({ productId, quantity })), tenderedCents: cents($('tendered').value) };
    let result;
    try { result = await window.pasalho.finalize(command); }
    catch (error) {
      const latest = await window.pasalho.status();
      const persisted = latest.sales.find((sale) => sale.id === currentId);
      if (!persisted) throw error;
      result = { payload: persisted.payload, status: latest };
      message('Sale committed locally before the response was interrupted. Reprint from history.');
    }
    state = result.status; state.backendUrl = $('backend').value; cart.clear(); currentId = null; $('tendered').value = ''; render();
    message('Cash sale committed locally. Receipt is provisional until server confirmation.');
    try { const printed = await window.pasalho.print(result.payload.transactionId); if (!printed.printed) message(`Sale saved locally; printer failed: ${printed.reason}. Use Reprint.`); }
    catch (error) { message(`Sale saved locally; printer failed: ${error.message}. Use Reprint.`); }
  });
  $('clear-cart').onclick = () => run(async () => {
    const latest = await window.pasalho.status();
    if (currentId && latest.sales.some((sale) => sale.id === currentId)) throw new Error('This sale was already saved. Reprint its receipt from history.');
    currentId = null; cart.clear(); $('tendered').value = ''; state = latest; render(); message('Unsaved cart cleared.');
  });
  $('sync').onclick = () => run(async () => { const result = await window.pasalho.sync(true); state = result.status; state.backendUrl = $('backend').value; render(); message(`${result.processed} receipt(s) reconciled. Review any conflicts before daily close.`); });
  $('renew').onclick = () => run(async () => {
    const latest = await window.pasalho.candidates(); const byId = new Map(latest.products.map((p) => [p.productId, p]));
    const prices = state.snapshot.products.map((p) => { const fresh = byId.get(p.productId); if (!fresh) throw new Error(`${p.sku} no longer has an approved regular price.`); return { productId: p.productId, priceCents: fresh.priceCents, old: p.priceCents, name: p.name }; });
    if (!confirm(`Review renewed tax inclusive prices:\n${prices.map((p) => `${p.name}: ${money(p.old)} → ${money(p.priceCents)}`).join('\n')}`)) return;
    state = await window.pasalho.renew({ approvedPrices: prices.map(({ productId, priceCents }) => ({ productId, priceCents })) }); state.backendUrl = $('backend').value; render();
  });
  $('backup').onclick = () => run(async () => { const phrase = prompt('Enter an independent backup passphrase (12+ characters). Store it separately from the backup.'); if (!phrase) return; const result = await window.pasalho.backup(phrase); message(result ? `Encrypted backup saved: ${result.destination}\nSHA-256: ${result.sha256}` : 'Backup cancelled.'); });
  $('restore').onclick = () => run(async () => { const phrase = prompt('Enter the independent backup passphrase.'); if (!phrase) return; state = await window.pasalho.restore(phrase); render(); message('Backup restored. Unlock the terminal and reconcile every pending receipt.'); });
  refresh().catch((error) => message(error.message));
})();
