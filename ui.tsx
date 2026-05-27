import { useEffect, useMemo, useRef, useState } from "react";
import { reflex } from "@host/api";
import { listCourses, readCourse, writeCourse, type CourseState } from "./actions/_store";
import { ArticleImageLightbox, ArticleView } from "./article-view";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Textarea,
} from "@host/ui";

/**
 * "Learn Anything" — universal AI tutor / course builder.
 *
 * UI state machine:
 *   list      → user's existing courses + "New course" button
 *   wizard    → topic → agent-driven Q&A → ready
 *   outline   → preview of generated modules → "Start"
 *   module    → article + video + links + diagrams + quiz + homework + trainer
 *   trainer   → fullscreen iframe with the generated HTML
 */

interface OutlineModule {
  id: string;
  title: string;
  objective: string;
  estMinutes: number;
}

interface CourseSummary {
  relPath: string;
  courseId: string;
  topic: string;
  modules: OutlineModule[];
  progress: Record<string, { completed?: boolean; quizScore?: number }>;
  createdAt: string;
}

interface ModuleContent {
  courseId: string;
  moduleId: string;
  title: string;
  article: string;
  videos: Array<{ title: string; url: string; note?: string }>;
  links: Array<{ title: string; url: string; snippet?: string }>;
  images: Array<{ alt: string; url: string }>;
  diagrams: Array<{ title: string; mermaid: string }>;
  homework: string[];
}

interface QuizQuestion {
  stem: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

type View =
  | { name: "list" }
  | { name: "wizard"; topic: string }
  | { name: "outline"; course: CourseSummary }
  | { name: "course"; course: CourseSummary }
  | {
      name: "module";
      course: CourseSummary;
      module: OutlineModule;
      content: ModuleContent | null;
      quiz: QuizQuestion[] | null;
    }
  | { name: "trainer"; html: string; title: string };

export default function LearnAnythingUtility() {
  const [view, setView] = useState<View>({ name: "list" });
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshList = async () => {
    try {
      const states = await listCourses();
      setCourses(
        states.map((s) => ({
          relPath: `data/courses/${s.courseId}.json`,
          courseId: s.courseId,
          topic: s.topic,
          modules: s.modules,
          progress: s.progress,
          createdAt: s.createdAt,
        })),
      );
    } catch (err: unknown) {
      setError(String(err));
    }
  };

  useEffect(() => {
    void refreshList();
  }, []);

  // Whenever the user returns to the list view, re-pull from KB —
  // covers "just created a course", "just deleted a module", any
  // background change the wizard/outline/module flows produced.
  useEffect(() => {
    if (view.name === "list") void refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.name]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-6 space-y-4">
        <header className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">🎓 Learn Anything</h1>
          <span className="text-xs text-slate-500">
            personal AI tutor
          </span>
          <div className="ml-auto" />
          {view.name !== "list" && (
            <Button
              variant="outline"
              type="button"
              onClick={() => setView({ name: "list" })}
            >
              ← Back to courses
            </Button>
          )}
        </header>

        {view.name === "list" && (
          <CourseList
            courses={courses}
            onOpen={(c) => setView({ name: "course", course: c })}
            onNew={(topic) => setView({ name: "wizard", topic })}
          />
        )}

        {view.name === "wizard" && (
          <WizardView
            topic={view.topic}
            onCancel={() => setView({ name: "list" })}
            onReady={async (course) => {
              await refreshList();
              setView({ name: "outline", course });
            }}
            onError={setError}
          />
        )}

        {view.name === "outline" && (
          <OutlineView
            course={view.course}
            onStart={() => setView({ name: "course", course: view.course })}
          />
        )}

        {view.name === "course" && (
          <CourseView
            course={view.course}
            onOpenModule={(mod) =>
              setView({
                name: "module",
                course: view.course,
                module: mod,
                content: null,
                quiz: null,
              })
            }
          />
        )}

        {view.name === "module" && (
          <ModuleView
            course={view.course}
            module={view.module}
            content={view.content}
            quiz={view.quiz}
            onContent={(content) =>
              setView((cur) =>
                cur.name === "module" ? { ...cur, content } : cur,
              )
            }
            onQuiz={(quiz) =>
              setView((cur) =>
                cur.name === "module" ? { ...cur, quiz } : cur,
              )
            }
            onTrainer={(html, title) =>
              setView({ name: "trainer", html, title })
            }
            onProgress={async (mark) => {
              await markProgress(view.course, view.module.id, mark);
              await refreshList();
            }}
            onError={setError}
          />
        )}

        {view.name === "trainer" && (
          <TrainerView
            html={view.html}
            title={view.title}
            onClose={() =>
              setView((cur) => ({ name: "list" } as View))
            }
          />
        )}

        {error && (
          <p className="text-xs text-red-600">Error: {error}</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LIST VIEW

function CourseList({
  courses,
  onOpen,
  onNew,
}: {
  courses: CourseSummary[];
  onOpen: (c: CourseSummary) => void;
  onNew: (topic: string) => void;
}) {
  const [topic, setTopic] = useState("");
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>🎯 What do you want to learn?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. watercolor painting, python for backend, spanish from scratch"
            onKeyDown={(e) => {
              if (e.key === "Enter" && topic.trim()) {
                e.preventDefault();
                onNew(topic.trim());
              }
            }}
          />
          <Button
            onClick={() => topic.trim() && onNew(topic.trim())}
            disabled={!topic.trim()}
          >
            Build course →
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>📚 My courses ({courses.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {courses.length === 0 ? (
            <p className="text-sm text-slate-500">
              None yet. Enter a topic above — Reflex will ask 3-4 questions
              and assemble a program.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {courses.map((c) => {
                const total = c.modules.length;
                const done = Object.values(c.progress).filter(
                  (p) => p?.completed,
                ).length;
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                return (
                  <li key={c.relPath}>
                    <button
                      type="button"
                      onClick={() => onOpen(c)}
                      className="w-full text-left rounded-md border bg-white px-3 py-2 hover:bg-slate-50"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{c.topic}</span>
                        <span className="ml-auto text-xs text-slate-500">
                          {done}/{total} modules
                        </span>
                      </div>
                      <div className="mt-1 h-1 rounded-full bg-slate-200 overflow-hidden">
                        <div
                          className="h-full bg-violet-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WIZARD

function WizardView({
  topic,
  onCancel,
  onReady,
  onError,
}: {
  topic: string;
  onCancel: () => void;
  onReady: (course: CourseSummary) => void;
  onError: (err: string) => void;
}) {
  const [history, setHistory] = useState<Array<{ question: string; answer: string }>>([]);
  const [current, setCurrent] = useState<{
    question: string;
    header?: string;
    choices?: string[];
  } | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"ask" | "building" | "done">("ask");

  const ask = async (h: typeof history) => {
    setBusy(true);
    try {
      const r = (await reflex.actions.invoke({
        name: "tutorAsk",
        args: { topic, history: h },
      })) as {
        done: boolean;
        question?: string;
        header?: string;
        choices?: string[];
      };
      if (r.done || !r.question) {
        await buildOutline(h);
      } else {
        setCurrent({
          question: r.question,
          ...(r.header ? { header: r.header } : {}),
          ...(r.choices ? { choices: r.choices } : {}),
        });
      }
    } catch (err: unknown) {
      onError(String(err));
      onCancel();
    } finally {
      setBusy(false);
    }
  };

  const buildOutline = async (h: typeof history) => {
    setPhase("building");
    try {
      const r = (await reflex.actions.invoke({
        name: "generateOutline",
        args: { topic, history: h },
      })) as {
        courseId: string;
        topic: string;
        modules: OutlineModule[];
        relPath: string;
        createdAt: string;
      };
      await reflex.actions.invoke({ name: "refreshCourseCard" });
      onReady({
        relPath: r.relPath,
        courseId: r.courseId,
        topic: r.topic,
        modules: r.modules,
        progress: {},
        createdAt: r.createdAt,
      });
    } catch (err: unknown) {
      onError(String(err));
      onCancel();
    }
  };

  useEffect(() => {
    void ask([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === "building") {
    return (
      <Card>
        <CardContent className="py-8 text-center space-y-2">
          <div className="text-2xl">📐</div>
          <p className="text-sm text-slate-600">
            Building the course program… this takes 20-40 seconds.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="text-slate-500 text-xs uppercase tracking-wider">
            Topic:
          </span>{" "}
          {topic}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {history.length > 0 && (
          <div className="space-y-1 text-xs">
            {history.map((qa, i) => (
              <div key={i} className="text-slate-500">
                <span className="font-medium">Q{i + 1}:</span> {qa.question}
                <br />
                <span className="font-medium">A{i + 1}:</span> {qa.answer}
              </div>
            ))}
          </div>
        )}
        {current ? (
          <>
            {current.header && (
              <Badge variant="outline" className="text-[10px]">
                {current.header}
              </Badge>
            )}
            <p className="font-medium">{current.question}</p>
            {current.choices && current.choices.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {current.choices.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setDraft(c)}
                    className={
                      "rounded-full border px-3 py-1 text-xs " +
                      (draft === c
                        ? "bg-violet-600 text-white border-violet-600"
                        : "bg-white hover:bg-slate-100")
                    }
                  >
                    {c}
                  </button>
                ))}
              </div>
            ) : null}
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              placeholder="your answer…"
            />
            <div className="flex items-center gap-2">
              <Button
                disabled={busy || !draft.trim()}
                onClick={() => {
                  const next = [
                    ...history,
                    { question: current.question, answer: draft.trim() },
                  ];
                  setHistory(next);
                  setDraft("");
                  setCurrent(null);
                  void ask(next);
                }}
              >
                Answer →
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void buildOutline(history)}
              >
                Enough, build the course
              </Button>
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-500">Thinking about the next question…</p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// OUTLINE

function OutlineView({
  course,
  onStart,
}: {
  course: CourseSummary;
  onStart: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>🧭 Program for course "{course.topic}"</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ol className="space-y-2 list-decimal pl-5">
          {course.modules.map((m) => (
            <li key={m.id} className="text-sm">
              <span className="font-medium">{m.title}</span>
              {m.objective && (
                <span className="text-slate-600"> — {m.objective}</span>
              )}
              <span className="text-xs text-slate-400 ml-1">
                (~{m.estMinutes} min)
              </span>
            </li>
          ))}
        </ol>
        <Button onClick={onStart}>Start learning →</Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// COURSE OVERVIEW

function CourseView({
  course,
  onOpenModule,
}: {
  course: CourseSummary;
  onOpenModule: (m: OutlineModule) => void;
}) {
  const done = course.modules.filter(
    (m) => course.progress[m.id]?.completed,
  ).length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>📚 {course.topic}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-slate-500">
          Progress: {done} of {course.modules.length}
        </div>
        <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
          <div
            className="h-full bg-violet-500"
            style={{
              width: `${course.modules.length > 0 ? (done / course.modules.length) * 100 : 0}%`,
            }}
          />
        </div>
        <ul className="space-y-1.5">
          {course.modules.map((m, i) => {
            const p = course.progress[m.id];
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onOpenModule(m)}
                  className="w-full text-left rounded-md border bg-white px-3 py-2 hover:bg-slate-50 flex items-center gap-2"
                >
                  <span
                    className={
                      "h-5 w-5 rounded-full text-[10px] font-mono flex items-center justify-center " +
                      (p?.completed
                        ? "bg-emerald-500 text-white"
                        : "bg-slate-200 text-slate-600")
                    }
                  >
                    {p?.completed ? "✓" : i + 1}
                  </span>
                  <span className="flex-1 truncate">{m.title}</span>
                  {p?.quizScore !== undefined && (
                    <Badge variant="outline" className="text-[10px]">
                      quiz {p.quizScore}%
                    </Badge>
                  )}
                  <span className="text-[10px] text-slate-400">
                    ~{m.estMinutes} min
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// MODULE VIEW (article + video + quiz + homework + trainer + selection-explain)

function ModuleView({
  course,
  module,
  content,
  quiz,
  onContent,
  onQuiz,
  onTrainer,
  onProgress,
  onError,
}: {
  course: CourseSummary;
  module: OutlineModule;
  content: ModuleContent | null;
  quiz: QuizQuestion[] | null;
  onContent: (c: ModuleContent) => void;
  onQuiz: (q: QuizQuestion[]) => void;
  onTrainer: (html: string, title: string) => void;
  onProgress: (mark: { completed?: boolean; quizScore?: number }) => Promise<void>;
  onError: (err: string) => void;
}) {
  const [building, setBuilding] = useState(false);
  /**
   * Book-style annotation. When the reader selects text, this object
   * captures:
   *   - `text`: what's selected (passed to the explainer).
   *   - `rects`: viewport rectangles per line — used to draw the
   *     yellow highlight overlay so the user sees what the note refers
   *     to even after the browser drops the selection on click.
   *   - `anchorTop` / `anchorBottom` / `anchorLeft`: where the popover
   *     should attach (above the selection by default, below if there's
   *     no vertical room).
   *   - `question` / `showQuestion`: optional custom user question.
   *   - `status`: idle → loading → done.
   *   - `explanation`: agent's reply.
   */
  const [annot, setAnnot] = useState<{
    text: string;
    rects: { top: number; left: number; width: number; height: number }[];
    anchorTop: number;
    anchorBottom: number;
    anchorLeft: number;
    anchorWidth: number;
    question: string;
    showQuestion: boolean;
    status: "idle" | "loading" | "done";
    explanation: string | null;
  } | null>(null);
  const [galleryZoom, setGalleryZoom] = useState<{ src: string; alt: string } | null>(
    null,
  );
  const [quizBusy, setQuizBusy] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [trainerBusy, setTrainerBusy] = useState(false);
  const [trainerIdea, setTrainerIdea] = useState("");
  const articleRef = useRef<HTMLDivElement | null>(null);

  // Try to load already-cached module content from KB first.
  useEffect(() => {
    void (async () => {
      try {
        const list = (await reflex.kb.list({ kind: "course-module" })) ?? [];
        for (const it of list) {
          const { content: raw } = await reflex.kb.read({ relPath: it.relPath });
          const fm = parseFrontmatter(raw);
          if (
            stringOf(fm?.courseId) === course.courseId &&
            stringOf(fm?.moduleId) === module.id
          ) {
            const body = stripFrontmatter(raw);
            onContent({
              courseId: course.courseId,
              moduleId: module.id,
              title: module.title,
              article: body,
              videos: parseJson<ModuleContent["videos"]>(fm?.videos) ?? [],
              links: parseJson<ModuleContent["links"]>(fm?.links) ?? [],
              images: parseJson<ModuleContent["images"]>(fm?.images) ?? [],
              diagrams: parseJson<ModuleContent["diagrams"]>(fm?.diagrams) ?? [],
              homework: parseJson<string[]>(fm?.homework) ?? [],
            });
            return;
          }
        }
      } catch {
        /* fall through to build */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const build = async () => {
    setBuilding(true);
    try {
      const r = (await reflex.actions.invoke({
        name: "buildModule",
        args: {
          courseId: course.courseId,
          moduleId: module.id,
          moduleTitle: module.title,
          moduleObjective: module.objective,
          topic: course.topic,
        },
      })) as ModuleContent;
      onContent(r);
    } catch (err: unknown) {
      onError(String(err));
    } finally {
      setBuilding(false);
    }
  };

  /**
   * Snapshot the current browser selection into our annotation state.
   * Wrapped in a `requestAnimationFrame` defer because the browser may
   * not have finalised the selection by the time `mouseup` fires (and
   * a stale selection sneaks in). RAF runs after the next layout pass
   * so `window.getSelection()` reflects the user's actual drag.
   */
  const captureSelection = () => {
    if (typeof window === "undefined") return;
    const sel = window.getSelection?.();
    const text = sel?.toString().trim() ?? "";
    if (text.length < 6) return;
    let rects: { top: number; left: number; width: number; height: number }[] = [];
    let anchorTop = 0;
    let anchorBottom = 0;
    let anchorLeft = 0;
    let anchorWidth = 0;
    try {
      const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
      if (range) {
        const list = range.getClientRects();
        for (let i = 0; i < list.length; i++) {
          const r = list[i]!;
          if (r.width <= 0 || r.height <= 0) continue;
          rects.push({
            top: r.top,
            left: r.left,
            width: r.width,
            height: r.height,
          });
        }
        const bbox = range.getBoundingClientRect();
        anchorTop = bbox.top;
        anchorBottom = bbox.bottom;
        anchorLeft = bbox.left;
        anchorWidth = bbox.width;
      }
    } catch {
      /* keep empty */
    }
    setAnnot({
      text,
      rects,
      anchorTop,
      anchorBottom,
      anchorLeft,
      anchorWidth,
      question: "",
      showQuestion: false,
      status: "idle",
      explanation: null,
    });
  };

  const onTextSelect = () => {
    // Defer one frame so the browser's selection state is up-to-date.
    // On some Macs `mouseup → getSelection()` still returns the previous
    // selection (race condition between event dispatch and selection
    // update). RAF lets that settle.
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(captureSelection);
  };

  /**
   * Clear the native browser selection when our popover closes so the
   * next user drag starts from a clean slate. Without this, Safari/
   * Chromium occasionally re-emits the OLD selection on the next
   * mouseup → looked like "annotation doesn't reappear" because we
   * thought the new text was the same as the closed one.
   */
  const closeAnnot = () => {
    if (typeof window !== "undefined") {
      try {
        window.getSelection?.()?.removeAllRanges();
      } catch {
        /* ignore */
      }
    }
    setAnnot(null);
  };

  useEffect(() => {
    if (!annot) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAnnot();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annot]);

  const runExplain = async (customQuestion?: string) => {
    if (!annot || !content) return;
    setAnnot({ ...annot, status: "loading", explanation: null });
    try {
      const r = (await reflex.actions.invoke({
        name: "explainSelection",
        args: {
          selection: annot.text,
          context: content.article.slice(0, 1500),
          topic: course.topic,
          moduleTitle: module.title,
          ...(customQuestion && customQuestion.trim()
            ? { question: customQuestion.trim() }
            : {}),
        },
      })) as { text: string };
      setAnnot((cur) =>
        cur ? { ...cur, status: "done", explanation: r.text } : null,
      );
    } catch (err: unknown) {
      onError(String(err));
      setAnnot((cur) => (cur ? { ...cur, status: "idle" } : null));
    }
  };

  const startQuiz = async () => {
    if (!content) return;
    setQuizBusy(true);
    setQuizSubmitted(false);
    setQuizAnswers({});
    try {
      const r = (await reflex.actions.invoke({
        name: "generateQuiz",
        args: {
          moduleTitle: module.title,
          moduleObjective: module.objective,
          article: content.article,
        },
      })) as { questions: QuizQuestion[] };
      onQuiz(r.questions);
    } catch (err: unknown) {
      onError(String(err));
    } finally {
      setQuizBusy(false);
    }
  };

  const submitQuiz = async () => {
    if (!quiz) return;
    const correct = quiz.filter(
      (q, i) => quizAnswers[i] === q.correctIndex,
    ).length;
    const score = Math.round((correct / quiz.length) * 100);
    setQuizSubmitted(true);
    await onProgress({ quizScore: score, completed: score >= 60 });
    await reflex.actions.invoke({ name: "refreshCourseCard" });
  };

  const makeTrainer = async () => {
    setTrainerBusy(true);
    try {
      const r = (await reflex.actions.invoke({
        name: "generateTrainer",
        args: {
          courseId: course.courseId,
          moduleId: module.id,
          moduleTitle: module.title,
          moduleObjective: module.objective,
          prompt: trainerIdea,
        },
      })) as { html: string; title: string };
      onTrainer(r.html, r.title);
    } catch (err: unknown) {
      onError(String(err));
    } finally {
      setTrainerBusy(false);
    }
  };

  if (building) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-slate-500">
          📖 Gathering materials, articles, videos, diagrams… 30-60 seconds.
        </CardContent>
      </Card>
    );
  }

  if (!content) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{module.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-slate-600">{module.objective}</p>
          <Button onClick={() => void build()}>Prepare module →</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{content.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div ref={articleRef}>
            <ArticleView source={content.article} onMouseUp={onTextSelect} />
          </div>
          {/* Book-style annotation: yellow highlight on the selection
              rectangles + a margin-note popover that floats near the
              selection (above by default, below if no room). */}
          {annot && (
            <AnnotationOverlay
              annot={annot}
              onClose={closeAnnot}
              onExplain={() => void runExplain()}
              onAsk={(q) => void runExplain(q)}
              onChange={(patch) =>
                setAnnot((cur) => (cur ? { ...cur, ...patch } : null))
              }
            />
          )}
        </CardContent>
      </Card>

      {content.images.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>🖼 Illustrations</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            {content.images.map((im, i) => (
              <figure key={i} className="space-y-1">
                <img
                  src={im.url}
                  alt={im.alt}
                  loading="lazy"
                  title={im.alt || "Open fullscreen"}
                  onClick={() =>
                    setGalleryZoom({ src: im.url, alt: im.alt })
                  }
                  className="rounded border bg-white cursor-zoom-in transition hover:opacity-90"
                />
                <figcaption className="text-[11px] text-slate-500">
                  {im.alt}
                </figcaption>
              </figure>
            ))}
          </CardContent>
        </Card>
      )}
      {galleryZoom && (
        <ArticleImageLightbox
          src={galleryZoom.src}
          alt={galleryZoom.alt}
          onClose={() => setGalleryZoom(null)}
        />
      )}

      {content.diagrams.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>📐 Diagrams</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {content.diagrams.map((d, i) => (
              <div key={i}>
                <div className="text-sm font-semibold text-slate-700 mb-1">
                  {d.title}
                </div>
                {/* Wrap mermaid source in a fenced block so ArticleView
                    picks it up and renders SVG via the global mermaid lib. */}
                <ArticleView
                  source={"```mermaid\n" + d.mermaid + "\n```"}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {content.videos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>🎬 Videos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {content.videos.map((v, i) => (
              <a
                key={i}
                href={v.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded border bg-white px-3 py-2 hover:bg-slate-50 text-sm"
              >
                <div className="font-medium">{v.title}</div>
                {v.note && (
                  <div className="text-xs text-slate-500">{v.note}</div>
                )}
                <div className="text-[10px] font-mono text-slate-400 truncate">
                  {v.url}
                </div>
              </a>
            ))}
          </CardContent>
        </Card>
      )}

      {content.links.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>📑 Sources</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {content.links.map((l, i) => (
              <a
                key={i}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm hover:underline"
              >
                {l.title}
                {l.snippet && (
                  <span className="text-xs text-slate-500"> — {l.snippet}</span>
                )}
              </a>
            ))}
          </CardContent>
        </Card>
      )}

      {content.homework.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>📝 Homework</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm list-decimal pl-5">
              {content.homework.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>✅ Quiz check</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!quiz ? (
            <Button onClick={() => void startQuiz()} disabled={quizBusy}>
              {quizBusy ? "Preparing…" : "Generate quiz"}
            </Button>
          ) : (
            <>
              <ol className="space-y-3 list-decimal pl-5">
                {quiz.map((q, i) => (
                  <li key={i} className="text-sm">
                    <div className="font-medium">{q.stem}</div>
                    <ul className="mt-1 space-y-0.5">
                      {q.options.map((opt, oi) => {
                        const picked = quizAnswers[i] === oi;
                        const correct = quizSubmitted && oi === q.correctIndex;
                        const wrongPick =
                          quizSubmitted && picked && oi !== q.correctIndex;
                        return (
                          <li key={oi}>
                            <label
                              className={
                                "flex items-center gap-1.5 rounded px-2 py-1 text-xs cursor-pointer " +
                                (correct
                                  ? "bg-emerald-100 text-emerald-900"
                                  : wrongPick
                                    ? "bg-red-100 text-red-900"
                                    : picked
                                      ? "bg-violet-100"
                                      : "hover:bg-slate-100")
                              }
                            >
                              <input
                                type="radio"
                                name={`q-${i}`}
                                checked={picked}
                                disabled={quizSubmitted}
                                onChange={() =>
                                  setQuizAnswers((cur) => ({
                                    ...cur,
                                    [i]: oi,
                                  }))
                                }
                              />
                              {opt}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                    {quizSubmitted && (
                      <p className="text-[11px] text-slate-600 mt-1 italic">
                        {q.explanation}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
              {!quizSubmitted ? (
                <Button
                  onClick={() => void submitQuiz()}
                  disabled={Object.keys(quizAnswers).length < quiz.length}
                >
                  Check
                </Button>
              ) : (
                <Badge variant="default" className="text-xs">
                  Score:{" "}
                  {Math.round(
                    (quiz.filter((q, i) => quizAnswers[i] === q.correctIndex)
                      .length /
                      quiz.length) *
                      100,
                  )}
                  %
                </Badge>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>🕹 Trainer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input
            value={trainerIdea}
            onChange={(e) => setTrainerIdea(e.target.value)}
            placeholder="trainer idea (optional) — Reflex will invent one if empty"
          />
          <Button onClick={() => void makeTrainer()} disabled={trainerBusy}>
            {trainerBusy ? "Building…" : "Generate interactive trainer"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-3 flex items-center gap-2">
          <Button
            onClick={() => void onProgress({ completed: true })}
            variant="outline"
          >
            ✓ Mark as completed
          </Button>
          <Button
            onClick={() => void onProgress({ completed: false })}
            variant="outline"
          >
            Unmark
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TRAINER (sandboxed iframe via srcdoc)

function TrainerView({
  html,
  title,
  onClose,
}: {
  html: string;
  title: string;
  onClose: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          🕹 Trainer · {title}
          <Button
            type="button"
            variant="outline"
            className="ml-auto"
            onClick={onClose}
          >
            Close
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <iframe
          srcDoc={html}
          sandbox="allow-scripts"
          className="w-full rounded border bg-white"
          style={{ height: 500 }}
          title={title}
        />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// helpers

async function markProgress(
  course: CourseSummary,
  moduleId: string,
  mark: { completed?: boolean; quizScore?: number },
): Promise<void> {
  // Source of truth is the sandboxed JSON file — patch + rewrite. KB
  // entry stays static (we don't update it on every tick).
  const cur = await readCourse(course.courseId);
  const base: CourseState = cur ?? {
    courseId: course.courseId,
    topic: course.topic,
    modules: course.modules,
    progress: course.progress,
    wizardAnswers: [],
    createdAt: course.createdAt,
    updatedAt: course.createdAt,
  };
  const next: CourseState = {
    ...base,
    progress: {
      ...base.progress,
      [moduleId]: { ...base.progress[moduleId], ...mark },
    },
    updatedAt: new Date().toISOString(),
  };
  await writeCourse(next);
}

function parseFrontmatter(raw: string): Record<string, unknown> | null {
  const m = /^---\n([\s\S]*?)\n---/.exec(raw);
  if (!m) return null;
  const out: Record<string, unknown> = {};
  for (const line of m[1]!.split("\n")) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return out;
}
function stripFrontmatter(raw: string): string {
  const m = /^---\n[\s\S]*?\n---\n?/.exec(raw);
  return m ? raw.slice(m[0].length) : raw;
}
function parseJson<T>(v: unknown): T | null {
  if (typeof v !== "string") return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}
function stringOf(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function baseSlug(rel: string): string {
  return (rel.split("/").pop() ?? rel).replace(/\.md$/, "");
}

// ---------------------------------------------------------------------------
// Annotation overlay — book-style margin note anchored to the user's
// selection. Renders two layers:
//
//   1. Highlight rectangles painted over each selection client-rect so
//      the reader sees what the note refers to even after the browser
//      drops the native selection on button click.
//
//   2. A floating popover above the selection (or below if the
//      selection sits near the top of the viewport). Initial state
//      offers `✨ Explain` (default action) and `❓ Ask a question`
//      (reveals an input). After the agent replies the popover stays
//      pinned in place and shows the explanation inline — readable
//      like a Kindle/Apple Books margin annotation.

interface AnnotState {
  text: string;
  rects: { top: number; left: number; width: number; height: number }[];
  anchorTop: number;
  anchorBottom: number;
  anchorLeft: number;
  anchorWidth: number;
  question: string;
  showQuestion: boolean;
  status: "idle" | "loading" | "done";
  explanation: string | null;
}

function AnnotationOverlay({
  annot,
  onClose,
  onExplain,
  onAsk,
  onChange,
}: {
  annot: AnnotState;
  onClose: () => void;
  onExplain: () => void;
  onAsk: (question: string) => void;
  onChange: (patch: Partial<AnnotState>) => void;
}) {
  // Popover is ~360px wide, ~auto height up to 60vh. Decide whether to
  // place it above or below the selection based on available room.
  const PW = 360;
  const PH_MAX = Math.min(
    480,
    typeof window !== "undefined" ? window.innerHeight * 0.7 : 480,
  );
  const viewportW =
    typeof window !== "undefined" ? window.innerWidth : 1024;
  const viewportH =
    typeof window !== "undefined" ? window.innerHeight : 768;
  const placeAbove = annot.anchorTop > PH_MAX + 24;
  const top = placeAbove
    ? Math.max(8, annot.anchorTop - PH_MAX - 12)
    : Math.min(viewportH - PH_MAX - 8, annot.anchorBottom + 12);
  const desiredLeft = annot.anchorLeft + annot.anchorWidth / 2 - PW / 2;
  const left = Math.min(viewportW - PW - 8, Math.max(8, desiredLeft));

  return (
    <>
      {/* Highlight overlay — one rectangle per visual line. */}
      {annot.rects.map((r, i) => (
        <div
          key={i}
          style={{
            position: "fixed",
            top: r.top,
            left: r.left,
            width: r.width,
            height: r.height,
            background: "rgba(250, 204, 21, 0.25)",
            borderBottom: "2px solid rgba(217, 119, 6, 0.65)",
            pointerEvents: "none",
            zIndex: 40,
          }}
        />
      ))}

      {/* Margin note popover. */}
      <div
        role="dialog"
        aria-label="Explanation"
        style={{
          position: "fixed",
          top,
          left,
          width: PW,
          maxHeight: PH_MAX,
          background: "#fffdf6",
          border: "1px solid #e7e5d6",
          borderRadius: 10,
          boxShadow:
            "0 1px 0 rgba(0,0,0,0.04), 0 10px 30px rgba(15,23,42,0.18)",
          zIndex: 50,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            borderBottom: "1px solid #efece1",
            background:
              "linear-gradient(0deg, rgba(250,204,21,0.10), rgba(250,204,21,0.10))",
            fontSize: 12,
            color: "#7c5e10",
          }}
        >
          <span aria-hidden>✨</span>
          <span style={{ fontWeight: 600 }}>Note</span>
          <span
            style={{
              marginLeft: 6,
              color: "#94908a",
              fontSize: 11,
              fontStyle: "italic",
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={annot.text}
          >
            {annot.text}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              border: "none",
              background: "transparent",
              color: "#94908a",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
              padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "10px 12px",
            fontSize: 13,
            lineHeight: 1.55,
            color: "#1f2937",
          }}
        >
          {annot.status === "idle" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={onExplain}
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    background: "#7c3aed",
                    color: "white",
                    border: "none",
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  ✨ Explain
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onChange({ showQuestion: !annot.showQuestion })
                  }
                  style={{
                    padding: "8px 12px",
                    background: annot.showQuestion ? "#ede9fe" : "white",
                    color: "#5b21b6",
                    border: "1px solid #ddd6fe",
                    borderRadius: 6,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                  title="Ask your own question about the selected fragment"
                >
                  ❓ Ask a question
                </button>
              </div>
              {annot.showQuestion && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (annot.question.trim()) onAsk(annot.question);
                  }}
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <textarea
                    value={annot.question}
                    onChange={(e) => onChange({ question: e.target.value })}
                    placeholder="For example: 'what does this law have to do with it?' or 'give me an example'"
                    autoFocus
                    rows={3}
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      border: "1px solid #ddd6fe",
                      borderRadius: 6,
                      fontSize: 12,
                      fontFamily: "inherit",
                      resize: "vertical",
                    }}
                  />
                  <button
                    type="submit"
                    disabled={!annot.question.trim()}
                    style={{
                      padding: "6px 10px",
                      background: "#7c3aed",
                      color: "white",
                      border: "none",
                      borderRadius: 6,
                      fontSize: 12,
                      cursor: annot.question.trim() ? "pointer" : "default",
                      opacity: annot.question.trim() ? 1 : 0.5,
                      alignSelf: "flex-end",
                    }}
                  >
                    Ask →
                  </button>
                </form>
              )}
            </div>
          )}

          {annot.status === "loading" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: "#7c5e10",
                fontStyle: "italic",
                padding: "8px 0",
              }}
            >
              <span aria-hidden>✨</span>
              <span>{annot.question ? "Thinking about the question…" : "Explaining…"}</span>
            </div>
          )}

          {annot.status === "done" && annot.explanation && (
            <div style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
              <ArticleView source={annot.explanation} />
              <div
                style={{
                  marginTop: 10,
                  paddingTop: 8,
                  borderTop: "1px dashed #efece1",
                  display: "flex",
                  gap: 6,
                }}
              >
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      status: "idle",
                      explanation: null,
                      showQuestion: true,
                    })
                  }
                  style={{
                    padding: "4px 8px",
                    background: "white",
                    color: "#5b21b6",
                    border: "1px solid #ddd6fe",
                    borderRadius: 6,
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  ❓ Another question
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// quiet unused-import linter for Memo-like helpers
void useMemo;
