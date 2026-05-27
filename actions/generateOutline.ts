import { reflex } from "@host/api";
import type { TutorQA } from "./tutorAsk";
import { callJsonAgent, snippet } from "./_json";
import { writeCourse } from "./_store";

/**
 * Build a course outline based on topic + wizard answers. Returns a
 * list of 5-9 modules each with a short title, a 1-sentence objective,
 * and an estimated duration. The course record is persisted as a KB
 * entry of kind="course"; subsequent buildModule calls hang content
 * off it module-by-module.
 */

export interface OutlineModule {
  id: string;
  title: string;
  objective: string;
  estMinutes: number;
}

export interface GenerateOutlineArgs {
  topic: string;
  history: TutorQA[];
}

export interface CourseRecord {
  courseId: string;
  topic: string;
  modules: OutlineModule[];
  relPath: string;
  createdAt: string;
}

export default async function generateOutline(
  args: GenerateOutlineArgs,
): Promise<CourseRecord> {
  const prior = args.history
    .map((qa) => `Q: ${qa.question}\nA: ${qa.answer}`)
    .join("\n\n");
  const prompt = [
    "Design a learning course on the topic \"${TOPIC}\" tailored to a user with the following answers:".replace(
      "${TOPIC}",
      args.topic,
    ),
    "",
    prior || "(no answers)",
    "",
    "Requirements:",
    "  • 5-9 modules, from basic to advanced.",
    "  • Each module is self-contained (can be opened and completed in one sitting).",
    "  • objective — one precise phrase \"by the end of this module you will be able to …\".",
    "  • estMinutes — a realistic estimate of pure study time (15-60).",
    "  • module id — kebab-case, latin letters + digits.",
    "Reply with JSON ONLY on a single line, no markdown:",
    `  {"modules":[{"id":"intro","title":"…","objective":"…","estMinutes":30}, ...]}`,
  ].join("\n");

  const result = await callJsonAgent<OutlineModule[]>({
    prompt,
    invoke: (p) => reflex.agent.invoke({ prompt: p, timeoutMs: 4 * 60_000 }),
    maxAttempts: 4,
    shapeHint:
      `{"modules":[{"id":"intro","title":"Introduction","objective":"by the end of this module you will be able to …","estMinutes":30}, ...]}\n` +
      `At least 5 modules. id — kebab-case, no spaces, latin letters only.`,
    validate: (parsed) => {
      const v = parsed as { modules?: unknown };
      const modules = sanitizeModules(v?.modules);
      return modules.length > 0 ? modules : null;
    },
  });

  if (!result.ok) {
    throw new Error(
      `Failed to build the course outline in ${result.attempts} attempts (${result.reason}). ` +
        `Last agent reply: "${snippet(result.lastText, 200)}". Try rephrasing the topic.`,
    );
  }
  const modules = result.value;

  const courseId = slugify(args.topic) || `course-${Date.now()}`;
  const today = new Date().toISOString().slice(0, 10);
  const body = [
    `# ${args.topic}`,
    "",
    "## Program",
    "",
    ...modules.map(
      (mod, i) =>
        `${i + 1}. **${mod.title}** — ${mod.objective} (~${mod.estMinutes} min)`,
    ),
  ].join("\n");

  const nowIso = new Date().toISOString();
  // Source of truth: sandboxed JSON. Lookup via fs.list — no YAML
  // round-tripping headaches.
  await writeCourse({
    courseId,
    topic: args.topic,
    modules,
    progress: {},
    wizardAnswers: args.history,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  // KB entry is for human visibility (showing up in the KB tree with a
  // "createdBy: utility" badge). Short meta only — no JSON-stringified
  // blobs, so multi-line YAML never happens.
  const saved = await reflex.kb.add({
    kind: "course",
    title: args.topic,
    body,
    meta: {
      courseId,
      topic: args.topic,
      modulesCount: modules.length,
      createdAt: today,
    },
    slug: courseId,
    date: today,
  });

  await reflex.audit.log({
    type: "course-outlined",
    payload: { topic: args.topic, modulesCount: modules.length },
  });

  return {
    courseId,
    topic: args.topic,
    modules,
    relPath: saved.relPath,
    createdAt: today,
  };
}

function sanitizeModules(raw: unknown): OutlineModule[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: OutlineModule[] = [];
  for (const m of raw) {
    if (typeof m !== "object" || m === null) continue;
    const o = m as Partial<OutlineModule>;
    const id =
      typeof o.id === "string" && /^[a-z0-9][a-z0-9-]*$/.test(o.id)
        ? o.id
        : slugify(typeof o.title === "string" ? o.title : "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title: typeof o.title === "string" ? o.title : id,
      objective: typeof o.objective === "string" ? o.objective : "",
      estMinutes:
        typeof o.estMinutes === "number" && Number.isFinite(o.estMinutes)
          ? Math.max(5, Math.min(180, Math.round(o.estMinutes)))
          : 30,
    });
  }
  return out;
}

function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
