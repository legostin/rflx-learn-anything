# 🎓 Learn Anything

Universal AI tutor. Enter a topic → the agent asks 2-4 clarifying questions (about level, goal, time, format) → assembles a 5-9 module program → each module includes a long article, video, illustrations, diagrams (mermaid), quiz, homework, and an interactive canvas trainer.

## Features

- **Agent-driven wizard** — questions are NOT hardcoded; the agent itself decides what matters to ask for a given topic. "I want to learn watercolor painting" and "I want to learn Python" lead to different questions.
- **Course outline** — generated with objectives and time estimates.
- **Module = 800-2000 word article** + video (YouTube) + source links + images (CC) + mermaid diagrams + 3-5 homework tasks.
- **Quiz** — 5-7 multiple-choice questions generated from the article, instant grading with explanations.
- **Progress** — completion mark + quiz result, persisted to KB.
- **Explain selection** — highlight any chunk of the article → the agent gives a detailed explanation with examples.
- **Trainer** — the agent writes standalone HTML/JS/canvas for an idea (or proposes one itself), Reflex renders it in a sandboxed iframe.

## KB schemas

- `course` — course root: `meta.courseId`, `meta.topic`, `meta.modules` (JSON), `meta.progress` (JSON), `meta.wizardAnswers` (JSON), `meta.createdAt`.
- `course-module` — module material: `meta.courseId`, `meta.moduleId`, JSON fields `videos`/`links`/`images`/`diagrams`/`homework`, body = article.
- `course-trainer` — trainer HTML in `meta.html` (capped at ~60KB).
- `course-note` — user notes inside a module (optional, not used yet).

## Server actions

- `tutorAsk({topic, history, forceFinish?})` — next wizard question or `{done:true}`.
- `generateOutline({topic, history})` — course outline + KB persistence.
- `buildModule({courseId, moduleId, moduleTitle, moduleObjective, topic})` — module material.
- `generateQuiz({moduleTitle, moduleObjective, article})` — quiz.
- `explainSelection({selection, context, topic, moduleTitle})` — deep explanation of a fragment.
- `generateTrainer({courseId, moduleId, moduleTitle, moduleObjective, prompt?})` — trainer HTML.
- `refreshCourseCard()` — dashboard card refresh (active course count + average progress).

## Permissions

`llm.chat/quick`, `kb.read/write` for its kinds, `fs.sandbox` (for future cache), `web.fetch` with whitelist (wikipedia, mdn, youtube, ...), `web.search`, `audit.write`, `workers.enabled`, `agent.invoke`.

## v0.1 limitations

- Images aren't downloaded locally (URLs from CC sources are used); their domains are in the whitelist.
- Mermaid diagrams are rendered as a code block; embed rendering is coming in v0.2.
- Trainers run in a `srcdoc` iframe — no access to host RPC (client-side JS+canvas only).
- Progress is stored in course frontmatter; mtime-based caching isn't optimized yet.
