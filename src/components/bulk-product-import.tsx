"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { importBulkAction, previewBulkImportAction, type BulkImportState } from "@/app/(app)/products/actions";

const initial: BulkImportState = {};
const template = "SKU,Barcode,Product Name,Category,Unit,Cost Price,Selling Price,MRP,Warehouse Minimum,Store Minimum,Active\nCOKE-250,8901764012345,Coca-Cola 250 ml,Beverages,pcs,90,120,120,24,10,true\n";

export function BulkProductImport() {
  const [preview, previewAction] = useActionState(previewBulkImportAction, initial);
  const [result, importAction] = useActionState(importBulkAction, initial);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const valid = preview.rows?.filter((row) => row.status === "VALID") ?? [];
  const invalid = preview.rows?.filter((row) => row.status !== "VALID") ?? [];
  const duplicateSkus = invalid.filter((row) => row.error?.startsWith("BULK_DUPLICATE_SKU")).length;
  const duplicateBarcodes = invalid.filter((row) => row.error?.startsWith("BULK_DUPLICATE_BARCODE")).length;
  useEffect(() => { if (result.imported !== undefined && fileRef.current) fileRef.current.value = ""; }, [result.imported]);
  return <section className="panel">
    <div className="panel-heading"><div><p className="eyebrow">Catalog tools</p><h3>Bulk SKU Import</h3></div></div>
    <p className="muted">Upload up to 5,000 catalog rows. This creates products only; inventory remains at zero.</p>
    <p><a className="text-link" download="pasalho-products-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`}>Download CSV template</a></p>
    <form action={previewAction} className="form-actions">
      <input ref={fileRef} name="bulkFile" type="file" accept=".csv,.xlsx" required onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")} />
      <button className="secondary-light-button" type="submit">Preview file</button>
      {fileName ? <span className="muted">{fileName}</span> : null}
    </form>
    {preview.error ? <p className="error-message" role="alert">{preview.error}</p> : null}
    {result.error ? <p className="error-message" role="alert">{result.error}</p> : null}
    {result.imported !== undefined ? <p className="success-message" role="status">Bulk import complete. Imported: {result.imported} SKUs. Inventory was initialized at zero.</p> : null}
    {preview.rows ? <>
      <p className="muted">Total: {preview.rows.length} · Valid: {valid.length} · Invalid: {invalid.length} · Duplicate SKUs: {duplicateSkus} · Duplicate barcodes: {duplicateBarcodes}</p>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Row</th><th>SKU</th><th>Barcode</th><th>Product</th><th>Category</th><th>Unit</th><th>Cost</th><th>Selling</th><th>MRP</th><th>Warehouse Min</th><th>Store Min</th><th>Active</th><th>Status</th><th>Error</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.sku}</td><td>{row.barcode || "—"}</td><td>{row.name}</td><td>{row.category}</td><td>{row.unit}</td><td>{row.costPrice}</td><td>{row.sellingPrice}</td><td>{row.mrp || "—"}</td><td>{row.warehouseMinStock}</td><td>{row.storeMinStock}</td><td>{row.active}</td><td>{row.status}</td><td>{row.error || "—"}</td></tr>)}</tbody></table></div>
      <form action={importAction} className="form-actions"><input type="hidden" name="rows" value={JSON.stringify(valid)} /><input type="hidden" name="batchId" value={preview.batchId} /><input type="hidden" name="fileName" value={fileName} /><button className="primary-button" type="submit" disabled={invalid.length > 0 || valid.length === 0}>Import valid batch</button><button className="secondary-light-button" type="button" onClick={() => window.location.reload()}>Clear</button></form>
    </> : null}
  </section>;
}
