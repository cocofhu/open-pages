export function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "error", "msg"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
    }
    try {
      const json = JSON.stringify(error);
      if (json && json !== "{}" && json !== "null") return json;
    } catch {
      // ignore
    }
  }
  return fallback;
}
