import { requireCurrentUser } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export default async function ShellDebugPage() {
  const user = await requireCurrentUser();

  return (
    <div className="page-stack">
      <h2>Authenticated shell OK</h2>
      <p>{user.email}</p>
    </div>
  );
}
