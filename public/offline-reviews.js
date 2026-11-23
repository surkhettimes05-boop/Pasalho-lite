(() => {
  "use strict";
  const list = document.getElementById("reviews");
  const message = document.getElementById("message");
  const node = (tag, value) => { const element = document.createElement(tag); if (value !== undefined) element.textContent = value; return element; };
  const money = (cents) => `NPR ${(cents / 100).toFixed(2)}`;
  async function load() {
    message.textContent = "Loading reviews…"; message.className = "muted";
    try {
      const response = await fetch("/api/offline/reviews", { credentials: "same-origin", cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.code || "Review list unavailable");
      list.replaceChildren();
      if (!body.reviews.length) list.append(node("p", "No offline cash reviews."));
      for (const review of body.reviews) {
        const sale = review.sale;
        const card = node("article");
        card.append(node("h2", `${sale.receiptNumber} · ${money(sale.subtotalCents)}`), node("p", `${review.status} · ${review.reason} · Local time ${new Date(sale.createdAt).toLocaleString("en-NP")}`));
        card.append(node("p", `Terminal ${sale.terminalId} · Cashier ${sale.cashierId}`));
        for (const item of sale.items) card.append(node("p", `${item.productId} · ${item.quantity} × ${money(item.priceCents)} = ${money(item.lineTotalCents)}`));
        const digest = node("code", `Evidence hash: ${review.payloadHash}`); card.append(digest);
        if (review.resolution) {
          card.append(node("p", `Resolved: ${review.resolution.action} · ${review.resolution.cashAmount} · ${review.resolution.evidence}`));
        } else {
          const form = node("form");
          const selectLabel = node("label", "Resolution ");
          const select = node("select");
          for (const [value, label] of [["POST_SALE", "Post original sale after stock reconciliation"], ["CASH_REFUNDED", "Cash physically refunded"]]) {
            const option = node("option", label); option.value = value; select.append(option);
          }
          selectLabel.append(select);
          const evidenceLabel = node("label", "Stock count and adjustment reference, or cash refund proof and witness ");
          const evidence = node("textarea"); evidence.required = true; evidence.minLength = 20; evidence.maxLength = 2000; evidenceLabel.append(evidence);
          const submit = node("button", "Record irreversible resolution"); submit.type = "submit";
          form.append(selectLabel, evidenceLabel, submit);
          form.onsubmit = async (event) => {
            event.preventDefault();
            if (!confirm(`${select.value} for ${sale.receiptNumber}, exactly ${money(sale.subtotalCents)}? Verify cash and stock evidence first.`)) return;
            submit.disabled = true;
            try {
              const response = await fetch("/api/offline/reviews", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ transactionId: review.transactionId, payloadHash: review.payloadHash, cashAmountCents: sale.subtotalCents, action: select.value, evidence: evidence.value.trim() }) });
              const result = await response.json();
              if (!response.ok) throw new Error(result.code || "Resolution failed");
              await load(); message.textContent = `${sale.receiptNumber}: ${result.action} recorded.`;
            } catch (cause) { message.textContent = cause.message; message.className = "error"; submit.disabled = false; }
          };
          card.append(form);
        }
        list.append(card);
      }
      if (!message.classList.contains("error")) message.textContent = "";
    } catch (cause) { message.textContent = cause.message; message.className = "error"; }
  }
  document.getElementById("refresh").onclick = load;
  load();
})();
