// extensions/permissions/classifier.ts

export type RiskLevel = "low" | "medium" | "high";

export interface ClassificationResult {
  risk: RiskLevel;
  reason: string;
}

export interface ClassifierConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  api: "anthropic-messages" | "openai-completions";
}

const CLASSIFICATION_PROMPT = `You are a bash command safety classifier. Analyze the following command and classify its risk level.

Risk levels:
- low: Safe/read-only operations (ls, cat, echo, grep, find, git status/diff/log, npm test, cargo build, standard build commands)
- medium: Potentially destructive but recoverable (git commit/push, npm install, pip install, file moves/renames, docker commands)
- high: Destructive or dangerous (rm -rf, sudo, curl | bash, chmod 777, git push --force, database drops, kill, shutdown)

Respond with ONLY a JSON object: {"risk": "low"|"medium"|"high", "reason": "brief explanation"}`;

export async function classifyBashCommand(
  command: string,
  cwd: string,
  config: ClassifierConfig,
  signal?: AbortSignal,
): Promise<ClassificationResult> {
  if (config.api === "anthropic-messages") {
    return classifyAnthropic(command, cwd, config, signal);
  }
  return classifyOpenAI(command, cwd, config, signal);
}

async function classifyAnthropic(
  command: string,
  cwd: string,
  config: ClassifierConfig,
  signal?: AbortSignal,
): Promise<ClassificationResult> {
  const response = await fetch(`${config.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 256,
      messages: [
        { role: "user", content: `${CLASSIFICATION_PROMPT}\n\nCommand: ${command}\nWorking directory: ${cwd}` },
      ],
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Classification API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  const text = data.content.find((c) => c.type === "text")?.text ?? "";
  return parseClassification(text);
}

async function classifyOpenAI(
  command: string,
  cwd: string,
  config: ClassifierConfig,
  signal?: AbortSignal,
): Promise<ClassificationResult> {
  const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 256,
      temperature: 0,
      messages: [
        { role: "user", content: `${CLASSIFICATION_PROMPT}\n\nCommand: ${command}\nWorking directory: ${cwd}` },
      ],
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Classification API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const text = data.choices[0]?.message?.content ?? "";
  return parseClassification(text);
}

function parseClassification(text: string): ClassificationResult {
  // Try to extract JSON from the response
  const jsonMatch = text.match(/\{[^}]+\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const risk = parsed.risk as RiskLevel;
      if (risk === "low" || risk === "medium" || risk === "high") {
        return { risk, reason: parsed.reason ?? "No reason provided" };
      }
    } catch {
      // fall through to fallback
    }
  }
  // Fallback: treat as high risk if parsing fails
  return { risk: "high", reason: "Failed to parse classifier response" };
}
