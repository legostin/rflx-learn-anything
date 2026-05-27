import { reflex } from "@host/api";

/**
 * Ask the agent to write an interactive trainer (small standalone HTML
 * page with inline JS) that practices a specific skill from a module —
 * e.g. simulation of a binary tree, drag-shapes-on-canvas exercise,
 * flashcard drill. The HTML runs inside a nested sandboxed iframe in
 * the utility UI; it has NO host-RPC access — strictly client-only.
 *
 * Persisted as KB kind="course-trainer" so it survives between sessions
 * and the user can re-open.
 */

export interface TrainerSpec {
  trainerId: string;
  courseId: string;
  moduleId: string;
  title: string;
  /** Self-contained HTML — head/body/script all inline. Loaded via
   *  iframe srcdoc inside the utility. */
  html: string;
  relPath: string;
}

export interface GenerateTrainerArgs {
  courseId: string;
  moduleId: string;
  moduleTitle: string;
  moduleObjective: string;
  prompt?: string; // user idea
}

export default async function generateTrainer(
  args: GenerateTrainerArgs,
): Promise<TrainerSpec> {
  const userBrief =
    (args.prompt ?? "").trim() ||
    `Design a trainer that helps reinforce "${args.moduleObjective}".`;
  const prompt = [
    `Course/module: "${args.moduleTitle}".`,
    "Build an interactive trainer — a standalone HTML file with inline JS.",
    "Requirements:",
    "  • One full <!doctype html> file: <head>, <body>, <script>, optional <style>.",
    "  • NO external resources: no CDN scripts, no image URLs, no fetch calls. Everything inline.",
    "  • Use <canvas> where appropriate (drawing, physics, geometry).",
    "  • Size ≈ 600×400 px (responsive).",
    "  • Clear interface: what is shown, what to do, instant feedback (right/wrong, score).",
    "  • No navigator/window globals that break inside a sandbox iframe (no localStorage, no parent).",
    "  • THE CODE MUST WORK. No placeholder functions.",
    "Reply with HTML ONLY (no JSON wrapper, no markdown fence).",
    "",
    `## Trainer idea\n${userBrief}`,
  ].join("\n");

  // Trainer HTML is long — give the agent a generous 7 minutes; worker
  // timeout (8 min in manifest) is the outer guardrail.
  const r = await reflex.agent.invoke({ prompt, timeoutMs: 7 * 60_000 });
  const text = r.text ?? "";
  const html = extractHtml(text);
  if (!html) {
    throw new Error("Agent did not return valid HTML — please try again");
  }

  const trainerId = `${args.moduleId}-${Date.now().toString(36)}`;
  const saved = await reflex.kb.add({
    kind: "course-trainer",
    title: `Trainer · ${args.moduleTitle}`,
    body: "```html\n" + html.slice(0, 30_000) + "\n```",
    meta: {
      courseId: args.courseId,
      moduleId: args.moduleId,
      trainerId,
      title: args.moduleTitle,
      // Full HTML in meta is bulky but allows quick re-open without re-parsing.
      // Capped at ~60KB to keep frontmatter sane.
      html: html.slice(0, 60_000),
    },
    slug: `trainer-${trainerId}`,
  });

  return {
    trainerId,
    courseId: args.courseId,
    moduleId: args.moduleId,
    title: args.moduleTitle,
    html,
    relPath: saved.relPath,
  };
}

/** Pluck HTML from possibly-fenced agent output. */
function extractHtml(text: string): string {
  // Fence-bound: ```html ... ```
  const fenced = /```(?:html)?\s*([\s\S]+?)\s*```/.exec(text);
  if (fenced) {
    const inner = fenced[1]!.trim();
    if (looksLikeHtml(inner)) return inner;
  }
  if (looksLikeHtml(text)) return text.trim();
  return "";
}

function looksLikeHtml(s: string): boolean {
  const lower = s.toLowerCase();
  return lower.includes("<!doctype html") || lower.includes("<html");
}
