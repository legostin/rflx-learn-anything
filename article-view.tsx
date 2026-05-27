import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import mermaid from "mermaid";

/**
 * Self-contained article renderer for course modules. Owns:
 *
 *   • Typography — no dependency on @tailwindcss/typography. Each
 *     markdown element is mapped to an explicit class so headings,
 *     blockquotes, lists, code blocks look like they belong in a
 *     reading app (think "course on the web", not "raw textarea").
 *
 *   • Mermaid diagrams — any `code` block with language=`mermaid` is
 *     swapped for a `<pre class="mermaid">` shell after mount; we then
 *     ask the global mermaid library to compile every such block on
 *     screen into an SVG. Re-runs whenever the source content changes.
 */
let mermaidReady = false;
function ensureMermaid(): void {
  if (mermaidReady) return;
  mermaidReady = true;
  try {
    mermaid.initialize({
      startOnLoad: false,
      theme: "neutral",
      securityLevel: "loose", // utility iframe is already sandboxed
      fontFamily:
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
    });
  } catch {
    /* mermaid init can be re-run safely; ignore early failures */
  }
}

export function ArticleView({
  source,
  onMouseUp,
}: {
  source: string;
  onMouseUp?: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Agents sometimes embed mermaid blocks without ```mermaid fences —
  // we wrap them on the fly so ReactMarkdown emits language-mermaid
  // <code> nodes that the `pre` override below picks up.
  const normalized = wrapBareMermaid(source);

  // Compile every <pre class="reflex-mermaid"> to inline SVG. Using
  // mermaid.render() per element (rather than mermaid.run) gives us
  // proper error capture per-block — we replace failed blocks with a
  // visible error message instead of leaving raw source on screen.
  useEffect(() => {
    ensureMermaid();
    const root = ref.current;
    if (!root) return;
    const nodes = Array.from(
      root.querySelectorAll<HTMLElement>("pre.reflex-mermaid:not(.reflex-mermaid-done)"),
    );
    if (nodes.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const node of nodes) {
        if (cancelled) return;
        const src = (node.dataset["src"] ?? node.textContent ?? "").trim();
        if (!src) continue;
        const id = `mmd-${Math.random().toString(36).slice(2, 9)}`;
        try {
          const { svg } = await mermaid.render(id, src);
          if (cancelled) return;
          node.innerHTML = svg;
          node.classList.add("reflex-mermaid-done");
          node.classList.remove("reflex-mermaid"); // shed the source styling
          node.style.fontFamily = "inherit";
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          node.innerHTML = `<div class="text-xs text-red-600 not-italic">⚠ Failed to render diagram: ${escapeHtml(msg)}</div><pre class="mt-2 text-[11px] text-slate-700 whitespace-pre-wrap">${escapeHtml(src)}</pre>`;
          node.classList.add("reflex-mermaid-done");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [normalized]);

  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);
  // Component map needs access to `setZoom`, so build it per-render
  // (memoed). The vast majority of nodes are static — only the `img`
  // override carries the click handler.
  const components = useMemo<Components>(
    () => ({
      ...MD_COMPONENTS,
      img: ({ src, alt }) => {
        const url = typeof src === "string" ? src : "";
        const safeAlt = typeof alt === "string" ? alt : "";
        if (!url) return null;
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={safeAlt}
            title={safeAlt || "Open fullscreen"}
            loading="lazy"
            onClick={() => setZoom({ src: url, alt: safeAlt })}
            className="my-5 rounded-lg border bg-white max-w-full h-auto cursor-zoom-in transition hover:opacity-90"
          />
        );
      },
    }),
    [],
  );
  return (
    <div
      ref={ref}
      onMouseUp={onMouseUp}
      className="text-slate-900 [&_*::selection]:bg-violet-200"
      style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {normalized}
      </ReactMarkdown>
      {zoom && (
        <ArticleImageLightbox
          src={zoom.src}
          alt={zoom.alt}
          onClose={() => setZoom(null)}
        />
      )}
    </div>
  );
}

/**
 * Reusable fullscreen lightbox. Exported so the rest of the learn-anything
 * UI (gallery card, etc.) can share the same overlay rather than each
 * surface rolling its own.
 */
export function ArticleImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );
  useEffect(() => {
    document.addEventListener("keydown", handleKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = prev;
    };
  }, [handleKey]);
  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-label={alt || "Image preview"}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background: "rgba(15, 23, 42, 0.85)",
        backdropFilter: "blur(4px)",
        cursor: "zoom-out",
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close"
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          height: 36,
          width: 36,
          borderRadius: 8,
          background: "rgba(255,255,255,0.92)",
          border: "1px solid rgba(15,23,42,0.1)",
          cursor: "pointer",
          fontSize: 18,
        }}
      >
        ×
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxHeight: "100%",
          maxWidth: "100%",
          objectFit: "contain",
          borderRadius: 12,
          boxShadow: "0 30px 60px rgba(0,0,0,0.5)",
        }}
      />
      {alt && (
        <div
          style={{
            position: "absolute",
            bottom: 24,
            left: 24,
            right: 24,
            textAlign: "center",
            color: "rgba(255,255,255,0.85)",
            fontSize: 13,
            pointerEvents: "none",
          }}
        >
          {alt}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Typography map. Explicit per-element so we don't rely on @tailwindcss/
// typography being available inside the utility's tailwind compile.

const MD_COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="mt-8 mb-4 text-3xl font-bold tracking-tight text-slate-900 border-b border-slate-200 pb-2">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-7 mb-3 text-2xl font-semibold tracking-tight text-slate-900">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-6 mb-2 text-xl font-semibold tracking-tight text-slate-900">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-5 mb-2 text-base font-semibold uppercase tracking-wider text-slate-700">
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p className="my-4 leading-7 text-slate-800 text-[15px]">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-slate-900">{children}</strong>
  ),
  em: ({ children }) => <em className="italic text-slate-800">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="my-5 border-l-4 border-violet-400 bg-violet-50/60 px-4 py-2 italic text-slate-700">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-8 border-slate-200" />,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-violet-700 underline decoration-violet-300 underline-offset-2 hover:decoration-violet-600"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="my-4 ml-6 list-disc space-y-1.5 text-[15px] text-slate-800 leading-7 marker:text-slate-400">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-4 ml-6 list-decimal space-y-1.5 text-[15px] text-slate-800 leading-7 marker:text-slate-500 marker:font-semibold">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-1">{children}</li>,
  code: ({ className, children }) => {
    const lang = /language-(\w+)/.exec(className ?? "")?.[1];
    // Inline code (no language) → small chip.
    if (!lang) {
      return (
        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[0.875em] font-mono text-violet-700">
          {children}
        </code>
      );
    }
    // Block code with a recognized fence — leave class for parent <pre>.
    return (
      <code className={`language-${lang} font-mono`}>{children}</code>
    );
  },
  pre: ({ children }) => {
    // Detect the mermaid case: the child <code> has lang=mermaid. Swap
    // <pre> for a marker class the effect later compiles into SVG.
    const child = Array.isArray(children) ? children[0] : children;
    if (
      child &&
      typeof child === "object" &&
      "props" in child &&
      typeof (child as { props?: { className?: string } }).props?.className ===
        "string"
    ) {
      const cls = (child as { props: { className: string } }).props.className;
      if (cls.includes("language-mermaid")) {
        const codeNode = child as { props: { children?: unknown } };
        const text = collectText(codeNode.props.children);
        // `data-src` carries the raw mermaid source so the effect
        // doesn't have to depend on `textContent` (which can pick up
        // ReactMarkdown's internal whitespace handling).
        return (
          <pre
            className="reflex-mermaid my-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm overflow-x-auto whitespace-pre"
            data-src={text}
            style={{ fontFamily: "ui-monospace, monospace" }}
          >
            {text}
          </pre>
        );
      }
    }
    return (
      <pre className="my-5 rounded-lg bg-slate-900 text-slate-50 px-4 py-3 text-sm overflow-x-auto leading-relaxed">
        {children}
      </pre>
    );
  },
  table: ({ children }) => (
    <div className="my-5 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-slate-100">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="border border-slate-300 px-3 py-2 text-left font-semibold text-slate-700">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-slate-200 px-3 py-2 align-top">{children}</td>
  ),
  // `img` is overridden per-render inside ArticleView (it needs setZoom).
};

/**
 * Wrap unfenced mermaid diagrams in ```mermaid …``` so ReactMarkdown
 * tags them as `language-mermaid` and the renderer pipeline catches
 * them. Detects blocks that START with a mermaid keyword (graph,
 * flowchart, sequenceDiagram, etc.) and run until a blank line or
 * the next heading.
 *
 * Already-fenced blocks pass through untouched.
 */
const MERMAID_KEYWORDS = [
  "graph",
  "flowchart",
  "sequenceDiagram",
  "classDiagram",
  "stateDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "gantt",
  "pie",
  "journey",
  "gitGraph",
  "mindmap",
  "timeline",
  "quadrantChart",
  "C4Context",
  "requirementDiagram",
];

function wrapBareMermaid(text: string): string {
  if (!text) return text;
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  let inFence = false;
  while (i < lines.length) {
    const line = lines[i]!;
    // Track fenced state so we never wrap inside an existing code block.
    if (/^```/.test(line)) {
      inFence = !inFence;
      out.push(line);
      i++;
      continue;
    }
    if (!inFence && isMermaidStart(line)) {
      // Collect lines until blank line, heading, or another fence start.
      const block: string[] = [line];
      let j = i + 1;
      while (j < lines.length) {
        const l = lines[j]!;
        if (l.trim() === "") break;
        if (/^#{1,6}\s/.test(l)) break;
        if (/^```/.test(l)) break;
        block.push(l);
        j++;
      }
      out.push("```mermaid");
      out.push(...block);
      out.push("```");
      i = j;
      continue;
    }
    out.push(line);
    i++;
  }
  return out.join("\n");
}

function isMermaidStart(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  for (const kw of MERMAID_KEYWORDS) {
    if (trimmed === kw) return true;
    if (trimmed.startsWith(kw + " ")) return true;
    // `graph LR`, `flowchart TD` etc.
    if (
      trimmed.startsWith(kw) &&
      /^[A-Z]{2}$/.test(trimmed.slice(kw.length).trim())
    ) {
      return true;
    }
  }
  return false;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function collectText(children: unknown): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(collectText).join("");
  if (children && typeof children === "object" && "props" in children) {
    const props = (children as { props?: { children?: unknown } }).props;
    return collectText(props?.children);
  }
  return "";
}
