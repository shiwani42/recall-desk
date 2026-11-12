// The model the AG Studio agents run on. Haiku 5.5 at medium effort: fast, cheap, and plenty for
// reading the schema, running queries and placing widgets. Shared by the proxy route (allowlist)
// and the browser (model picker).
export const ANALYST_MODELS = [{ id: "claude-haiku-5-5", label: "Claude Haiku 5.5" }] as const;
export const ANALYST_EFFORT = "medium" as const;
