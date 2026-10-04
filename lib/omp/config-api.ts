import { hasJsonContentType, isApiRequestAllowed } from "../request-security";
import { OmpConfigError, isRecord } from "./config-store";

export function ompConfigFailure(error: unknown): Response {
  return Response.json({ error: error instanceof OmpConfigError ? error.message : "Could not read or save OMP configuration. Check file access and try again." }, { status: error instanceof OmpConfigError ? error.status : 500 });
}

export async function ompConfigRequest(req: Request) {
  if (!isApiRequestAllowed(req)) throw new OmpConfigError("Untrusted API request", 403);
  if (!hasJsonContentType(req)) throw new OmpConfigError("Content-Type must be application/json", 415);
  const text = await req.text();
  if (text.length > 1024 * 1024) throw new OmpConfigError("Configuration request is too large", 413);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new OmpConfigError("Invalid JSON body"); }
  if (!isRecord(value) || typeof value.revision !== "string") throw new OmpConfigError("Expected a configuration revision");
  return value;
}
