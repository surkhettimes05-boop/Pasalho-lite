"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main className="login-page">
          <section className="login-card">
            <p className="eyebrow">Pasalho Lite</p>
            <h1>Application error</h1>
            <p className="muted">
              The application hit an unexpected error. Sensitive server details
              are not displayed.
            </p>
            <button className="primary-button" type="button" onClick={reset}>
              Retry
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
