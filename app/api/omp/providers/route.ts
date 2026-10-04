import { loadOmpModels, runOmpUtilityCommand } from "@/lib/omp/omp-models";
import { isApiRequestAllowed } from "@/lib/request-security";
import { ompConfigFailure } from "@/lib/omp/config-api";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) return Response.json({ error: "Untrusted API request" }, { status: 403 });
  try {
    const [catalog, login] = await Promise.all([
      loadOmpModels(),
      runOmpUtilityCommand<{ providers?: { id: string; name: string; authenticated: boolean; available?: boolean }[] }>({ type: "get_login_providers" }),
    ]);
    return Response.json({ models: catalog.modelList, oauthProviders: (login.providers ?? []).filter((p) => p.available !== false).map((p) => ({ id: p.id, name: p.name, loggedIn: p.authenticated, usesCallbackServer: false })) });
  } catch (error) { return ompConfigFailure(error); }
}
