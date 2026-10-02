import { redirect } from "next/navigation";
import { loginAction } from "@/app/login/actions";
import { getCurrentUser } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();

  if (user) {
    redirect("/");
  }

  const params = await searchParams;
  const invalid = params.error === "invalid";

  return (
    <main className="login-page">
      <section className="login-card">
        <div>
          <p className="eyebrow">Pasalho Lite</p>
          <h1>Sign in</h1>
          <p className="muted">
            Use your assigned staff account. Access is controlled by role.
          </p>
        </div>

        {invalid ? (
          <p className="error-message" role="alert">
            Email or password is incorrect.
          </p>
        ) : null}

        <form action={loginAction} className="login-form">
          <label>
            Email
            <input
              autoComplete="username"
              name="email"
              placeholder="owner@example.com"
              required
              type="email"
            />
          </label>

          <label>
            Password
            <input
              autoComplete="current-password"
              name="password"
              required
              type="password"
            />
          </label>

          <button className="primary-button" type="submit">
            Sign in
          </button>
        </form>
      </section>
    </main>
  );
}
