// extensions/corrective-review/index.ts
//
// Corrective Review Extension
// Spawns a standalone pi -p subprocess at agent_end to review the agent's work.
// Evaluates tool call history + draft response across 3 dimensions.
// On FAIL, injects feedback as a steer to trigger re-tooling.
//
// Unlike the previous steer-based approach (which relied on the agent calling
// the subagent tool — and could be silently ignored), this extension runs the
// review as an independent pi process via pi.exec(). The review verdict is
// parsed directly by the extension, which then injects feedback only on FAIL.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG, type CorrectiveReviewConfig } from "./config.ts";
import { extractReviewFromAgentEnd } from "./collector.ts";
import {
  buildReviewSystemPrompt,
  buildReviewTask,
  parseReviewVerdict,
} from "./review-prompt.ts";

export default function (pi: ExtensionAPI) {
  const config: CorrectiveReviewConfig = { ...DEFAULT_CONFIG };

  // ── Track review cycles per user prompt to enforce max_review_cycles ──

  /** Number of review steers injected for the current user prompt. */
  let reviewCycleCount = 0;

  // ── Session lifecycle ────────────────────────────────────────────────

  pi.on("session_start", (_event, ctx) => {
    reviewCycleCount = 0;
    ctx.ui.notify("Corrective Review active · max 2 cycles (subprocess)", "info");
  });

  // ── Reset cycle count on new user input ──────────────────────────────

  pi.on("input", (event, _ctx) => {
    if (event.source === "interactive") {
      reviewCycleCount = 0;
    }
  });

  // ── Run the review as a standalone pi subprocess ─────────────────────

  async function runReviewSubprocess(
    reviewInput: ReturnType<typeof extractReviewFromAgentEnd>,
    model: string,
  ): Promise<{ verdict: "PASS" | "FAIL"; feedback: string }> {
    // Build full prompt: system prompt + separator + review task
    const systemPrompt = buildReviewSystemPrompt(config);
    const reviewTask = buildReviewTask(reviewInput);
    const fullPrompt = `${systemPrompt}\n\n---\n\n${reviewTask}`;

    // Write to temp file to avoid shell escaping issues
    const taskFile = path.join(
      os.tmpdir(),
      `corrective-review-${Date.now()}.txt`,
    );
    fs.writeFileSync(taskFile, fullPrompt);

    try {
      const result = await pi.exec("pi", [
        "-p",
        "--no-extensions",
        "--no-skills",
        "--model", model,
        `@${taskFile}`,
      ], { timeout: 60_000 });

      return parseReviewVerdict(result.stdout);
    } finally {
      // Clean up temp file
      try { fs.unlinkSync(taskFile); } catch { /* ignore */ }
    }
  }

  // ── Inject feedback as a steer on FAIL ───────────────────────────────

  function injectFeedback(feedback: string): void {
    pi.sendMessage(
      {
        customType: "corrective-review-feedback",
        content:
          `[CORRECTIVE-REVIEW FAIL cycle ${reviewCycleCount}/${config.maxReviewCycles}]\n\n${feedback}\n\n` +
          `Fix the issues above and re-draft your response. Do NOT respond to the user yet.`,
        display: false,
      },
      { deliverAs: "steer" },
    );
  }

  // ── Review gate at agent_end ───────────────────────────────────────

  pi.on("agent_end", async (event, ctx) => {
    try {
      // Extract review inputs from all messages in this prompt cycle.
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

      // Determine model: explicit override → current session model → fallback
      const model =
        config.reviewModel ??
        ctx.model?.id ??
        "deepseek/deepseek-v4-pro";

      // Run the review subprocess
      const { verdict, feedback } = await runReviewSubprocess(reviewInput, model);

      if (verdict === "FAIL") {
        injectFeedback(feedback);
      }
      // On PASS: do nothing — the agent's response goes to the user as-is.
    } catch (err) {
      // Fail closed: silently skip review on errors to avoid breaking the session.
      ctx.ui.notify(
        `corrective-review: review skipped due to error: ${err instanceof Error ? err.message : String(err)}`,
        "warning",
      );
    }
  });

  // ── Cleanup ──────────────────────────────────────────────────────────

  pi.on("session_shutdown", () => {
    reviewCycleCount = 0;
  });
}
