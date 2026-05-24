// extensions/__tests__/superpowers-bootstrap.test.ts
//
// Regression tests for the Superpowers → Pi compatibility bootstrap.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import createExtension from "../superpowers-bootstrap.ts";

let passed = 0;
let failed = 0;
const pending: Promise<void>[] = [];

function test(name: string, fn: () => void | Promise<void>) {
  const run = (async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  })();
  pending.push(run);
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

interface HandlerRecord {
  event: string;
  handler: (...args: unknown[]) => unknown;
}

function createMockAPI(tools: Array<{ name: string }> = []): {
  api: ExtensionAPI;
  handlers: HandlerRecord[];
} {
  const handlers: HandlerRecord[] = [];

  const api = {
    on(event: string, handler: (...args: unknown[]) => unknown) {
      handlers.push({ event, handler });
    },
    getAllTools() {
      return tools;
    },
  } as unknown as ExtensionAPI;

  return { api, handlers };
}

function createMockContext(options?: {
  entries?: unknown[];
  contextMessages?: unknown[];
  includeBuildSessionContext?: boolean;
}): ExtensionContext {
  const entries = options?.entries ?? [];
  const contextMessages = options?.contextMessages ?? [];
  const includeBuildSessionContext = options?.includeBuildSessionContext ?? true;

  return {
    ui: {
      notify: () => {},
      setStatus: () => {},
      select: async () => undefined,
      confirm: async () => false,
      input: async () => undefined,
      onTerminalInput: () => () => {},
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: () => {},
      setFooter: () => {},
      setHeader: () => {},
      setTitle: () => {},
      custom: async () => undefined as never,
      pasteToEditor: () => {},
      setEditorText: () => {},
      getEditorText: () => "",
      editor: async () => undefined,
      addAutocompleteProvider: () => {},
      setEditorComponent: () => {},
      getEditorComponent: () => undefined,
      theme: {} as never,
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: true }),
      getToolsExpanded: () => true,
      setToolsExpanded: () => {},
    },
    hasUI: true,
    cwd: "/test",
    sessionManager: {
      getEntries: () => entries,
      ...(includeBuildSessionContext
        ? {
            buildSessionContext: () => ({
              messages: contextMessages,
              thinkingLevel: undefined,
              model: undefined,
            }),
          }
        : {}),
    } as never,
    modelRegistry: {} as never,
    model: { id: "test/test-model" } as never,
    isIdle: () => true,
    signal: undefined,
    abort: () => {},
    hasPendingMessages: () => false,
    shutdown: () => {},
    getContextUsage: () => undefined,
    compact: async () => undefined as never,
    getSystemPrompt: () => "",
  } as ExtensionContext;
}

async function getInjectedBootstrap(ctx = createMockContext()): Promise<string> {
  const { api, handlers } = createMockAPI([{ name: "subagent" }]);
  createExtension(api);

  const sessionStart = handlers.find((h) => h.event === "session_start")!.handler;
  await sessionStart({ type: "session_start", reason: "startup" }, ctx);

  const beforeAgentStart = handlers.find((h) => h.event === "before_agent_start")!.handler;
  const result = await beforeAgentStart({ type: "before_agent_start", prompt: "hello" }, ctx) as {
    message?: { content?: string };
  } | undefined;

  assert(result?.message?.content, "Expected bootstrap message to be injected");
  return result.message.content!;
}

test("injects when historical entries contain bootstrap but current context does not", async () => {
  const ctx = createMockContext({
    entries: [{ customType: "superpowers-bootstrap" }],
    contextMessages: [],
  });

  const content = await getInjectedBootstrap(ctx);

  assert(content.includes("You have superpowers"), "Expected bootstrap content when current context lacks it");
});

test("does not inject when current context already contains bootstrap", async () => {
  const { api, handlers } = createMockAPI([{ name: "subagent" }]);
  createExtension(api);
  const ctx = createMockContext({
    entries: [],
    contextMessages: [
      { role: "custom", customType: "superpowers-bootstrap", content: "existing", display: false },
    ],
  });

  const beforeAgentStart = handlers.find((h) => h.event === "before_agent_start")!.handler;
  const result = await beforeAgentStart({ type: "before_agent_start", prompt: "hello" }, ctx);

  assert(result === undefined, "Expected no injection when current context already has bootstrap");
});

test("falls back to custom_message entries when buildSessionContext is unavailable", async () => {
  const { api, handlers } = createMockAPI([{ name: "subagent" }]);
  createExtension(api);
  const ctx = createMockContext({
    includeBuildSessionContext: false,
    entries: [{ type: "custom_message", customType: "superpowers-bootstrap" }],
  });

  const beforeAgentStart = handlers.find((h) => h.event === "before_agent_start")!.handler;
  const result = await beforeAgentStart({ type: "before_agent_start", prompt: "hello" }, ctx);

  assert(result === undefined, "Expected fallback to detect existing bootstrap custom_message entries");
});

test("skill mapping uses Pi skill locations instead of a fake skills directory", async () => {
  const content = await getInjectedBootstrap();

  assert(!content.includes("skills/<skill-name>/SKILL.md"), "Bootstrap must not point at a non-existent generic skills directory");
  assert(content.includes("<available_skills>"), "Bootstrap should tell agents to use Pi's available skill metadata");
  assert(content.includes("<location>"), "Bootstrap should tell agents to read the exact skill location");
});

test("bootstrap adds a Pi adaptation preface before embedded using-superpowers content", async () => {
  const content = await getInjectedBootstrap();
  const adaptationIndex = content.indexOf("## Pi Adaptation");
  const embeddedIndex = content.indexOf("## Instruction Priority");

  assert(adaptationIndex >= 0, "Expected a Pi-specific adaptation preface");
  assert(embeddedIndex >= 0, "Expected embedded using-superpowers content");
  assert(adaptationIndex < embeddedIndex, "Pi adaptation must appear before embedded Claude-oriented instructions");
  assert(content.includes("already loaded"), "Preface should say using-superpowers is already loaded");
  assert(content.includes("Claude Code's `Skill` tool"), "Preface should explicitly override Claude Skill tool wording");
});

Promise.all(pending).then(() => {
  if (failed > 0) {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(1);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
});
