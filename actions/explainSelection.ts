import { reflex } from "@host/api";

/**
 * "Explain this" feature: user highlights a snippet inside the module
 * article and asks for a deeper explanation. The agent gets the
 * surrounding paragraph as context so it understands what "this" means.
 *
 * Two modes:
 *   1. Default — `question` omitted, agent gives a generic 2-5 paragraph
 *      breakdown of the selected fragment.
 *   2. Custom — `question` supplied (book-style margin annotation), agent
 *      answers that specific question with the selection as the focal
 *      point. Lets the reader say things like "what does N have to do
 *      with this?" or "give me an example" instead of always getting the
 *      same boilerplate.
 */

export interface ExplainSelectionArgs {
  selection: string;
  /** ~400-1000 chars around the selection for context. */
  context: string;
  topic: string;
  moduleTitle: string;
  /** Optional user question about the selection. */
  question?: string;
}

export default async function explainSelection(
  args: ExplainSelectionArgs,
): Promise<{ text: string }> {
  const userQuestion = (args.question ?? "").trim();
  const promptLines: string[] = [
    `Course: "${args.topic}". Module: "${args.moduleTitle}".`,
  ];

  if (userQuestion) {
    promptLines.push(
      "The user highlighted a fragment and asked a specific question about that fragment.",
      "Answer exactly their question, grounded in the selection + surrounding context. 2-4 paragraphs, no fluff, to the point.",
      "Markdown without headings; short sentences, with an example when appropriate.",
    );
  } else {
    promptLines.push(
      "The user highlighted a fragment and is asking for a deeper explanation.",
      "Give a thorough explanation in 2-5 paragraphs: what it means, how it works,",
      "why it works that way, with a concrete example. No fluff. Markdown without headings.",
    );
  }

  promptLines.push(
    "",
    `## Surrounding context\n${args.context.slice(0, 1500)}`,
    "",
    `## User selection\n"${args.selection.slice(0, 800)}"`,
  );
  if (userQuestion) {
    promptLines.push("", `## User question\n${userQuestion.slice(0, 600)}`);
  }

  const r = await reflex.llm.complete({
    task: "quick",
    prompt: promptLines.join("\n"),
  });
  return { text: (r.text ?? "").trim() };
}
