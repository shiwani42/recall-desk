// Models the AG Studio analyst may use, first one the default. Shared by the proxy route (allowlist)
// and the browser (model picker).
export const ANALYST_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
] as const;
