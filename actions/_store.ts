import { reflex } from "@host/api";

/**
 * Shared course state store. Lives in the utility's `data/` sandbox
 * (one JSON file per course at `courses/<courseId>.json`) — bypasses
 * the frontmatter round-tripping problem (long JSON strings → multi-line
 * YAML → our naive client-side parser drops them). The companion KB
 * entry of `kind:"course"` stays for human visibility / provenance
 * badges, but it's NOT the source of truth.
 *
 * The body markdown rendered into the KB entry is regenerated from the
 * full state on every write — so editing in a KB viewer would be
 * overwritten next save (matches "agent-managed" data model).
 */

export interface CourseState {
  courseId: string;
  topic: string;
  modules: Array<{
    id: string;
    title: string;
    objective: string;
    estMinutes: number;
  }>;
  progress: Record<string, { completed?: boolean; quizScore?: number }>;
  wizardAnswers: Array<{ question: string; answer: string }>;
  createdAt: string;
  /** Bumped on every write to drive list-view re-renders. */
  updatedAt: string;
}

const DIR = "courses";

export async function writeCourse(state: CourseState): Promise<void> {
  const path = `${DIR}/${state.courseId}.json`;
  await reflex.fs.write({
    path,
    content: JSON.stringify(state, null, 2),
  });
}

export async function readCourse(courseId: string): Promise<CourseState | null> {
  try {
    const { content } = await reflex.fs.read({
      path: `${DIR}/${courseId}.json`,
    });
    return JSON.parse(content) as CourseState;
  } catch {
    return null;
  }
}

export async function listCourses(): Promise<CourseState[]> {
  const out: CourseState[] = [];
  try {
    const { entries } = await reflex.fs.list({ path: DIR });
    for (const e of entries) {
      if (e.isDir) continue;
      if (!e.name.endsWith(".json")) continue;
      const id = e.name.slice(0, -5);
      const c = await readCourse(id);
      if (c) out.push(c);
    }
  } catch {
    /* dir not created yet → empty list */
  }
  // Migration fallback: pre-0.2 versions stored course state in KB
  // frontmatter (which broke on long multi-line YAML). Pick up anything
  // KB has that fs doesn't, hydrate from there, and persist to fs so
  // the next open is fast and complete.
  try {
    const seen = new Set(out.map((c) => c.courseId));
    const kb = (await reflex.kb.list({ kind: "course" })) ?? [];
    for (const k of kb) {
      try {
        const { content } = await reflex.kb.read({ relPath: k.relPath });
        const fm = parseFrontmatter(content);
        const courseId = stringField(fm, "courseId") || baseSlug(k.relPath);
        if (!courseId || seen.has(courseId)) continue;
        const topic =
          stringField(fm, "topic") || k.title || courseId;
        const modulesFm = fm?.modules;
        // Best-effort: parse JSON-string frontmatter OR rebuild a stub
        // outline from the body's "1. **Title** — objective" lines.
        const modules =
          parseModulesField(modulesFm) ?? parseModulesFromBody(content);
        if (modules.length === 0) continue;
        const progress =
          parseProgressField(fm?.progress) ?? {};
        const wizardAnswers =
          parseWizardField(fm?.wizardAnswers) ?? [];
        const createdAt =
          stringField(fm, "createdAt") || k.modifiedAt || new Date().toISOString();
        const migrated: CourseState = {
          courseId,
          topic,
          modules,
          progress,
          wizardAnswers,
          createdAt,
          updatedAt: new Date().toISOString(),
        };
        out.push(migrated);
        seen.add(courseId);
        // Persist so we don't pay the KB scan next time.
        await writeCourse(migrated);
      } catch {
        /* skip malformed entry */
      }
    }
  } catch {
    /* kb.list unavailable — fine, just no migration */
  }
  return out;
}

// ---------------------------------------------------------------------------
// KB migration helpers — only used by the fallback above.

function parseFrontmatter(raw: string): Record<string, unknown> | null {
  const m = /^---\n([\s\S]*?)\n---/.exec(raw);
  if (!m) return null;
  const out: Record<string, unknown> = {};
  // Crude but tolerant: collect multi-line values when indented or
  // explicitly quoted with single quotes. Sufficient for old courses
  // that wrapped a long JSON string under a single key.
  const lines = m[1]!.split("\n");
  let curKey: string | null = null;
  let curBuf = "";
  const flush = () => {
    if (curKey == null) return;
    let v = curBuf.trim();
    // Strip outer quotes if present.
    v = v.replace(/^['"]|['"]$/g, "");
    out[curKey] = v;
    curKey = null;
    curBuf = "";
  };
  for (const line of lines) {
    if (/^\S/.test(line) && line.includes(":")) {
      flush();
      const i = line.indexOf(":");
      curKey = line.slice(0, i).trim();
      curBuf = line.slice(i + 1);
    } else if (curKey != null) {
      curBuf += "\n" + line;
    }
  }
  flush();
  return out;
}

function stringField(fm: Record<string, unknown> | null, key: string): string {
  return fm && typeof fm[key] === "string" ? (fm[key] as string) : "";
}

function parseModulesField(v: unknown): CourseState["modules"] | null {
  if (typeof v !== "string") return null;
  try {
    const parsed = JSON.parse(v);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter(
        (x): x is { id: string; title: string; objective?: string } =>
          x &&
          typeof x === "object" &&
          typeof (x as { id?: unknown }).id === "string",
      )
      .map((x) => ({
        id: x.id,
        title:
          typeof (x as { title?: unknown }).title === "string"
            ? (x as { title: string }).title
            : x.id,
        objective:
          typeof (x as { objective?: unknown }).objective === "string"
            ? (x as { objective: string }).objective
            : "",
        estMinutes:
          typeof (x as { estMinutes?: unknown }).estMinutes === "number"
            ? (x as { estMinutes: number }).estMinutes
            : 30,
      }));
  } catch {
    return null;
  }
}

function parseProgressField(v: unknown): CourseState["progress"] | null {
  if (typeof v !== "string") return null;
  try {
    const p = JSON.parse(v);
    return p && typeof p === "object" ? (p as CourseState["progress"]) : null;
  } catch {
    return null;
  }
}

function parseWizardField(v: unknown): CourseState["wizardAnswers"] | null {
  if (typeof v !== "string") return null;
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? (p as CourseState["wizardAnswers"]) : null;
  } catch {
    return null;
  }
}

function parseModulesFromBody(raw: string): CourseState["modules"] {
  // Body shape from old generateOutline: "1. **Title** — objective (~N min)"
  const out: CourseState["modules"] = [];
  const re = /^\s*(\d+)\.\s+\*\*(.+?)\*\*\s*[—-]\s*(.*?)(?:\s*\(~?(\d+)\s*min\))?$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    out.push({
      id: slug(m[2]!) || `m${m[1]}`,
      title: m[2]!,
      objective: m[3] ?? "",
      estMinutes: m[4] ? Number(m[4]) : 30,
    });
  }
  return out;
}

function slug(s: string): string {
  return s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function baseSlug(rel: string): string {
  return (rel.split("/").pop() ?? rel)
    .replace(/\.md$/, "")
    .replace(/^\d{4}-\d{2}-\d{2}-/, "");
}

export async function deleteCourse(courseId: string): Promise<void> {
  // fs.delete isn't exposed yet; overwrite with empty marker for now.
  // Listing skips entries that fail to parse so this effectively hides
  // the course until a proper delete RPC ships.
  await reflex.fs.write({
    path: `${DIR}/${courseId}.json`,
    content: "// deleted",
  });
}
