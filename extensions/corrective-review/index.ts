// extensions/corrective-review/index.ts
//
// Corrective Review Extension — Pre-Response Gate (v3)
//
// Intercepts final assistant messages at message_end, BEFORE they render to
// the user. Spawns a standalone pi -p subprocess to review the agent's work
// across 3 dimensions: Intent Alignment, Lazy Shortcuts, Evidence Support.
// On FAIL, replaces the message and injects a steer to trigger re-tooling.
//
// Equivalent to Claude Code's "Stop" hook pattern and Codex CLI's Stop event.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ToolCallRecord, ReviewInput } from "./collector.ts";
import { extractText } from "./collector.ts";
import { DEFAULT_CONFIG, type CorrectiveReviewConfig } from "./config.ts";
import {
  buildReviewSystemPrompt,
  buildReviewTask,
  parseReviewVerdict,
} from "./review-prompt.ts";

const MAX_RESULT_LENGTH = 2000;
const MAX_DRAFT_LENGTH = 4000;

export default function (pi: ExtensionAPI) {
  const config: CorrectiveReviewConfig = { ...DEFAULT_CONFIG };

  // ── Per-prompt-cycle state ───────────────────────────────────────────

  let reviewCycleCount = 0;
  let toolCalls: ToolCallRecord[] = [];
  let userPrompt = "";

  // Sliding window: previous prompt cycles (oldest first)
  // Each entry holds that cycle's user prompt and tool calls.
  // Trimmed to config.reviewWindow - 1 (current cycle is separate).
  let promptHistory: { prompt: string; toolCalls: ToolCallRecord[] }[] = [];

  // ── Session lifecycle ────────────────────────────────────────────────

  pi.on("session_start", (_event, ctx) => {
    reviewCycleCount = 0;
    toolCalls = [];
    userPrompt = "";
    promptHistory = [];
    ctx.ui.notify(
      `Corrective Review active · max ${config.maxReviewCycles} cycle(s) · ${config.reviewWindow}-round window`,
      "info",
    );
  });

  // ── Reset on new user input ──────────────────────────────────────────

  pi.on("input", (event, _ctx) => {
    if (event.source === "interactive") {
      // Save current cycle to sliding window before starting new one
      if (userPrompt && toolCalls.length > 0) {
        promptHistory.push({ prompt: userPrompt, toolCalls: [...toolCalls] });
        // Keep only last N-1 (current cycle is separate)
        const maxHistory = Math.max(1, config.reviewWindow - 1);
        if (promptHistory.length > maxHistory) {
          promptHistory = promptHistory.slice(-maxHistory);
        }
      }
      userPrompt = event.text;
      toolCalls = [];
      reviewCycleCount = 0;
    }
  });

  // ── Collect tool results during the prompt cycle ─────────────────────

  pi.on("tool_result", (event, _ctx) => {
    const text = extractText(event.content);
    toolCalls.push({
      toolName: event.toolName,
      resultSummary: text.slice(0, MAX_RESULT_LENGTH) || "(empty output)",
      isError: event.isError,
    });
  });

  // ── Run review as standalone pi subprocess ───────────────────────────

  async function runReviewSubprocess(
    reviewInput: ReviewInput,
    model: string,
  ): Promise<{ verdict: "PASS" | "FAIL"; feedback: string } | null> {
    const systemPrompt = buildReviewSystemPrompt(config);
    const reviewTask = buildReviewTask(reviewInput);
    const fullPrompt = `${systemPrompt}\n\n---\n\n${reviewTask}`;

    const taskFile = path.join(os.tmpdir(), `corrective-review-${Date.now()}.txt`);
    const sessionDir = path.join(os.tmpdir(), "corrective-review-sessions");
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(taskFile, fullPrompt);

    try {
      const result = await pi.exec("pi", [
        "-p", "--no-extensions", "--no-skills",
        "--session-dir", sessionDir,
        "--model", model,
        `@${taskFile}`,
      ], { timeout: 60_000 });

      // Fail-open: if subprocess failed or produced no output,
      // skip the review rather than injecting meaningless feedback.
      if (result.code !== 0 || !result.stdout.trim()) {
        return null;
      }

      return parseReviewVerdict(result.stdout);
    } finally {
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
        display: true,
      },
      { deliverAs: "steer" },
    );
  }

  // ── Pre-response review gate at message_end ──────────────────────────

  pi.on("message_end", async (event, ctx) => {
    // Only review final assistant messages (no tool_calls → response to user)
    if (event.message.role !== "assistant") return;

    const content = event.message.content;
    const hasToolCalls =
      Array.isArray(content) &&
      (content as Array<{ type: string }>).some((c) => c.type === "toolCall");
    if (hasToolCalls) return;

    // Skip if no tools were used in this prompt cycle
    if (toolCalls.length === 0) return;

    // Skip if max review cycles reached
    if (reviewCycleCount >= config.maxReviewCycles) {
      reviewCycleCount = 0;
      return;
    }

    reviewCycleCount++;

    // Show review-in-progress status
    ctx.ui.setStatus(
      "corrective-review",
      `🔍 Reviewing (${reviewCycleCount}/${config.maxReviewCycles})…`,
    );

    try {
      const reviewInput: ReviewInput = {
        userPrompt,
        toolHistory: toolCalls,
        draftResponse: extractText(event.message.content).slice(
          0,
          MAX_DRAFT_LENGTH,
        ),
        previousRounds:
          promptHistory.length > 0
            ? promptHistory.map((h) => ({
                prompt: h.prompt,
                toolCalls: h.toolCalls,
              }))
            : undefined,
      };

      const model =
        config.reviewModel ?? ctx.model?.id ?? "deepseek/deepseek-v4-pro";
      const result = await runReviewSubprocess(reviewInput, model);

      ctx.ui.setStatus("corrective-review", undefined);

      // Subprocess failed or returned empty → skip review, let response through
      if (result === null) {
        ctx.ui.notify(
          "corrective-review: review subprocess failed, response passed through",
          "warning",
        );
        return;
      }

      const { verdict, feedback } = result;

      ctx.ui.setStatus("corrective-review", undefined);
      ctx.ui.notify(
        `Review ${
          verdict === "PASS" ? "✅ PASS" : "❌ FAIL"
        } · cycle ${reviewCycleCount}/${config.maxReviewCycles}`,
        verdict === "PASS" ? "info" : "warning",
      );

      if (verdict === "FAIL") {
        injectFeedback(feedback);
        // Append review feedback to original message instead of replacing it.
        // Keeps history complete and shows why review failed.
        const original = event.message;
        const originalContent = Array.isArray(original.content)
          ? original.content
          : [{ type: "text" as const, text: extractText(original.content) }];
        return {
          message: {
            role: "assistant",
            content: [
              ...originalContent,
              {
                type: "text" as const,
                text: `\n\n---\n[CORRECTIVE-REVIEW FAIL cycle ${reviewCycleCount}/${config.maxReviewCycles}]\n\n${feedback}\n\nFix the issues above and re-draft your response. Do NOT respond to the user yet.`,
              },
            ],
            // Preserve original usage; fall back to zero usage to avoid FooterComponent crash.
            usage: (original as any).usage ?? {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              cost: { total: 0 },
            },
          },
        };
      }
      // PASS: return undefined → original message renders to user
    } catch (err) {
      try {
        ctx.ui.setStatus("corrective-review", undefined);
      } catch {
        /* ignore */
      }
      ctx.ui.notify(
        `corrective-review: review skipped due to error: ${
          err instanceof Error ? err.message : String(err)
        }`,
        "warning",
      );
    }
  });

  // ── Cleanup ──────────────────────────────────────────────────────────

  pi.on("session_shutdown", () => {
    reviewCycleCount = 0;
    toolCalls = [];
    userPrompt = "";
  });
}
