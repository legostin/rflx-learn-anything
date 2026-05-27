import { reflex } from "@host/api";
import { callJsonAgent, snippet } from "./_json";

/**
 * Compile a learning module: agent writes a full markdown article, then
 * Reflex resolves the image needs (real photos via search → local
 * download, schematics via generation) and embeds permanent local URLs
 * into the body. Persisted as a `course-module` KB entry, idempotent on
 * (courseId, moduleId).
 *
 * Why image queries/prompts instead of raw URLs:
 *   The old contract asked the LLM to suggest image URLs from its
 *   training corpus. ~90% of those URLs were dead or hallucinated.
 *   Now the LLM emits *intent* (what to find / what to draw) and
 *   reflex.images.search + reflex.images.generate do the real work,
 *   yielding stable `/api/images/<rootId>/<sha>.<ext>` URLs that move
 *   with the project.
 */

export interface ModuleContent {
  courseId: string;
  moduleId: string;
  title: string;
  /** Long-form markdown body for the article view. */
  article: string;
  videos: Array<{ title: string; url: string; note?: string }>;
  links: Array<{ title: string; url: string; snippet?: string }>;
  /** Resolved images: each has a permanent `/api/images/...` URL. */
  images: Array<{
    /** Stable id from the LLM draft; used to substitute inline `[[IMG:<id>]]` placeholders. */
    id: string;
    alt: string;
    url: string;
    source: "search" | "generated";
    attribution?: { name: string; link: string };
  }>;
  /** Mermaid diagrams (kept for structural schemas like flowcharts). */
  diagrams: Array<{ title: string; mermaid: string }>;
  homework: string[];
  relPath: string;
}

export interface BuildModuleArgs {
  courseId: string;
  moduleId: string;
  moduleTitle: string;
  moduleObjective: string;
  topic: string;
}

interface LlmDraft {
  article?: string;
  videos?: Array<{ title: string; url: string; note?: string }>;
  links?: Array<{ title: string; url: string; snippet?: string }>;
  /**
   * "Find a real photo of X". Each carries an `id` so the LLM can drop
   * an inline `[[IMG:<id>]]` placeholder into `article` and we know
   * where to embed the resolved image.
   */
  imageQueries?: Array<{ id: string; alt: string; query: string }>;
  /** Same id-based contract as `imageQueries`, but the resolver calls
   *  reflex.images.generate instead of search. */
  generatedFigures?: Array<{ id: string; alt: string; prompt: string }>;
  /** Mermaid code for diagrams that genuinely need flow/sequence syntax. */
  diagrams?: Array<{ title: string; mermaid: string }>;
  homework?: string[];
}

export default async function buildModule(
  args: BuildModuleArgs,
): Promise<ModuleContent> {
  // 1. Pull a few web sources to ground the article — saves the agent from
  // hallucinating sources. Best-effort; failures are silent.
  let webContext = "";
  try {
    const search = await reflex.web.search({
      query: `${args.topic} ${args.moduleTitle}`,
    });
    const top = (search.results ?? []).slice(0, 4);
    webContext = top
      .map(
        (r, i) =>
          `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.snippet ?? ""}`,
      )
      .join("\n");
  } catch {
    /* offline / no search — agent will rely on training data */
  }

  // 2. Ask the agent to draft the module. Note: NO bare image URLs —
  // the LLM tells us WHAT to look for / draw; Reflex resolves it via
  // reflex.images.search (Brave when available) + reflex.images.generate.
  const prompt = [
    `Course: "${args.topic}". Module: "${args.moduleTitle}" — ${args.moduleObjective}.`,
    "Produce the learning material. JSON reply shape:",
    "{",
    `  "article": "long markdown 800-2000 words; use # ## ### and [[IMG:<id>]] placeholders for inline images",`,
    `  "videos": [{"title":"...","url":"https://youtube.com/...","note":"..."}],`,
    `  "links": [{"title":"...","url":"...","snippet":"..."}],`,
    `  "imageQueries": [{"id":"i1","alt":"...","query":"short English search query"}],`,
    `  "generatedFigures": [{"id":"f1","alt":"...","prompt":"detailed English description for the AI generator"}],`,
    `  "diagrams": [{"title":"...","mermaid":"graph TD; A-->B;"}],`,
    `  "homework": ["...","..."]`,
    "}",
    "",
    "## VISUAL CONTENT — MANDATORY + INLINE PLACEMENT",
    "",
    "Every learning module MUST be visually rich. Each image is placed **inline** at the right spot in the text via a placeholder.",
    "",
    "### How it works",
    "  1. Each entry in `imageQueries` and `generatedFigures` gets a SHORT ID (`i1`, `i2`, `f1`, `f2`, ...). i = image-search (real photo), f = figure (AI-generated). Unique within the module.",
    "  2. In the `article` markdown insert the placeholder `[[IMG:i1]]` on its OWN LINE exactly where the image should appear (e.g. after the paragraph that discusses it).",
    "  3. Reflex automatically:",
    "     – searches for real photos/diagrams via Brave Image Search (using `imageQueries`),",
    "     – VISUALLY EVALUATES candidates (your chat agent inspects thumbnails via the Read tool) — clipart / off-topic items are rejected based on content,",
    "     – generates unique illustrations via Gemini Nano Banana (using `generatedFigures`),",
    "     – replaces `[[IMG:<id>]]` with `![alt](local-url)` plus attribution,",
    "     – unresolved ids (image not found / rejected) are cleanly stripped from the text.",
    "",
    "### Example",
    "```markdown",
    "## Visual cortex",
    "The primary visual cortex V1 is the first area that processes information from the retina.",
    "",
    "[[IMG:i1]]",
    "",
    "The columnar organisation of V1 was described by Hubel and Wiesel in 1962...",
    "",
    "[[IMG:f1]]",
    "```",
    "...where `imageQueries: [{id:\"i1\", alt:\"Section of the primary visual cortex V1\", query:\"primary visual cortex V1 histology\"}]` and `generatedFigures: [{id:\"f1\", alt:\"Receptive field diagram\", prompt:\"educational diagram: receptive field of simple cells in V1, ON-OFF regions, labeled in English\"}]`.",
    "",
    "Your job is to fill both arrays AND place the placeholders in `article`:",
    "",
    "### `imageQueries` (real-image search) — AT LEAST 2-3 items.",
    "  • For topics with real-world references (Eiffel Tower, a cell, the Civil War, lab equipment, a famous painting, a landscape, a historical document) — ALWAYS add 2-4 queries.",
    "  • Each `query` is a short ENGLISH search string (Brave works best in English): \"Eiffel Tower iron lattice closeup\", \"mitochondria electron microscope\", \"American Civil War Gettysburg battlefield\".",
    "  • `id` — short unique identifier: `i1`, `i2`, `i3`...",
    "  • `alt` — short description of what the viewer will see.",
    "  • Each `id` corresponds to exactly one `[[IMG:i1]]` placeholder in `article` — put it in a thematically appropriate spot.",
    "",
    "### `generatedFigures` (AI-generated unique figures) — 1-2 items when appropriate.",
    "  • Use for unique schemes/illustrations that aren't available online: \"process N as a clear schematic\", \"anatomy of X in textbook style\", \"event timeline\", \"abstract visualisation of a concept\".",
    "  • `id` — short unique identifier: `f1`, `f2`...",
    "  • `prompt` — detailed ENGLISH descriptive prompt including style (\"minimalist educational diagram, white background, labeled parts in blue, isometric view\" / \"watercolor illustration, soft palette\" / \"photorealistic, studio lighting\").",
    "  • DO NOT duplicate generatedFigures with imageQueries — only generate what cannot be found ready-made.",
    "  • `alt` — short description.",
    "  • Place the `[[IMG:f1]]` placeholder in `article` exactly where the figure is needed.",
    "",
    "### Rules for the other fields",
    "  • article — main text, 800-2000 words. Headings # ## ###, dense content.",
    "  • Images are placed ONLY via `[[IMG:<id>]]` on its own line. Do not write `[[ILLUSTRATION: ...]]`, `[[DIAGRAM: ...]]` — they don't work.",
    "  • DO NOT MAKE UP image URLs. Any bare URL in `article` is ignored.",
    "  • Every id declared in imageQueries/generatedFigures must appear in `article` exactly once. Every `[[IMG:<id>]]` in the text must have a matching entry in one of the arrays.",
    "  • videos: 1-3 youtube/youtu.be links — the user verifies URLs themselves.",
    "  • links: 2-5 authoritative articles.",
    "  • diagrams (mermaid): only flowchart/sequence/class — where mermaid is genuinely more convenient than an image. For visual schemes use generatedFigures.",
    "  • homework: 3-5 practical exercises with a verifiable result.",
    "",
    "Reply with JSON ONLY on a single line, no markdown fences.",
    "",
    webContext
      ? `## Web sources to ground on\n${webContext}`
      : "## Web sources unavailable — rely on your own knowledge.",
  ].join("\n");

  const result = await callJsonAgent<LlmDraft>({
    prompt,
    invoke: (p) => reflex.agent.invoke({ prompt: p, timeoutMs: 7 * 60_000 }),
    maxAttempts: 4,
    shapeHint:
      `{"article":"...","videos":[],"links":[],"imageQueries":[],"generatedFigures":[],"diagrams":[],"homework":[]}\n` +
      `article — markdown 800-2000 words. Every list field must be an array (empty is OK).`,
    validate: (p) => {
      const v = p as LlmDraft;
      return typeof v?.article === "string" && v.article.trim().length > 40
        ? v
        : null;
    },
  });
  if (!result.ok) {
    throw new Error(
      `Failed to build the module in ${result.attempts} attempts (${result.reason}). ` +
        `Last reply: "${snippet(result.lastText, 200)}".`,
    );
  }
  const draft = result.value;

  // 3. Resolve image needs in parallel. Each call is best-effort —
  // a failed search or generation just drops that image from the module
  // (we don't want one flaky API to fail the whole build).
  const [searchedImages, generatedImages] = await Promise.all([
    resolveSearches(draft.imageQueries ?? [], args.topic, args.moduleTitle),
    resolveGenerations(draft.generatedFigures ?? []),
  ]);

  // Inline-place images by substituting [[IMG:<id>]] placeholders in the
  // article body. Any image whose id wasn't referenced (LLM forgot)
  // falls back into the trailing "Additional illustrations" section so
  // nothing gets dropped silently. Residual unknown [[...]] markers are
  // stripped.
  const allImages = [...searchedImages, ...generatedImages];
  const { article: articleWithImages, placedIds } = substituteImagePlaceholders(
    typeof draft.article === "string" ? draft.article : "",
    allImages,
  );
  const articleClean = stripPlaceholderMarkers(articleWithImages);
  const unplaced = allImages.filter((im) => !placedIds.has(im.id));

  const content: Omit<ModuleContent, "relPath"> = {
    courseId: args.courseId,
    moduleId: args.moduleId,
    title: args.moduleTitle,
    article: articleClean,
    videos: sanitizeArr(draft.videos, ["title", "url"]) as ModuleContent["videos"],
    links: sanitizeArr(draft.links, ["title", "url"]) as ModuleContent["links"],
    images: allImages,
    diagrams: sanitizeArr(draft.diagrams, ["title", "mermaid"]) as ModuleContent["diagrams"],
    homework: Array.isArray(draft.homework)
      ? draft.homework.map(String).filter(Boolean).slice(0, 8)
      : [],
  };

  // 4. Persist as a KB entry. Frontmatter holds the structured bits;
  // body = article with images already inlined + optional fallback
  // section for images the LLM declared but never referenced.
  const body = [
    content.article,
    unplaced.length > 0
      ? "\n\n## Additional illustrations\n" +
        unplaced
          .map((im) => `${renderInlineImage(im)}`)
          .join("\n\n")
      : "",
    content.diagrams.length > 0
      ? "\n\n## Diagrams\n" +
        content.diagrams
          .map(
            (d) =>
              `### ${d.title}\n\n\`\`\`mermaid\n${d.mermaid}\n\`\`\``,
          )
          .join("\n\n")
      : "",
  ]
    .filter(Boolean)
    .join("");

  const saved = await reflex.kb.add({
    kind: "course-module",
    title: `${args.topic} · ${args.moduleTitle}`,
    body,
    meta: {
      courseId: args.courseId,
      moduleId: args.moduleId,
      videos: JSON.stringify(content.videos),
      links: JSON.stringify(content.links),
      images: JSON.stringify(content.images),
      diagrams: JSON.stringify(content.diagrams),
      homework: JSON.stringify(content.homework),
      title: args.moduleTitle,
      objective: args.moduleObjective,
    },
    slug: `${args.courseId}-${args.moduleId}`,
  });

  await reflex.audit.log({
    type: "module-built",
    payload: {
      courseId: args.courseId,
      moduleId: args.moduleId,
      videos: content.videos.length,
      images: content.images.length,
      searched: searchedImages.length,
      generated: generatedImages.length,
    },
  });

  return { ...content, relPath: saved.relPath };
}

/**
 * For each query: do a web image search (5 candidates), ask the LLM
 * which best fits the course material, attach the chosen one. If the
 * LLM rejects all candidates (-1), the image slot is left empty — better
 * than embedding clip-art or off-topic stock photo. Try/catch isolates
 * per-image failures from killing the module build.
 */
async function resolveSearches(
  queries: Array<{ id?: unknown; alt?: unknown; query?: unknown }>,
  topic: string,
  moduleTitle: string,
): Promise<ModuleContent["images"]> {
  const clean = queries
    .filter(
      (q) =>
        q &&
        typeof q.query === "string" &&
        q.query.trim().length > 0,
    )
    .slice(0, 4);
  const out = await Promise.all(
    clean.map(async (q, idx) => {
      try {
        const query = q.query as string;
        const alt = typeof q.alt === "string" ? q.alt : query;
        const id =
          typeof q.id === "string" && q.id.trim().length > 0
            ? q.id.trim()
            : `i${idx + 1}`;
        // Default provider: Brave for breadth (real web), falls back to
        // Unsplash/Pexels via service-router based on which key exists.
        const search = await reflex.images.search({ query, count: 5 });
        if (search.results.length === 0) return null;
        // Vision-based pick: Reflex spawns the user's chat harness
        // (Codex / Claude Code) on the candidate thumbnails and asks it
        // to choose. The agent uses its Read tool — both runtimes get
        // real vision content for image files, so off-topic results
        // (clipart, mislabelled photos) are filtered by content, not
        // metadata.
        const pick = await reflex.images.pickBest({
          query,
          alt,
          context: `${topic} → ${moduleTitle}`,
          candidates: search.results.map((r) => ({
            url: r.url,
            thumb: r.thumb,
            attribution: r.attribution,
          })),
        });
        if (pick.pickIndex < 0 || pick.pickIndex >= search.results.length) {
          void reflex.audit.log({
            type: "image-rejected",
            payload: { query, reason: pick.reason, via: pick.via },
          });
          return null;
        }
        const chosen = search.results[pick.pickIndex];
        const attached = await reflex.images.attach({
          sourceUrl: chosen.url,
        });
        return {
          id,
          alt,
          url: attached.url,
          source: "search" as const,
          attribution: chosen.attribution,
        };
      } catch (err) {
        // Log to audit; the module survives without this image.
        void reflex.audit.log({
          type: "image-search-failed",
          payload: {
            query: q.query,
            error: err instanceof Error ? err.message : String(err),
          },
        });
        return null;
      }
    }),
  );
  return out.filter((x): x is NonNullable<typeof x> => x !== null);
}

/**
 * Walk through the article body, find `[[IMG:<id>]]` placeholders, and
 * replace each with a markdown image reference using the resolved
 * image's URL + alt + attribution.
 *
 * Returns the rewritten article + the set of ids successfully placed.
 * Unknown placeholders (id has no matching resolved image) get stripped
 * — likely a generation/search failure that already logged to audit.
 *
 * Whitespace around inline placeholders is normalized so the image sits
 * as its own block (Markdown then renders `![](...)` as a paragraph).
 */
function substituteImagePlaceholders(
  article: string,
  images: ModuleContent["images"],
): { article: string; placedIds: Set<string> } {
  const byId = new Map(images.map((im) => [im.id, im]));
  const placedIds = new Set<string>();
  // Accept variants: `[[IMG:i1]]`, `[[img:i1]]`, `[[IMG: i1 ]]`,
  // `[[IMG i1]]`, and even single-bracket `[IMG:i1]` from sloppy LLMs.
  const re = /\[\[?\s*IMG\s*[:\s]\s*([A-Za-z0-9_-]+)\s*\]\]?/gi;
  const replaced = article.replace(re, (_, rawId: string) => {
    const id = rawId.trim();
    const img = byId.get(id);
    if (!img) return "";
    placedIds.add(id);
    return `\n\n${renderInlineImage(img)}\n\n`;
  });
  return { article: replaced, placedIds };
}

function renderInlineImage(im: ModuleContent["images"][number]): string {
  const safeAlt = im.alt.replace(/[\[\]\n]/g, " ").slice(0, 200);
  const credit =
    im.source === "search" && im.attribution?.name
      ? `\n\n_Source: [${im.attribution.name}](${im.attribution.link || im.url})_`
      : im.source === "generated"
        ? `\n\n_Generated by AI_`
        : "";
  return `![${safeAlt}](${im.url})${credit}`;
}

/**
 * Strip residual `[[ILLUSTRATION: ...]]` / `[[DIAGRAM: ...]]` / orphan
 * `[[IMG:<unknown-id>]]` placeholders the LLM might emit despite the
 * prompt forbidding them OR after `substituteImagePlaceholders` failed
 * to find the id. Drops the marker, collapses surrounding whitespace.
 *
 * Matches several spelling variants for safety. Case-insensitive.
 */
function stripPlaceholderMarkers(text: string): string {
  const re =
    /\[\[?\s*(?:ILLUSTRATION|SCHEME|IMAGE|IMG|DIAGRAM)\b[^\]]*?\]\]?/giu;
  let out = text.replace(re, "");
  // Clean up double blank lines + trailing whitespace the removal may
  // have left behind.
  out = out.replace(/[ \t]+\n/g, "\n");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim() + "\n";
}

async function resolveGenerations(
  figures: Array<{ id?: unknown; alt?: unknown; prompt?: unknown }>,
): Promise<ModuleContent["images"]> {
  const clean = figures
    .filter(
      (f) =>
        f &&
        typeof f.prompt === "string" &&
        f.prompt.trim().length > 0,
    )
    .slice(0, 2);
  const out = await Promise.all(
    clean.map(async (f, idx) => {
      try {
        const gen = await reflex.images.generate({
          prompt: f.prompt as string,
          aspectRatio: "16:9",
        });
        const id =
          typeof f.id === "string" && f.id.trim().length > 0
            ? f.id.trim()
            : `f${idx + 1}`;
        return {
          id,
          alt: typeof f.alt === "string" ? f.alt : (f.prompt as string).slice(0, 80),
          url: gen.url,
          source: "generated" as const,
        };
      } catch (err) {
        void reflex.audit.log({
          type: "image-generate-failed",
          payload: {
            prompt: f.prompt,
            error: err instanceof Error ? err.message : String(err),
          },
        });
        return null;
      }
    }),
  );
  return out.filter((x): x is NonNullable<typeof x> => x !== null);
}

function sanitizeArr(
  v: unknown,
  required: string[],
): Array<Record<string, string>> {
  if (!Array.isArray(v)) return [];
  const out: Array<Record<string, string>> = [];
  for (const item of v.slice(0, 12)) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const ok = required.every(
      (k) => typeof o[k] === "string" && (o[k] as string).trim() !== "",
    );
    if (!ok) continue;
    const row: Record<string, string> = {};
    for (const [k, val] of Object.entries(o)) {
      if (typeof val === "string") row[k] = val;
    }
    out.push(row);
  }
  return out;
}
