export function realCustomerOrdersEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (
    (env.APP_ENV !== "production" && env.NODE_ENV !== "production") ||
    env.ENABLE_REAL_CUSTOMER_ORDERS === "true"
  );
}
