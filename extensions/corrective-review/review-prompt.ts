// extensions/corrective-review/review-prompt.ts
//
// Builds the system prompt and review task for the corrective review subprocess.
// The review runs as a standalone pi -p process (no skills, no extensions, no tools).

import type { CorrectiveReviewConfig } from "./config.ts";
import type { ReviewInput } from "./collector.ts";

/**
 * Build the system prompt that defines the reviewer's role and evaluation criteria.
 * This is the first part of the prompt passed to the review subprocess.
 */
export function buildReviewSystemPrompt(config: CorrectiveReviewConfig): string {
  const dimensions: string[] = [];

  if (config.intentAlignment) {
    dimensions.push(`### 1. Intent Alignment (🎯)
- Does the tool call chain serve the user's original intent?
- Are there causal chain breaks (agent drifted to unrelated tasks)?
- Is the tool choice appropriate for the intent? (e.g., web_search vs local grep)`);
  }

  if (config.lazyShortcuts) {
    dimensions.push(`### ${dimensions.length + 1}. Lazy Shortcuts (🏃)
- Did the agent give up too early?
- Were all reasonable paths attempted before concluding "not found"?
- Did the agent try only one source and declare a conclusion?`);
  }

  if (config.evidenceSupport) {
    dimensions.push(`### ${dimensions.length + 1}. Evidence Support (🧾)
- Are factual claims in the draft response backed by tool output?
- Is claim scope consistent with evidence scope? ("not found anywhere" vs "not found locally")
- Are there unverified assertions presented as facts?`);
  }

  const dimSection = dimensions.join("\n\n");

  return `You are a corrective reviewer. Your job is to review an agent's work and flag quality issues.

You receive:
- 🎯 The original user prompt
- 📊 Full tool call history (commands + outputs)
- 📝 The agent's draft response

Evaluate across these dimensions:

${dimSection}

## Output Format

Respond with EXACTLY one of these two words on the first line, followed by an explanation:

**PASS** — All dimensions check out. The agent's work is solid.
**FAIL** — One or more dimensions have issues. Explain which and suggest what to do.

## Rules

- You are READ-ONLY. Do not call tools. Only review what you see.
- Do not judge business logic correctness. Only process quality.
- Do not generate user-visible output outside this review.
- Be specific: cite tool call numbers and exact issues.
- A FAIL is serious. Only fail when there is clear evidence of a problem.`;
}

/**
 * Build the review task string with the collected review inputs.
 * This is the second part of the prompt passed to the review subprocess.
 */
export function buildReviewTask(input: ReviewInput): string {
  const toolHistoryStr = input.toolHistory
    .map(
      (call, i) =>
        `[${i + 1}] ${call.toolName}\n    Result: ${call.resultSummary}${call.isError ? " (ERROR)" : ""}`,
    )
    .join("\n\n");

  return `Review this agent's work:

## Original User Prompt
${input.userPrompt || "(not found)"}

## Tool Call History
${toolHistoryStr || "(no tool calls)"}

## Draft Response
${input.draftResponse}

Respond with PASS or FAIL on the first line, followed by your reasoning.`;
}

/**
 * Parse the review subprocess stdout to extract PASS/FAIL verdict.
 */
export function parseReviewVerdict(
  response: string,
): { verdict: "PASS" | "FAIL"; feedback: string } {
  const firstLine = response.trim().split("\n")[0] ?? "";
  const verdict = firstLine.toUpperCase().startsWith("PASS") ? "PASS" : "FAIL";
  const feedback = response.trim();
  return { verdict, feedback };
}
