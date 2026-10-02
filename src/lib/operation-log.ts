type OperationLog = {
  requestId?: string | null;
  operation: string;
  actorId?: string | null;
  entityId?: string | null;
  status: "success" | "failure";
  errorCategory?: string | null;
};

export function writeOperationLog(entry: OperationLog) {
  const payload = {
    timestamp: new Date().toISOString(),
    level: entry.status === "failure" ? "error" : "info",
    event: "business_operation",
    requestId: entry.requestId ?? null,
    operation: entry.operation,
    actorId: entry.actorId ?? null,
    entityId: entry.entityId ?? null,
    status: entry.status,
    errorCategory: entry.errorCategory ?? null,
  };

  const line = JSON.stringify(payload);

  if (entry.status === "failure") {
    console.error(line);
  } else {
    console.info(line);
  }
}
