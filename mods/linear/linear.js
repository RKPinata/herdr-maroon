// Linear GraphQL client with a localStorage-backed read cache. No imports, so Node tests load this file directly.

const ENDPOINT = "https://api.linear.app/graphql";

const isAuthError = (e) => e?.extensions?.type === "authentication error" || e?.extensions?.code === "AUTHENTICATION_ERROR";

// Maps an HTTP status and parsed body (null when not JSON) to { data, error }.
function interpret(status, body) {
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  if (status === 401 || errors.some(isAuthError)) return { data: null, error: { kind: "auth", message: errors[0]?.message ?? "Authentication failed" } };
  if (status >= 500) return { data: null, error: { kind: "offline", message: `HTTP ${status}` } };
  if (errors.length) return { data: null, error: { kind: "graphql", message: errors[0].message } };
  if (status >= 400) return { data: null, error: { kind: "graphql", message: `HTTP ${status}` } };
  if (!body) return { data: null, error: { kind: "graphql", message: "Bad response from Linear" } };
  return { data: body.data ?? null, error: null };
}

export function createClient({ fetch, readKey, storage, now }) {
  let key = null;

  const cacheKey = (doc, vars) => `cache:${doc.match(/^\s*(?:query|mutation)\s+(\w+)/)?.[1] ?? ""}:${JSON.stringify(vars)}`;

  function cached(doc, vars = {}) {
    try {
      const raw = storage.getItem(cacheKey(doc, vars));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async function send(doc, vars) {
    if (!key) {
      try {
        key = (await readKey()) || null;
      } catch {}
    }
    if (!key) return { data: null, error: { kind: "nokey", message: "No Linear API key" } };
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: key, "Content-Type": "application/json" },
        body: JSON.stringify({ query: doc, variables: vars }),
      });
    } catch (e) {
      return { data: null, error: { kind: "offline", message: String(e?.message ?? e) } };
    }
    let body = null;
    try {
      body = await res.json();
    } catch {}
    const result = interpret(res.status, body);
    if (result.error?.kind === "auth") key = null;
    return result;
  }

  async function query(doc, vars = {}, { ttl = 0 } = {}) {
    const hit = cached(doc, vars);
    if (hit && now() - hit.at < ttl) return { data: hit.data, at: hit.at, error: null };
    const { data, error } = await send(doc, vars);
    if (error) return { data: hit?.data ?? null, at: hit?.at ?? null, error };
    const at = now();
    try {
      storage.setItem(cacheKey(doc, vars), JSON.stringify({ data, at }));
    } catch {}
    return { data, at, error: null };
  }

  return { query, mutate: (doc, vars = {}) => send(doc, vars), cached };
}
