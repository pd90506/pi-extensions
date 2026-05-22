// extensions/corrective-review/collector.ts

import type {
  ReadonlySessionManager,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";

export interface ReviewInput {
  /** The original user prompt that started this cycle. */
  userPrompt: string;
  /** Tool call history: name, args, and result summary for each call. */
  toolHistory: ToolCallRecord[];
  /** The agent's draft response text. */
  draftResponse: string;
}

export interface ToolCallRecord {
  toolName: string;
  args: Record<string, unknown>;
  /** First 2000 chars of result content. */
  resultSummary: string;
  /** Whether the result was an error. */
  isError: boolean;
}

/**
 * Maximum characters of tool output to include per call.
 * Keeps the review subagent's context manageable.
 */
const MAX_RESULT_LENGTH = 2000;

/**
 * Collect review inputs from the session at turn end.
 *
 * @param sessionManager - Read-only session manager to scan entries.
 * @param turnToolResults - Tool result messages from the current turn_end event.
 * @param draftResponse - The assistant message content from the current turn_end event.
 */
export function collectReviewInput(
  sessionManager: ReadonlySessionManager,
  turnToolResults: Array<{
    role: "toolResult";
    toolCallId: string;
    content: string;
    isError?: boolean;
    details?: { command?: string };
  }>,
  draftResponse: string,
): ReviewInput {
  // 1. Extract original user prompt from session entries.
  //    Walk backward from the most recent entries to find the last user message
  //    that is NOT a corrective-review steer.
  const entries = sessionManager.getEntries();
  let userPrompt = "";

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!entry) continue;
    if (
      entry.role === "user" &&
      typeof entry.content === "string" &&
      !entry.content.includes("[CORRECTIVE-REVIEW]")
    ) {
      userPrompt = entry.content;
      break;
    }
  }

  // 2. Build tool call history from turn results.
  const toolHistory: ToolCallRecord[] = turnToolResults.map((result) => {
    const summary =
      typeof result.content === "string"
        ? result.content.slice(0, MAX_RESULT_LENGTH)
        : JSON.stringify(result.content).slice(0, MAX_RESULT_LENGTH);

    return {
      toolName: result.details?.command
        ? `bash: ${result.details.command}`
        : "unknown",
      args: {},
      resultSummary: summary || "(empty output)",
      isError: result.isError ?? false,
    };
  });

  return {
    userPrompt,
    toolHistory,
    draftResponse: draftResponse.slice(0, 4000),
  };
}
