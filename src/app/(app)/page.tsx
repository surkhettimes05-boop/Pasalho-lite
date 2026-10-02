import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const locations = await prisma.location.findMany({
    where: { active: true },
    orderBy: { type: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
    },
  });

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Phase 0</p>
          <h2>Foundation dashboard</h2>
          <p className="muted">
            Authentication, roles, PostgreSQL, Prisma and the operating
            locations are connected. Business modules arrive in later phases.
          </p>
        </div>
        <span className="status-badge">Foundation</span>
      </header>

      <section className="summary-grid">
        <article className="summary-card">
          <span>Active locations</span>
          <strong>{locations.length}</strong>
          <small>V1 target: one warehouse + one store</small>
        </article>
        <article className="summary-card">
          <span>Architecture</span>
          <strong>1 + 1</strong>
          <small>One app + one PostgreSQL database</small>
        </article>
        <article className="summary-card">
          <span>Next build phase</span>
          <strong>Phase 1</strong>
          <small>Products + inventory ledger</small>
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Seeded operating locations</p>
            <h3>V1 footprint</h3>
          </div>
        </div>

        <div className="location-list">
          {locations.map((location) => (
            <div className="location-row" key={location.id}>
              <div>
                <strong>{location.name}</strong>
                <span>{location.code}</span>
              </div>
              <span className="type-pill">{location.type}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
