// extensions/permissions/classifier.ts

export type RiskLevel = "low" | "medium" | "high";

export interface ClassificationResult {
  risk: RiskLevel;
  reason: string;
}

// ── Read-only bash command patterns ──
const READ_ONLY_BASH_PATTERNS = [
  /^(cat|head|tail|less|more|zcat|bzcat|zless)\s/i,
  /^(ls|dir|tree|exa|eza)\s/i,
  /^(grep|egrep|fgrep|rg|ag|ack)\s/i,
  /^(find|locate|fd)\s/i,
  /^(wc|file|stat|du|df|md5sum|sha\ds+um|cksum|xxd|od|hexdump)\s/i,
  /^(which|type|whereis|where|command\s+-v)\s/i,
  /^(pwd|echo|printf)\s/i,
  /^(whoami|id|groups|users|last|w)\s/i,
  /^(uname|hostname|date|uptime|arch)\s/i,
  /^(env|printenv|tty)\s/i,
  /^(readlink|realpath|dirname|basename)\s/i,
  /^(sort|uniq|cut|tr|sed\s+-n|awk|column|fmt|nl)\s/i,
  /^git\s+(status|diff|log|show|branch|tag|stash\s+list|remote\s+-v|rev-parse|ls-files|ls-tree|rev-list|describe|shortlog)/i,
  /^(npm|yarn|pnpm|bun)\s+(list|ls|outdated|view|info|why|explain)\b/i,
  /^docker\s+(ps|images|info|inspect|logs|stats|version)\b/i,
  /^(kubectl|k)\s+(get|describe|logs|top|explain|api-resources|api-versions|cluster-info)\b/i,
  /^(man|info|help|apropos|whatis)\s/i,
];

// ── High-risk (destructive) bash command patterns ──
const HIGH_RISK_PATTERNS = [
  /\brm\s+(-[^ ]*[rf][^ ]*|--recursive|--force)/i,
  /\bsudo\b/i,
  /\b(chmod|chown)\b.*(777|o\+w|a\+w)/i,
  /\bcurl\b.*\|.*\b(ba)?sh\b/i,
  /\bwget\b.*\|.*\b(ba)?sh\b/i,
  /\bgit\s+push\s+.*(-f|--force)/i,
  /\bgit\s+reset\s+--hard/i,
  /\b(drop|truncate|delete)\s+(database|table)/i,
  /\b(kill|pkill|killall|skill)\b/i,
  /\b(shutdown|reboot|halt|poweroff|init\s+[06])\b/i,
  /\bdd\s+if=/i,
  /\bmkfs\.\w+/i,
  /\bchroot\b/i,
  /\bmount\b.*\bremount/i,
  /\biptables\b/i,
  /\bnft\b/i,
  /\beval\b/i,
  /\bsource\s+.*\bcurl\b/i,
  /\bsh\s+-c\s+["'].*curl/i,
  /^>\s*\/dev\//i,
];

/** Check if a bash command is read-only (no side effects). */
export function isReadOnlyBash(command: string): boolean {
  const trimmed = command.trim();
  // Disallow anything with output redirection (could write files)
  if (/\d*>[>&]?\s*\S/.test(trimmed)) return false;
  return READ_ONLY_BASH_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Local heuristic classifier — no API key needed.
 * Checks patterns: high-risk → high, low-risk → low, otherwise medium.
 */
export function classifyBashCommandLocal(command: string): ClassificationResult {
  const trimmed = command.trim();

  if (HIGH_RISK_PATTERNS.some((p) => p.test(trimmed))) {
    return { risk: "high", reason: "Destructive command pattern detected" };
  }

  if (isReadOnlyBash(trimmed)) {
    return { risk: "low", reason: "Read-only command" };
  }

  return { risk: "medium", reason: "Potentially state-modifying command" };
}

export interface TranscriptClassifierResult {
  verdict: "allow" | "block";
  reason: string;
}

/**
 * Two-stage transcript classifier.
 *
 * Stage 1: fast filter (max_tokens=64, no thinking).
 *   Only BLOCK rules. "Err on the side of blocking."
 *   No <block> tag → ALLOW (stop). <block> emitted → escalate.
 *
 * Stage 2: full reasoning (max_tokens=4096, thinking=on).
 *   Full spec: user intent rules + ALLOW exceptions.
 *   → final <block> or <allow>.
 *
 * Input: classifier transcript (built by transcript.ts) and the current model.
 * Uses Pi's complete() API — inherits model, auth, and base URL automatically.
 */
export async function classifyWithTranscript(
  transcript: string,
  command: string,
  completeFn: typeof import("@earendil-works/pi-ai").complete,
  model: any,
  getApiKeyAndHeaders: (model: any) => Promise<{
    ok: boolean;
    apiKey?: string;
    headers?: Record<string, string>;
    error?: string;
  }>,
  buildStage1Prompt: (transcript: string, action: string) => string,
  buildStage2Prompt: (transcript: string, action: string) => string,
  signal?: AbortSignal,
): Promise<TranscriptClassifierResult> {
  const auth = await getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) {
    throw new Error(`Classifier auth failed: ${auth.error ?? "no API key"}`);
  }

  const completeOptions = {
    apiKey: auth.apiKey,
    headers: auth.headers ?? {},
    signal,
  };

  // ── Stage 1: fast filter ──
  const stage1Input = buildStage1Prompt(transcript, command);
  const stage1 = await completeFn(
    model,
    {
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: stage1Input }],
          timestamp: Date.now(),
        },
      ],
    },
    { ...completeOptions, maxTokens: 64 },
  );

  const stage1Text = extractText(stage1.content);
  if (!stage1Text.includes("<block>")) {
    return { verdict: "allow", reason: "Passed fast filter" };
  }

  // ── Stage 2: full reasoning ──
  const stage2Input = buildStage2Prompt(transcript, command);
  const stage2 = await completeFn(
    model,
    {
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: stage2Input }],
          timestamp: Date.now(),
        },
      ],
    },
    { ...completeOptions, maxTokens: 4096 },
  );

  const stage2Text = extractText(stage2.content);
  if (stage2Text.includes("<block>")) {
    const reason = extractReason(stage2Text);
    return { verdict: "block", reason };
  }
  return { verdict: "allow", reason: "Cleared on review" };
}

function extractText(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

function extractReason(text: string): string {
  const reasonMatch = text.match(/<reason>([\s\S]*?)<\/reason>/i);
  if (reasonMatch) return reasonMatch[1].trim();

  const lines = text.split("\n");
  for (const line of lines) {
    if (line.includes("<block>")) {
      return line.replace(/<block>/gi, "").trim() || "Blocked by classifier";
    }
  }
  return "Blocked by classifier";
}
