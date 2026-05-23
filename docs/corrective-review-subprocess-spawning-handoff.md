# Handoff: Corrective Review — Direct Subprocess Spawning

**Date:** 2026-05-22  
**Branch:** `dev`  
**Status:** Design sketched, deferred for future iteration

## Why

当前 corrective review extension 通过 `pi.sendMessage({ deliverAs: "steer" })` 注入 review 任务，依赖 agent 自行调用 `subagent` tool。这有两个问题：

1. **不可靠** — agent 可能忽略 steer、不按格式调 subagent、或误解指令，review 悄无声息地失败
2. **浪费** — 每次 review 消耗 2 次 subagent 调用（review steer + agent 处理），且 agent 的思考 token 也参与其中

## What

将 review subagent 的 spawn 方式从「让 agent 调 subagent tool」改为「extension 直接用 shell 命令 spawn 独立 pi 进程」。Extension 在 `turn_end` 时：

1. 收集 review 数据（同现方案）
2. 将 review task 写入临时文件
3. `pi.exec("pi", ["-p", "--no-extensions", "--no-skills", "--model", "...", `@${taskFile}`])`
4. 解析 stdout 获取 PASS/FAIL
5. PASS → 不干预，agent 回复自然发送给用户
6. FAIL → `pi.sendMessage({ content: feedback }, { deliverAs: "steer" })` 注入反馈，agent 重新 tool

## Architecture

```
turn_end
   │
   ├─ collectReviewInput(sessionManager, toolResults, draftResponse)
   │
   ├─ buildReviewTask(reviewInput) → taskFile
   │
   ├─ pi.exec("pi", ["-p", "--no-extensions", "--no-skills",
   │                  "--model", model, `@${taskFile}`])
   │
   ├─ parseReviewVerdict(stdout)
   │
   ├─ PASS → (no-op, agent response goes to user)
   └─ FAIL → sendMessage({ content: feedback }, { deliverAs: "steer" })
              → agent re-tools → turn_end again → review again (up to maxReviewCycles)
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| `pi -p` (print mode) | 非交互，stdout 直接拿到结果，不需要解析 session JSON |
| `--no-extensions` | 避免 review 进程加载 extension（包括本项目自身），防止递归 review |
| `--no-skills` | Review 只是读一段文本给 PASS/FAIL，不需要 skills |
| `@taskFile` | 从文件读 prompt，避免 shell 转义问题 |
| 用 `pi.exec()` | Pi ExtensionAPI 自带的方法，不需要额外依赖 |
| `parseReviewVerdict()` 同步解析 | 不再需要 agent 解读 subagent 结果，extension 直接判断 PASS/FAIL |

## Code Sketch

```typescript
// extensions/corrective-review/index.ts (改动部分)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── Subprocess review ─────────────────────────────────────────────────

async function runReviewSubprocess(
  reviewInput: ReviewInput,
  model: string,
): Promise<{ verdict: "PASS" | "FAIL"; feedback: string }> {
  // Write task to temp file
  const taskFile = path.join(
    os.tmpdir(),
    `corrective-review-${Date.now()}.txt`,
  );
  const taskContent = buildReviewSystemPrompt(config) + "\n\n---\n\n"
    + buildReviewTask(reviewInput);
  fs.writeFileSync(taskFile, taskContent);

  try {
    const result = await pi.exec("pi", [
      "-p",
      "--no-extensions",
      "--no-skills",
      "--model", model,
      `@${taskFile}`,
    ], { timeout: 30_000 });

    return parseReviewVerdict(result.stdout);
  } finally {
    // Clean up temp file
    try { fs.unlinkSync(taskFile); } catch { /* ignore */ }
  }
}

// In turn_end handler:
pi.on("turn_end", async (event, ctx) => {
  // ... guards (same as current) ...

  const reviewInput = collectReviewInput(
    ctx.sessionManager,
    event.toolResults,
    extractText(event.message.content),
  );

  const model = ctx.model?.id ?? "deepseek/deepseek-v4-pro";

  try {
    const { verdict, feedback } = await runReviewSubprocess(reviewInput, model);

    if (verdict === "FAIL" && reviewCycleCount < config.maxReviewCycles) {
      reviewCycleCount++;
      pi.sendMessage(
        {
          customType: "corrective-review-feedback",
          content: `[CORRECTIVE-REVIEW FAIL cycle ${reviewCycleCount}/${config.maxReviewCycles}]\n\n${feedback}\n\nFix the issues and re-draft your response.`,
          display: false,
        },
        { deliverAs: "steer" },
      );
    }
  } catch (err) {
    // Fail closed: skip review on error
    ctx.ui.notify(
      `corrective-review: subprocess failed: ${err instanceof Error ? err.message : String(err)}`,
      "warning",
    );
  }
});
```

## Model Selection

Review subprocess 的 model 可以：
- 继承当前 session 的 model（`ctx.model?.id`）
- 硬编码一个便宜快速的 model（如 `deepseek/deepseek-v4-pro`）
- 通过 config.ts 可配置

建议默认用当前 session model，`config.ts` 加一个 `reviewModel?: string` 的 override。

## Dependencies

- **不再依赖** `pi-subagents` 包 — review 不需要 subagent tool
- 只需要 Pi 自身的 `pi exec` 命令可用（已内置）

## Migration Path

从当前方案迁移：

1. 删除 `review-subagent.ts`（不再需要 subagent 定义）
2. 修改 `index.ts`：移除所有 `sendMessage` steer + `agentRegistered` 逻辑，替换为 `runReviewSubprocess()`
3. 简化 `review-prompt.ts`：系统 prompt 从「给 subagent 的」变为「给 review pi 进程的」
4. `collector.ts` 保持不变
5. `config.ts` 加一个 `reviewModel?: string`

## Risks

- **冷启动延迟** — 每次 review 要启动新 pi 进程，可能增加 1-3 秒延迟
- **API cost** — 每次 review 消耗一次 API call（但当前方案也消耗）
- **model 一致性** — review 用的 model 和 agent 不同可能影响判断质量
- **`pi.exec` timeout** — 如果 review 进程卡住，超时后 fail closed（跳过 review）
