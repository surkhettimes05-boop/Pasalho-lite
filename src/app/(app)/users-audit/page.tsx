import { Role } from "@/generated/prisma/client";
import {
  createStaffUserAction,
  updateStaffUserAccessAction,
} from "@/app/(app)/users-audit/actions";
import { requirePageRole } from "@/lib/auth/require-role";
import { formatNepalDateTime } from "@/lib/time";
import { getUsersAndAudit } from "@/modules/users/user.service";

const errors: Record<string, string> = {
  USER_EMAIL_EXISTS: "That staff email already exists.",
  SELF_LOCKOUT_BLOCKED:
    "You cannot deactivate your own account or remove your own Owner/Admin role.",
  LAST_OWNER_REQUIRED: "At least one active Owner/Admin account must remain.",
  USER_NOT_FOUND: "Staff user not found.",
  INVALID_ROLE: "Invalid staff role.",
  INVALID_USER_INPUT: "Check the staff name, email, password and role.",
  UNAUTHORIZED_ACTION: "Only Owner/Admin can manage staff and audit history.",
  USER_OPERATION_FAILED: "The staff operation could not be completed.",
};

export const dynamic = "force-dynamic";

export default async function UsersAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const actor = await requirePageRole([Role.OWNER_ADMIN]);
  const params = await searchParams;
  const data = await getUsersAndAudit(1, 100);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Phase 10</p>
          <h2>Users & audit</h2>
          <p className="muted">
            Owner-only access control and recent high-risk operational history.
          </p>
        </div>
        <span className="status-badge">{data.users.length} staff account(s)</span>
      </header>

      {params.error ? (
        <p className="error-message" role="alert">
          {errors[params.error] ?? "User operation failed."}
        </p>
      ) : null}
      {params.success ? (
        <p className="success-message" role="status">
          Staff access updated.
        </p>
      ) : null}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Owner control</p>
            <h3>Create staff account</h3>
          </div>
        </div>
        <form action={createStaffUserAction} className="form-grid">
          <label>
            Name
            <input name="name" required minLength={2} maxLength={100} />
          </label>
          <label>
            Email
            <input name="email" required type="email" autoComplete="off" />
          </label>
          <label>
            Temporary password
            <input
              name="password"
              required
              type="password"
              minLength={12}
              maxLength={256}
              autoComplete="new-password"
            />
          </label>
          <label>
            Role
            <select name="role" defaultValue={Role.CASHIER_STORE}>
              <option value={Role.CASHIER_STORE}>Cashier / Store</option>
              <option value={Role.WAREHOUSE_STAFF}>Warehouse Staff</option>
              <option value={Role.OWNER_ADMIN}>Owner / Admin</option>
            </select>
          </label>
          <div className="form-actions span-2">
            <button className="primary-button" type="submit">
              Create staff account
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Access</p>
            <h3>Staff accounts</h3>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Staff</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created</th>
                <th>Access change</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong>{user.name}</strong>
                    <small>{user.email}</small>
                    {user.id === actor.id ? <small>Current account</small> : null}
                  </td>
                  <td>{user.role.replaceAll("_", " ")}</td>
                  <td>{user.active ? "ACTIVE" : "INACTIVE"}</td>
                  <td>{formatNepalDateTime(user.createdAt)}</td>
                  <td>
                    <form action={updateStaffUserAccessAction} className="inline-admin-form">
                      <input type="hidden" name="userId" value={user.id} />
                      <select name="role" defaultValue={user.role}>
                        <option value={Role.CASHIER_STORE}>Cashier</option>
                        <option value={Role.WAREHOUSE_STAFF}>Warehouse</option>
                        <option value={Role.OWNER_ADMIN}>Owner/Admin</option>
                      </select>
                      <select
                        name="active"
                        defaultValue={user.active ? "true" : "false"}
                      >
                        <option value="true">Active</option>
                        <option value="false">Inactive</option>
                      </select>
                      <button className="secondary-light-button" type="submit">
                        Update
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Evidence</p>
            <h3>Recent audit log</h3>
            <p className="muted">
              Latest {data.audits.length} of {data.auditTotal} audit entries.
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Actor</th>
              </tr>
            </thead>
            <tbody>
              {data.audits.map((audit) => (
                <tr key={audit.id}>
                  <td>{formatNepalDateTime(audit.createdAt)}</td>
                  <td>{audit.action.replaceAll("_", " ")}</td>
                  <td>
                    {audit.entityType}
                    <small>{audit.entityId}</small>
                  </td>
                  <td>{audit.actor?.name ?? "System / unavailable actor"}</td>
                </tr>
              ))}
              {data.audits.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty-cell">
                    No audit records yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
