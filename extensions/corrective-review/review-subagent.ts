// extensions/corrective-review/review-subagent.ts

import type { CorrectiveReviewConfig } from "./config.ts";
import { buildReviewSystemPrompt } from "./review-prompt.ts";
import type { ReviewInput } from "./collector.ts";

/** Agent name registered for the corrective review subagent. */
export const REVIEW_AGENT_NAME = "corrective-reviewer";

/**
 * Build the subagent definition object for pi-subagents.
 * This is passed as the `config` parameter to subagent's create action.
 */
export function buildReviewAgentConfig(config: CorrectiveReviewConfig) {
  return {
    name: REVIEW_AGENT_NAME,
    description: "Corrective review subagent — reviews agent work for intent alignment, lazy shortcuts, and evidence support",
    systemPrompt: buildReviewSystemPrompt(config),
    systemPromptMode: "replace" as const,
    inheritProjectContext: false,
    inheritSkills: false,
    defaultContext: "fresh" as const,
    tools: "", // No tools — read-only reviewer
    thinking: "low" as const,
  };
}

/**
 * Build the review task string that the main agent will pass to the subagent tool.
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
 * Parse the review subagent's response to extract PASS/FAIL verdict.
 */
export function parseReviewVerdict(
  response: string,
): { verdict: "PASS" | "FAIL"; feedback: string } {
  const firstLine = response.trim().split("\n")[0] ?? "";
  const verdict = firstLine.toUpperCase().startsWith("PASS") ? "PASS" : "FAIL";
  const feedback = response.trim();
  return { verdict, feedback };
}
