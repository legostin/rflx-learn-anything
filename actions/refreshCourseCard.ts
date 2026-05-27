import { reflex } from "@host/api";

/**
 * Update the dashboard card: number of active courses + average
 * progress %. Called after key events (course created, module
 * completed, quiz passed). Idempotent.
 */
export default async function refreshCourseCard(): Promise<{ courses: number; avg: number }> {
  const list = (await reflex.kb.list({ kind: "course" })) ?? [];
  let total = 0;
  let avgSum = 0;
  for (const c of list) {
    try {
      const { content } = await reflex.kb.read({ relPath: c.relPath });
      const m = /^---\n([\s\S]*?)\n---/.exec(content);
      if (!m) continue;
      const meta = parseFrontmatter(m[1]!);
      const modules = jsonOf(meta.modules);
      const progress = jsonOf(meta.progress);
      if (!Array.isArray(modules) || modules.length === 0) continue;
      total++;
      const done = Object.values(
        progress as Record<string, { completed?: boolean }>,
      ).filter((p) => p && (p as { completed?: boolean }).completed).length;
      avgSum += done / modules.length;
    } catch {
      /* skip */
    }
  }
  const courses = total;
  const avg = total > 0 ? Math.round((avgSum / total) * 100) : 0;
  await reflex.cards.update({
    snapshot: {
      kind: "kpi",
      title: "🎓 Learning",
      data: {
        items: [
          { label: "Active courses", value: String(courses) },
          {
            label: "Progress",
            value: courses === 0 ? "—" : `${avg}%`,
            hint: "average across courses",
            ...(avg >= 60
              ? ({ delta: "up" } as const)
              : avg < 30 && courses > 0
                ? ({ delta: "down" } as const)
                : ({ delta: "flat" } as const)),
          },
        ],
      },
    },
  });
  return { courses, avg };
}

function jsonOf(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function parseFrontmatter(s: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of s.split("\n")) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return out;
}
