import { reflex } from "@host/api";
import { extractJson } from "./_json";

/**
 * Wizard step. Given the topic + prior Q&A, the agent decides whether
 * it needs more context or has enough to design a course. Returns
 * either the next question (open-ended or multiple-choice) or
 * `{done:true}` so the UI advances to outline generation.
 *
 * Keeping the wizard agent-driven means we don't hardcode "3 questions
 * about level/focus/format" — for "I want to learn pencil drawing"
 * the agent will ask different questions than for "I want to learn
 * Python". The UI just renders whatever comes back.
 */

export interface TutorQA {
  question: string;
  answer: string;
}

export interface TutorAskArgs {
  topic: string;
  history: TutorQA[];
  /** Force-finish even if the agent wants more. UI uses this when the
   *  user clicks "Enough questions — build the course already". */
  forceFinish?: boolean;
}

export interface TutorAskResult {
  done: boolean;
  /** Free-form question; UI renders a textarea. */
  question?: string;
  /** Optional pre-baked choices for a multiple-choice ask. */
  choices?: string[];
  /** Hint to UI: short label like "level", "format", "goal". */
  header?: string;
}

const MAX_TURNS = 5;

export default async function tutorAsk(
  args: TutorAskArgs,
): Promise<TutorAskResult> {
  const turns = args.history.length;
  if (args.forceFinish || turns >= MAX_TURNS) {
    return { done: true };
  }

  const prior = args.history
    .map((qa, i) => `Q${i + 1}: ${qa.question}\nA${i + 1}: ${qa.answer}`)
    .join("\n\n");

  const prompt = [
    "You are a tutor who is about to design a personalised course for the user.",
    `Topic: "${args.topic}".`,
    "You need to gather the minimum information required to choose a good program: level, goal, time budget, format, specifics.",
    "Ask ONE question at a time. Decide what to ask yourself — whatever is most important right now given the topic and prior answers.",
    "If it makes sense to offer answer options — add up to 5 short choices.",
    "If you already know enough (usually after 2-4 questions) — return done=true.",
    "Reply with JSON ONLY on a single line, no markdown:",
    `  {"done":false,"question":"...","header":"level|goal|time|format|...","choices":["...","..."]}`,
    "  or",
    `  {"done":true}`,
    "",
    prior ? `## Previous answers\n${prior}` : "## This is the first question",
    `\nQuestions asked so far: ${turns} (maximum ${MAX_TURNS}).`,
  ].join("\n");

  const r = await reflex.llm.complete({ task: "quick", prompt });
  const parsed = extractJson<TutorAskResult>(r.text);
  if (!parsed) return { done: true };
  try {
    if (parsed.done) return { done: true };
    if (typeof parsed.question !== "string" || !parsed.question.trim()) {
      return { done: true };
    }
    return {
      done: false,
      question: parsed.question.trim(),
      ...(parsed.header ? { header: parsed.header } : {}),
      ...(Array.isArray(parsed.choices) && parsed.choices.length > 0
        ? {
            choices: parsed.choices
              .map((c) => String(c).trim())
              .filter(Boolean)
              .slice(0, 5),
          }
        : {}),
    };
  } catch {
    return { done: true };
  }
}
