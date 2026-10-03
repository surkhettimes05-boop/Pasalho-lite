"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  commitBulkProductImportAction,
  previewBulkProductImportAction,
} from "@/app/(app)/products/actions";
import type { BulkProductPreview } from "@/modules/products/bulk-import.schemas";

const TEMPLATE = [
  "SKU,Barcode,Product Name,Category,Unit,Cost Price,Selling Price,MRP,Warehouse Minimum,Store Minimum,Active",
  "COKE-250,8901764012345,Coca-Cola 250 ml,Beverages,pcs,90,120,120,24,10,true",
].join("\n");

function newBatchKey() {
  return globalThis.crypto?.randomUUID?.() ?? `bulk-${Date.now()}-${Math.random()}`;
}

export function BulkProductImport() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BulkProductPreview | null>(null);
  const [batchKey, setBatchKey] = useState(newBatchKey);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isPreviewing, startPreview] = useTransition();
  const [isImporting, startImport] = useTransition();

  const templateHref = useMemo(
    () => `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`,
    [],
  );

  function reset(nextFile: File | null = null) {
    setFile(nextFile);
    setPreview(null);
    setMessage("");
    setError("");
    setBatchKey(newBatchKey());
  }

  function previewFile() {
    if (!file) {
      setError("Choose a CSV or XLSX file first.");
      return;
    }
    setError("");
    setMessage("");

    startPreview(async () => {
      const formData = new FormData();
      formData.set("file", file);
      const result = await previewBulkProductImportAction(formData);

      if (!result.ok) {
        setPreview(null);
        setError(result.message);
        return;
      }

      setPreview(result.preview);
      if (result.preview.invalidRows > 0 || result.preview.globalErrors.length > 0) {
        setError("Fix every validation error before importing. The batch is all-or-nothing.");
      }
    });
  }

  function importFile() {
    if (!file || !preview || preview.invalidRows > 0 || preview.globalErrors.length > 0) {
      return;
    }
    setError("");
    setMessage("");

    startImport(async () => {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("idempotencyKey", batchKey);
      const result = await commitBulkProductImportAction(formData);

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setMessage(
        result.result.replayed
          ? `Import already completed: ${result.result.createdCount} SKU(s).`
          : `Bulk import complete: ${result.result.createdCount} SKU(s) created.`,
      );
      router.refresh();
    });
  }

  const canImport =
    Boolean(file && preview) &&
    preview?.invalidRows === 0 &&
    preview?.globalErrors.length === 0 &&
    preview?.totalRows > 0 &&
    !isPreviewing &&
    !isImporting;

  return (
    <section className="panel bulk-import-panel">
      <div className="panel-heading bulk-import-heading">
        <div>
          <p className="eyebrow">Catalog import</p>
          <h3>Bulk SKU import</h3>
          <p className="muted">
            Upload up to 5,000 product masters. Stock always starts at zero and
            must enter through Receive Stock.
          </p>
        </div>
        <a
          className="secondary-light-button"
          download="pasalho-product-import-template.csv"
          href={templateHref}
        >
          Download template
        </a>
      </div>

      <div className="bulk-import-controls">
        <label className="bulk-file-picker">
          Product file
          <input
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            type="file"
            onChange={(event) => reset(event.target.files?.[0] ?? null)}
          />
          <small>CSV or XLSX · maximum 10 MB · maximum 5,000 products</small>
        </label>
        <div className="form-actions">
          <button
            className="secondary-light-button"
            disabled={!file || isPreviewing || isImporting}
            type="button"
            onClick={previewFile}
          >
            {isPreviewing ? "Validating…" : "Preview & validate"}
          </button>
          <button
            className="primary-button"
            disabled={!canImport}
            type="button"
            onClick={importFile}
          >
            {isImporting
              ? "Importing…"
              : preview
                ? `Import ${preview.validRows} SKU(s)`
                : "Import"}
          </button>
          <button
            className="link-button"
            disabled={isPreviewing || isImporting}
            type="button"
            onClick={() => reset(null)}
          >
            Clear
          </button>
        </div>
      </div>

      {error ? <p className="error-message" role="alert">{error}</p> : null}
      {message ? <p className="success-message" role="status">{message}</p> : null}

      {preview ? (
        <>
          <div className="bulk-import-summary" aria-label="Bulk import summary">
            <div><span>Total rows</span><strong>{preview.totalRows}</strong></div>
            <div><span>Valid</span><strong>{preview.validRows}</strong></div>
            <div><span>Invalid</span><strong>{preview.invalidRows}</strong></div>
          </div>

          {preview.globalErrors.length > 0 ? (
            <div className="error-message" role="alert">
              {preview.globalErrors.map((item) => <div key={item}>{item}</div>)}
            </div>
          ) : null}

          <div className="table-wrap bulk-preview-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>SKU</th>
                  <th>Barcode</th>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Unit</th>
                  <th>Cost</th>
                  <th>Selling</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 200).map((row) => (
                  <tr key={row.rowNumber}>
                    <td>{row.rowNumber}</td>
                    <td><strong>{row.sku || "—"}</strong></td>
                    <td>{row.barcode || "—"}</td>
                    <td>{row.name || "—"}</td>
                    <td>{row.category || "—"}</td>
                    <td>{row.unit || "—"}</td>
                    <td>{row.costPrice || "—"}</td>
                    <td>{row.sellingPrice || "—"}</td>
                    <td>
                      {row.errors.length === 0 ? (
                        <span className="type-pill">VALID</span>
                      ) : (
                        <div className="bulk-row-errors">
                          <span className="type-pill type-pill-danger">INVALID</span>
                          {row.errors.map((item) => <small key={item}>{item}</small>)}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length > 200 ? (
            <p className="muted">
              Showing the first 200 rows. All {preview.totalRows} rows were validated.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
