/**
 * Resilient JSON extraction from LLM/agent output.
 *
 * Strategies tried in order:
 *   1. Strip ```json/``` fences then JSON.parse the whole content.
 *   2. Find the outermost balanced `{...}` block via bracket-counter.
 *   3. Last-resort greedy `/\{[\s\S]*\}/`.
 *
 * Returns `null` if every strategy fails — callers usually retry the
 * LLM call once with a stricter "JSON only, no markdown" prompt.
 */
export function extractJson<T = unknown>(raw: string): T | null {
  if (!raw || typeof raw !== "string") return null;
  const candidates: string[] = [];

  // Strategy 1: strip outer fences.
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(raw);
  if (fence) candidates.push(fence[1]!.trim());

  // Strategy 2: balanced-brace scan from first `{`.
  const start = raw.indexOf("{");
  if (start >= 0) {
    let depth = 0;
    let inStr = false;
    let escape = false;
    for (let i = start; i < raw.length; i++) {
      const ch = raw[i]!;
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          candidates.push(raw.slice(start, i + 1));
          break;
        }
      }
    }
  }

  // Strategy 3: greedy fallback.
  const greedy = /\{[\s\S]*\}/.exec(raw);
  if (greedy) candidates.push(greedy[0]);

  for (const c of candidates) {
    try {
      return JSON.parse(c) as T;
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Short snippet of an agent response, for inclusion in error toasts so
 * the user can see what went wrong without us shipping the full reply.
 */
export function snippet(s: string, max = 240): string {
  if (!s) return "(empty)";
  const trimmed = s.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max) + "…";
}

/**
 * Self-correcting agent loop for JSON-shaped responses.
 *
 *   • Up to `maxAttempts` LLM calls (default 4).
 *   • On parse/validation failure we don't just say "try again" — we
 *     hand the LLM its own bad answer + a strict format reminder, and
 *     ask it to FIRST diagnose what was wrong (one phrase) THEN return
 *     the corrected JSON. The diagnosis is throwaway; only the JSON is
 *     parsed. Single round-trip per attempt.
 *   • `validate` is the gatekeeper — return non-null when the parsed
 *     payload satisfies the caller's structural needs.
 *
 * Returns either the validated value with attempt count, or a
 * structured failure with the last raw text for diagnostics.
 */
export interface JsonAgentArgs<T> {
  /** Initial prompt — should already include the JSON-only instruction. */
  prompt: string;
  /** LLM caller (e.g. (p) => reflex.agent.invoke({prompt: p})). */
  invoke: (prompt: string) => Promise<{ text?: string }>;
  /** Returns the validated value, or null if shape is wrong / empty. */
  validate: (parsed: unknown) => T | null;
  /** Default 4. The LLM call is the slow part — we cap to avoid runaways. */
  maxAttempts?: number;
  /** Optional one-line description of the expected shape; surfaces in
   *  the reflection prompt verbatim. */
  shapeHint?: string;
}

export interface JsonAgentSuccess<T> {
  ok: true;
  value: T;
  attempts: number;
}

export interface JsonAgentFailure {
  ok: false;
  attempts: number;
  lastText: string;
  /** Why we gave up — "no-json" / "invalid-shape" / "empty-result". */
  reason: "no-json" | "invalid-shape" | "empty-result";
}

export async function callJsonAgent<T>(
  args: JsonAgentArgs<T>,
): Promise<JsonAgentSuccess<T> | JsonAgentFailure> {
  const max = Math.max(1, args.maxAttempts ?? 4);
  let lastText = "";
  let lastReason: JsonAgentFailure["reason"] = "no-json";

  for (let attempt = 1; attempt <= max; attempt++) {
    const prompt =
      attempt === 1
        ? args.prompt
        : buildReflectionPrompt(args.prompt, lastText, lastReason, args.shapeHint, attempt);

    const r = await args.invoke(prompt);
    lastText = r.text ?? "";
    const json = extractJson<unknown>(lastText);
    if (!json) {
      lastReason = "no-json";
      continue;
    }
    const validated = args.validate(json);
    if (validated == null) {
      // Distinguish empty vs malformed for the reflection prompt.
      lastReason = isEmptyShape(json) ? "empty-result" : "invalid-shape";
      continue;
    }
    return { ok: true, value: validated, attempts: attempt };
  }
  return { ok: false, attempts: max, lastText, reason: lastReason };
}

function isEmptyShape(v: unknown): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

function buildReflectionPrompt(
  original: string,
  lastText: string,
  reason: JsonAgentFailure["reason"],
  shape: string | undefined,
  attempt: number,
): string {
  const reasonLine =
    reason === "no-json"
      ? "Your previous reply could not be parsed as JSON (likely cause: markdown fences, extra text before/after, unclosed brackets, single quotes)."
      : reason === "empty-result"
        ? "Your previous reply was valid JSON but empty (required fields missing or arrays empty)."
        : "Your previous reply was valid JSON but did not match the expected schema (some fields missing or wrong types).";
  const lines = [
    original,
    "",
    "## CRITICAL — this is attempt number " + attempt,
    reasonLine,
    "",
    "Here is what you returned last time (excerpt):",
    "```",
    snippet(lastText, 600),
    "```",
    "",
    "Now:",
    "  1. On a SINGLE comment line `// reason: ...` describe what was wrong (for self-check).",
    "  2. Immediately after the comment — the correct JSON.",
    shape
      ? `\nExpected shape:\n${shape}`
      : "",
    "\nNOTE: the reply must begin with either `//` (comment) or `{`. No ```fence```, no prose before the JSON.",
  ];
  return lines.filter(Boolean).join("\n");
}
