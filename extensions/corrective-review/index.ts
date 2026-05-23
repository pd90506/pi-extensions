// extensions/corrective-review/index.ts
//
// Corrective Review Extension
// Spawns a corrective review subagent once per prompt cycle at agent_end.
// Evaluates tool call history + draft response across 3 dimensions.
// On FAIL, injects feedback as a steer to trigger re-tooling.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG, type CorrectiveReviewConfig } from "./config.ts";
import { extractReviewFromAgentEnd } from "./collector.ts";
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

  pi.on("input", (event, _ctx) => {
    // Only reset on actual user input, not on steer delivery or other events
    if (event.source === "interactive") {
      reviewCycleCount = 0;
    }
  });

  // ── Send a review steer to register the subagent ─────────────────────

  function sendRegistrationSteer(): void {
    const agentConfig = buildReviewAgentConfig(config);
    const createPayload = JSON.stringify({
      action: "create",
      config: agentConfig,
    });
    pi.sendMessage(
      {
        customType: "corrective-review",
        content:
          `[CORRECTIVE-REVIEW] You MUST call the subagent tool with exactly this payload to register the corrective-reviewer agent:\n${createPayload}`,
        display: false,
      },
      { deliverAs: "steer" },
    );
  }

  // ── Send a review steer with the collected review task ───────────────

  function sendReviewSteer(reviewTask: string): void {
    const subagentPayload = JSON.stringify({
      agent: REVIEW_AGENT_NAME,
      task: reviewTask,
    });

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
  }

  // ── Review gate at agent_end ───────────────────────────────────────

  pi.on("agent_end", (event, ctx) => {
    try {
      // Skip if subagent tool not available
      if (!checkSubagentAvailable()) return;

      // Extract review inputs from all messages in this prompt cycle.
      // agent_end fires once per prompt (vs turn_end which fires every turn),
      // so only one review steer is injected at the end of all tool calling.
      const reviewInput = extractReviewFromAgentEnd(event.messages);

      // Skip if no tool calls were made (conversational turns don't need review)
      if (reviewInput.toolHistory.length === 0) return;

      // Skip if we've hit max review cycles for this prompt
      if (reviewCycleCount >= config.maxReviewCycles) {
        reviewCycleCount = 0;
        return;
      }

      // Increment cycle count
      reviewCycleCount++;

      // Register the review agent on first use
      if (!agentRegistered) {
        sendRegistrationSteer();
        agentRegistered = true;
      }

      // Build review task and inject review steer
      const reviewTask = buildReviewTask(reviewInput);
      sendReviewSteer(reviewTask);
    } catch (err) {
      // Fail closed: silently skip review on errors to avoid breaking the session.
      // The agent's response goes through unreviewed.
      ctx.ui.notify(
        `corrective-review: review skipped due to error: ${err instanceof Error ? err.message : String(err)}`,
        "warning",
      );
    }
  });

  // ── Cleanup ──────────────────────────────────────────────────────────

  pi.on("session_shutdown", () => {
    reviewCycleCount = 0;
    agentRegistered = false;
  });
}
