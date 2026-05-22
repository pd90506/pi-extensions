/**
 * Ralph Loop — Pi Extension
 *
 * Implements the Ralph Wiggum technique as a Pi extension:
 * - /ralph-loop plan|build "task" [--completion-promise ...] [--max-iterations N]
 * - /cancel-ralph
 *
 * The extension creates on-disk state and sends an orchestration prompt.
 * The parent agent then dispatches fresh-context subagents (with ralph-loop skill
 * injected) in a loop, checking structured results from .pi/ralph-result.json.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";

// ── Helpers ──────────────────────────────────────────────────────────────

function readTemplate(name: string): string {
  try {
    return fs.readFileSync(
      path.join(__dirname, "..", "prompts", name),
      "utf8",
    );
  } catch {
    return "";
  }
}

function resolveDefaultPromptsDir(): string {
  // Resolve ralph-loop package root from this extension file.
  const extDir = typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(extDir, "..", "prompts");
}

// ── State File ────────────────────────────────────────────────────────────

interface RalphLoopState {
  mode: "plan" | "build";
  prompt: string;
  completion_promise: string | null;
  max_iterations: number;
  iteration: number;
  status: "running" | "done" | "cancelled";
  session_id: string;
}

function writeStateFile(cwd: string, state: RalphLoopState): void {
  fs.writeFileSync(
    path.join(cwd, ".pi", "ralph-loop.json"),
    JSON.stringify(state, null, 2),
  );
}

// ── Prompt Templates ──────────────────────────────────────────────────────

function buildPlanPrompt(task: string): string {
  return `## PLANNING Mode

Read the plan prompt template from ${resolveDefaultPromptsDir()}/ralph-plan.md, then execute it.

Your task: ${task}

IMPORTANT: You are in PLANNING mode. Do NOT write implementation code.
Only produce IMPLEMENTATION_PLAN.md and .pi/ralph-result.json.`;
}

function buildBuildPrompt(
  task: string,
  completionPromise: string | null,
): string {
  const promiseLine = completionPromise
    ? `\nCompletion promise: ${completionPromise}`
    : "";

  return `## BUILDING Mode — Iteration {{iteration}}

Read the build prompt template from ${resolveDefaultPromptsDir()}/ralph-build.md, then execute one iteration.

Your task: ${task}${promiseLine}

Follow the BUILDING mode workflow:
1. Orient — read IMPLEMENTATION_PLAN.md, pick the most important unchecked task
2. Investigate — search codebase, don't assume not implemented
3. Implement — full implementation, no placeholders
4. Backpressure — tests, lint, build must pass
5. Update IMPLEMENTATION_PLAN.md
6. Commit
7. Write .pi/ralph-result.json

Remember: ONE bounded task per iteration. Write .pi/ralph-result.json with the correct "done" status.`;
}

function buildOrchestrationPrompt(
  mode: "plan" | "build",
  task: string,
  completionPromise: string | null,
  maxIterations: number,
): string {
  const promptsDir = resolveDefaultPromptsDir();

  if (mode === "plan") {
    return `## Ralph Loop — PLANNING Mode

I've set up a Ralph Loop for you. Here's what to do:

1. Read the state file at .pi/ralph-loop.json to understand the task.
2. Read the planning prompt template at ${promptsDir}/ralph-plan.md for detailed instructions.
3. Dispatch ONE planning subagent using the subagent tool:

\`\`\`
subagent({
  agent: "worker",
  context: "fresh",
  skill: "ralph-loop",
  task: \`${buildPlanPrompt(task)}\`,
  outputMode: "file-only"
})
\`\`\`

4. After the subagent completes, read .pi/ralph-result.json.
5. Report the result to the user.
6. If the user wants to loop again for further planning, they can re-run /ralph-loop plan.`;
  }

  // BUILDING mode — full loop prompt
  return `## Ralph Loop — BUILDING Mode (Iteration 1 of ${maxIterations === 0 ? "unlimited" : maxIterations})

I've set up a Ralph Loop for you. Your job: **orchestrate the loop using subagents**.

### Setup

The state file at .pi/ralph-loop.json contains:
- Task: "${task}"
- Completion promise: ${completionPromise || "(none — runs until max iterations or plan exhausted)"}
- Max iterations: ${maxIterations === 0 ? "unlimited" : maxIterations}

### Loop Contract

You are the orchestrator. Follow this loop until completion:

\`\`\`
while true:
  1. Read .pi/ralph-loop.json to get current iteration number
  2. Read the build prompt template at ${promptsDir}/ralph-build.md for workflow details
  3. Dispatch a fresh-context subagent:

     subagent({
       agent: "worker",
       context: "fresh",
       skill: "ralph-loop",
       task: \`${buildBuildPrompt(task, completionPromise)}\`,
       outputMode: "file-only"
     })

  4. Read .pi/ralph-result.json
  5. If result.done === true → Report completion and STOP the loop
  6. If iteration >= max_iterations → Report max reached and STOP
  7. Increment iteration in .pi/ralph-loop.json (use edit tool)
  8. Continue loop
\`\`\`

### Critical Rules

- Each subagent gets **fresh context** — they only see files on disk
- Use **outputMode: "file-only"** on every subagent call to prevent context bloat
- The subagent writes .pi/ralph-result.json — you read it to decide whether to continue
- **Do not stop the loop early.** Only stop when done=true or max iterations reached
- Report progress to the user after every 5 iterations or after completion

### Start Now

Read .pi/ralph-loop.json to begin the first iteration.`;
}

// ── Extension ─────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── /ralph-loop ─────────────────────────────────────────────────────────

  pi.registerCommand("ralph-loop", {
    description: "Start a Ralph Loop (plan or build mode)",
    async handler(args, ctx) {
      await ctx.waitForIdle();

      // Parse arguments
      const parts = (args ?? "").trim().split(/\s+/);
      if (parts.length < 2 || !["plan", "build"].includes(parts[0])) {
        ctx.ui.notify(
          'Usage: /ralph-loop plan|build "task" [--completion-promise "PHRASE"] [--max-iterations N]',
          "error",
        );
        return;
      }

      const mode = parts[0] as "plan" | "build";
      let maxIterations = 50; // Default for build, plan only runs once
      let completionPromise: string | null = null;
      const promptParts: string[] = [];

      // Parse remaining arguments
      let i = 1;
      while (i < parts.length) {
        if (parts[i] === "--max-iterations" && i + 1 < parts.length) {
          const n = parseInt(parts[i + 1], 10);
          if (!isNaN(n) && n >= 0) {
            maxIterations = n;
          }
          i += 2;
        } else if (parts[i] === "--completion-promise" && i + 1 < parts.length) {
          completionPromise = parts[i + 1];
          i += 2;
        } else {
          promptParts.push(parts[i]);
          i++;
        }
      }

      const task = promptParts.join(" ");
      if (!task) {
        ctx.ui.notify("A task description is required.", "error");
        return;
      }

      // Create state directory
      fs.mkdirSync(path.join(ctx.cwd, ".pi"), { recursive: true });

      // Get session ID for isolation
      let sessionId = "";
      try {
        const sessionFile = ctx.sessionManager.getSessionFile();
        if (sessionFile) {
          sessionId = path.basename(sessionFile, ".jsonl");
        }
      } catch {
        // Ephemeral session — fine
      }

      // Write state file
      const state: RalphLoopState = {
        mode,
        prompt: task,
        completion_promise: completionPromise,
        max_iterations: mode === "plan" ? 1 : maxIterations,
        iteration: 1,
        status: "running",
        session_id: sessionId,
      };
      writeStateFile(ctx.cwd, state);

      // Report
      const promiseInfo = completionPromise
        ? ` | completion: "${completionPromise}"`
        : "";
      const maxInfo = maxIterations > 0 ? ` | max: ${maxIterations} iterations` : "";
      ctx.ui.notify(
        `Ralph loop started (${mode}${maxInfo}${promiseInfo})`,
        "info",
      );

      // Send orchestration prompt
      const orchestrationPrompt = buildOrchestrationPrompt(
        mode,
        task,
        completionPromise,
        maxIterations,
      );
      pi.sendUserMessage(orchestrationPrompt, { deliverAs: "followUp" });
    },
  });

  // ── /cancel-ralph ───────────────────────────────────────────────────────

  pi.registerCommand("cancel-ralph", {
    description: "Cancel the active Ralph Loop",
    async handler(_args, ctx) {
      const loopFile = path.join(ctx.cwd, ".pi", "ralph-loop.json");
      const resultFile = path.join(ctx.cwd, ".pi", "ralph-result.json");

      if (!fs.existsSync(loopFile)) {
        ctx.ui.notify("No active Ralph loop found.", "info");
        return;
      }

      let iteration = "?";
      try {
        const data = JSON.parse(fs.readFileSync(loopFile, "utf8"));
        iteration = String(data.iteration ?? "?");
      } catch {
        // ignore parse errors
      }

      fs.unlinkSync(loopFile);
      try { fs.unlinkSync(resultFile); } catch { /* may not exist */ }

      ctx.ui.notify(`Cancelled Ralph loop (was at iteration ${iteration})`, "info");
    },
  });
}
