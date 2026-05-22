// extensions/corrective-review/collector.ts

import type {
  ReadonlySessionManager,
} from "@earendil-works/pi-coding-agent";
import type {
  ToolResultMessage,
  TextContent,
  ImageContent,
} from "@earendil-works/pi-ai";

export interface ReviewInput {
  /** The original user prompt that started this cycle. */
  userPrompt: string;
  /** Tool call history: name and result summary for each call. */
  toolHistory: ToolCallRecord[];
  /** The agent's draft response text. */
  draftResponse: string;
}

export interface ToolCallRecord {
  /** Tool name (e.g., "bash", "read", "web_search"). */
  toolName: string;
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

/** Maximum characters of draft response to include. */
const MAX_DRAFT_LENGTH = 4000;

// ── Content extraction helpers ───────────────────────────────────────────

/**
 * Extract plain text from content that may be a string or an array
 * of TextContent / ImageContent blocks.
 */
function extractText(
  content: string | (TextContent | ImageContent)[],
): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c): c is TextContent => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }
  return "";
}

/**
 * Extract a summary string from a ToolResultMessage's content blocks.
 */
function extractToolResultSummary(result: ToolResultMessage): string {
  const text = extractText(result.content);
  return text.slice(0, MAX_RESULT_LENGTH) || "(empty output)";
}

// ── Main collector ───────────────────────────────────────────────────────

/**
 * Collect review inputs from the session at turn end.
 *
 * @param sessionManager - Read-only session manager to scan entries.
 * @param turnToolResults - ToolResultMessage[] from the TurnEndEvent.
 * @param draftResponseText - The assistant message text from the TurnEndEvent.
 */
export function collectReviewInput(
  sessionManager: ReadonlySessionManager,
  turnToolResults: ToolResultMessage[],
  draftResponseText: string,
): ReviewInput {
  // 1. Extract original user prompt from session entries.
  //    Walk backward from the most recent entries to find the last user message
  //    that is NOT a corrective-review steer.
  const entries = sessionManager.getEntries();
  let userPrompt = "";

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!entry) continue;

    // Skip corrective-review steer messages (CustomMessageEntry).
    if (
      entry.type === "custom_message" &&
      "customType" in entry &&
      entry.customType === "corrective-review"
    ) {
      continue;
    }

    // Look for a user message entry.
    if (entry.type === "message" && "message" in entry) {
      const msg = entry.message;
      if (msg.role === "user") {
        userPrompt = extractText(msg.content);
        break;
      }
    }
  }

  // 2. Build tool call history from turn results.
  const toolHistory: ToolCallRecord[] = turnToolResults.map((result) => ({
    toolName: result.toolName,
    resultSummary: extractToolResultSummary(result),
    isError: result.isError ?? false,
  }));

  return {
    userPrompt,
    toolHistory,
    draftResponse: draftResponseText.slice(0, MAX_DRAFT_LENGTH),
  };
}
