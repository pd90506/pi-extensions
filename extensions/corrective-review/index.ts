// extensions/corrective-review/index.ts
//
// Corrective Review Extension
// Spawns a corrective review subagent once per prompt cycle at turn_end.
// Evaluates tool call history + draft response across 3 dimensions.
// On FAIL, injects feedback as a steer to trigger re-tooling.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { DEFAULT_CONFIG, type CorrectiveReviewConfig } from "./config.ts";
import { collectReviewInput } from "./collector.ts";
import {
  buildReviewAgentConfig,
  buildReviewTask,
  REVIEW_AGENT_NAME,
} from "./review-subagent.ts";

export default function (pi: ExtensionAPI) {
  const config: CorrectiveReviewConfig = { ...DEFAULT_CONFIG };

  // ── Track review cycles per user prompt to enforce max_review_cycles ──

  /** Number of review steers injected for the current user prompt. */
  let reviewCycleCount = 0;
  /** Whether the review subagent has been registered this session. */
  let agentRegistered = false;

  // ── Subagent availability check ──────────────────────────────────────

  function checkSubagentAvailable(): boolean {
    return pi.getAllTools().some((t) => t.name === "subagent");
  }

  // ── Extract assistant message text ───────────────────────────────────

  function getAssistantText(message: {
    role: string;
    content: string | Array<{ type: string; text?: string }>;
  }): string {
    if (typeof message.content === "string") return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");
    }
    return "";
  }

  // ── Session lifecycle ────────────────────────────────────────────────

  pi.on("session_start", (_event, ctx) => {
    reviewCycleCount = 0;
    agentRegistered = false;

    if (!checkSubagentAvailable()) {
      ctx.ui.notify(
        "corrective-review: pi-subagents required. Install: pi install npm:pi-subagents",
        "warning",
      );
      return;
    }

    ctx.ui.notify("Corrective Review active · max 2 cycles", "info");
  });

  // ── Reset cycle count on new user input ──────────────────────────────

  pi.on("input", (_event, _ctx) => {
    reviewCycleCount = 0;
  });

  // ── Review gate at turn_end ──────────────────────────────────────────

  pi.on("turn_end", (event, ctx) => {
    // Skip if subagent tool not available
    if (!checkSubagentAvailable()) return;

    // Skip if no tool calls were made (conversational turns don't need review)
    if (event.toolResults.length === 0) return;

    // Skip if we've hit max review cycles for this prompt
    if (reviewCycleCount >= config.maxReviewCycles) {
      reviewCycleCount = 0;
      return;
    }

    // Extract draft response text from the assistant message
    const draftResponse = getAssistantText(event.message);

    // Collect review inputs from session state + current turn
    const reviewInput = collectReviewInput(
      ctx.sessionManager,
      event.toolResults as ToolResultMessage[],
      draftResponse,
    );

    // Increment cycle count
    reviewCycleCount++;

    // Register the review agent on first use (do this before sending the review steer)
    if (!agentRegistered) {
      const agentConfig = buildReviewAgentConfig(config);
      const createPayload = JSON.stringify({
        action: "create",
        config: agentConfig,
      });
      pi.sendMessage(
        {
          customType: "corrective-review-setup",
          content: `[CORRECTIVE-REVIEW] Register agent: ${createPayload}`,
          display: false,
        },
        { deliverAs: "steer" },
      );
      agentRegistered = true;
    }

    // Build review task
    const reviewTask = buildReviewTask(reviewInput);

    // Build the subagent invocation payload
    const subagentPayload = JSON.stringify({
      agent: REVIEW_AGENT_NAME,
      task: reviewTask,
    });

    // Inject review as a steer message.
    // The agent will call the subagent tool, parse the result, and decide PASS/FAIL.
    pi.sendMessage(
      {
        customType: "corrective-review",
        content:
          `[CORRECTIVE-REVIEW cycle ${reviewCycleCount}/${config.maxReviewCycles}]\n\n` +
          `You MUST call the subagent tool with exactly this payload:\n${subagentPayload}\n\n` +
          `The review subagent returns PASS or FAIL on the first line.\n` +
          `- If PASS: respond with a brief confirmation (e.g., "✅ Review passed") and then provide your original response to the user.\n` +
          `- If FAIL: read the feedback, go back to tool calling to fix the issues, then draft a new response. Do NOT respond to the user yet until issues are fixed.\n\n` +
          (reviewCycleCount >= config.maxReviewCycles
            ? "This is the final review cycle. Respond to the user regardless of the verdict."
            : `This is review cycle ${reviewCycleCount}/${config.maxReviewCycles}. Do not respond to the user until review passes.`),
        display: false,
      },
      { deliverAs: "steer" },
    );
  });

  // ── Cleanup ──────────────────────────────────────────────────────────

  pi.on("session_shutdown", () => {
    reviewCycleCount = 0;
    agentRegistered = false;
  });
}
