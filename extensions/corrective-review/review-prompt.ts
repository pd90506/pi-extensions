// extensions/corrective-review/review-prompt.ts
//
// Builds the system prompt and review task for the corrective review subprocess.
// The review runs as a standalone pi -p process (no skills, no extensions, no tools).

import type { CorrectiveReviewConfig } from "./config.ts";
import type { ReviewInput, ToolCallRecord } from "./collector.ts";

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
function formatToolCalls(calls: ToolCallRecord[], prefix: string): string {
  return calls
    .map(
      (call, i) =>
        `${prefix}[${i + 1}] ${call.toolName}\n    Result: ${call.resultSummary}${call.isError ? " (ERROR)" : ""}`,
    )
    .join("\n\n");
}

export function buildReviewTask(input: ReviewInput): string {
  const parts: string[] = [];

  // Previous rounds (most recent first in the array, but displayed oldest → newest)
  if (input.previousRounds && input.previousRounds.length > 0) {
    const reversed = [...input.previousRounds].reverse();
    for (let i = 0; i < reversed.length; i++) {
      const round = reversed[i];
      parts.push(
        `## Previous Round ${i + 1} (User Prompt)
${round.prompt || "(not found)"}

### Tool Calls (Round ${i + 1})
${formatToolCalls(round.toolCalls, "  ") || "(no tool calls)"}`,
      );
    }
    parts.push("---");
  }

  // Current round
  const currentToolCalls = formatToolCalls(input.toolHistory, "");
  parts.push(
    `## Current Round (User Prompt)
${input.userPrompt || "(not found)"}

## Tool Call History
${currentToolCalls || "(no tool calls)"}

## Draft Response
${input.draftResponse}`,
  );

  parts.push("\nRespond with PASS or FAIL on the first line, followed by your reasoning.");
  return parts.join("\n\n");
}

// ANSI escape code regex: strips color codes, cursor movement, etc.
const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;

/**
 * Parse the review subprocess stdout to extract PASS/FAIL verdict.
 *
 * Handles:
 * - Plain PASS / FAIL
 * - Markdown formatting: **PASS**, *FAIL*, ## PASS, FAIL:
 * - ANSI escape codes (terminal color output)
 * - Leading/trailing whitespace and empty lines
 * - Empty output (defaults to FAIL)
 */
export function parseReviewVerdict(
  response: string,
): { verdict: "PASS" | "FAIL"; feedback: string } {
  // Strip ANSI escape codes first (color codes from terminal output)
  const clean = response.replace(ANSI_REGEX, "");

  // Find the first non-empty line
  const lines = clean.split("\n");
  let firstLine = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      firstLine = trimmed;
      break;
    }
  }

  // All empty → fail closed with placeholder feedback
  if (firstLine === "") {
    return { verdict: "FAIL", feedback: "(empty review output)" };
  }

  // Strip markdown formatting: **, *, _, #, whitespace, trailing colons
  firstLine = firstLine
    .replace(/^[*_#\s]+/, "")
    .replace(/[*_\s:]+$/, "")
    .trim();

  const verdict = firstLine.toUpperCase().startsWith("PASS") ? "PASS" : "FAIL";
  const feedback = clean.trim();
  return { verdict, feedback };
}
