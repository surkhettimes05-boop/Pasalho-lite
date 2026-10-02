"use client";

export function PrintReceiptButton() {
  return (
    <button
      className="secondary-light-button no-print"
      type="button"
      onClick={() => window.print()}
    >
      Print receipt
    </button>
  );
}
