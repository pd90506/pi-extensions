// extensions/permissions/transcript.ts

/**
 * Build a classifier transcript from session entries.
 *
 * Rules:
 * - Only user messages and tool call invocations (names + args).
 * - No assistant prose, no tool results, no thinking blocks.
 * - This prevents the agent from talking the classifier into bad decisions,
 *   and blocks prompt-injection via malicious tool outputs.
 *
 * Format:
 * <transcript>
 * <user>Fix the auth bug</user>
 * <tool_call name="bash">git status</tool_call>
 * <user>check logs first</user>
 * <tool_call name="bash">tail -100 /var/log/app.log</tool_call>
 * </transcript>
 *
 * <action>
 * <tool_call name="bash">rm -rf /var/log/app.log</tool_call>
 * </action>
 */

const MAX_TRANSCRIPT_CHARS = 32000; // ~8000 tokens

interface SessionEntry {
  type: string;
  message?: {
    role: string;
    content: string | Array<{ type: string; text?: string; name?: string; arguments?: Record<string, unknown> }>;
    command?: string;
  };
}

export function buildClassifierTranscript(
  entries: SessionEntry[],
  currentToolName: string,
  currentInput: Record<string, unknown>,
): string {
  const lines: string[] = [];

  for (const entry of entries) {
    // Only process "message" type entries
    if (entry.type !== "message") continue;

    const msg = entry.message;
    if (!msg) continue;

    // User messages
    if (msg.role === "user") {
      const text = extractText(msg.content);
      if (text) lines.push(`<user>${truncate(text, 500)}</user>`);
      continue;
    }

    // Assistant messages — extract tool calls only
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "toolCall") {
          const args = summariseArgs(block.arguments ?? {});
          lines.push(`<tool_call name="${block.name}">${args}</tool_call>`);
        }
      }
    }

    // Skip: toolResult, bashExecution, custom, branchSummary, compactionSummary
  }

  // Truncate oldest lines if too long
  while (lines.join("\n").length > MAX_TRANSCRIPT_CHARS && lines.length > 1) {
    if (lines[0].startsWith("<omitted")) {
      lines.shift();
    } else {
      lines[0] = "<omitted />";
    }
  }

  const transcript = `<transcript>\n${lines.join("\n")}\n</transcript>`;

  // Build the current action block
  let actionBlock: string;
  if (currentToolName === "bash") {
    actionBlock = `<action>\n<tool_call name="bash">${currentInput.command ?? ""}</tool_call>\n</action>`;
  } else {
    const args = summariseArgs(currentInput);
    actionBlock = `<action>\n<tool_call name="${currentToolName}">${args}</tool_call>\n</action>`;
  }

  return `${transcript}\n\n${actionBlock}`;
}

function extractText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }
  return "";
}

function summariseArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    const val = typeof value === "string" ? value : JSON.stringify(value);
    parts.push(`${key}=${val}`);
  }
  return parts.join(" ");
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}
