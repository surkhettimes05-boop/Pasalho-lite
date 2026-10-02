"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Pasalho page error", {
      digest: error.digest ?? null,
    });
  }, [error]);

  return (
    <div className="panel">
      <p className="eyebrow">Operation interrupted</p>
      <h2>Pasalho could not complete this screen.</h2>
      <p className="muted">
        No raw database or server error is shown. Retry once; if it repeats,
        record the time and action for investigation.
      </p>
      <button className="primary-button" type="button" onClick={reset}>
        Retry
      </button>
    </div>
  );
}
