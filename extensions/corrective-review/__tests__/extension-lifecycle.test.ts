// extensions/corrective-review/__tests__/extension-lifecycle.test.ts
//
// Integration test: verifies the extension registers handlers for the correct
// lifecycle events and that the message_end handler follows the contract.

import type {
  ExtensionAPI,
  MessageEndEvent,
  MessageEndEventResult,
  ToolResultEvent,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { ExecResult } from "@earendil-works/pi-coding-agent";

// ── Test infrastructure ────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  // Wrap in async executor for the top-level await
  (async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  })();
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// ── Mock ExtensionAPI ──────────────────────────────────────────────────

interface HandlerRecord {
  event: string;
  handler: (...args: unknown[]) => unknown;
}

function createMockAPI(): {
  api: ExtensionAPI;
  handlers: HandlerRecord[];
  execCalls: Array<{ command: string; args: string[] }>;
} {
  const handlers: HandlerRecord[] = [];
  const execCalls: Array<{ command: string; args: string[] }> = [];

  // Stub exec that returns a mock PASS verdict
  let mockExecResult: ExecResult = {
    stdout: "PASS\nAll checks passed.",
    stderr: "",
    code: 0,
    killed: false,
  };

  const api = {
    on(event: string, handler: (...args: unknown[]) => unknown) {
      handlers.push({ event, handler });
    },
    async exec(command: string, args: string[]): Promise<ExecResult> {
      execCalls.push({ command, args });
      return mockExecResult;
    },
    sendMessage() {},
    // Stub other methods as needed
  } as unknown as ExtensionAPI;

  return { api, handlers, execCalls };
}

// ── Mock ExtensionContext ──────────────────────────────────────────────

function createMockContext(): ExtensionContext {
  const statuses: Array<{ key: string; text: string | undefined }> = [];
  const notifications: string[] = [];

  return {
    ui: {
      setStatus(key: string, text: string | undefined) {
        statuses.push({ key, text });
      },
      notify(message: string) {
        notifications.push(message);
      },
      // Stub other UI methods
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
      // Explicit never for typecheck
      //@ts-expect-error - lazy stub
    },
    hasUI: true,
    cwd: "/test",
    sessionManager: {
      getEntries: () => [],
    } as never,
    modelRegistry: {} as never,
    model: { id: "test/test-model" } as never,
    isIdle: () => true,
    signal: undefined,
    abort: () => {},
    hasPendingMessages: () => false,
    shutdown: () => {},
    getContextUsage: () => undefined,
    compact: () => {},
    getSystemPrompt: () => "",
  } as ExtensionContext;
}

// ── Helper to build mock events ────────────────────────────────────────

function assistantMessageEnd(
  text: string,
): MessageEndEvent {
  return {
    type: "message_end",
    message: {
      role: "assistant",
      content: text,
    },
  } as MessageEndEvent;
}

function toolResultEvent(
  toolName: string,
  text: string,
  isError = false,
): ToolResultEvent {
  return {
    type: "tool_result",
    toolCallId: "call-1",
    toolName,
    input: {},
    content: [{ type: "text", text: text }],
    isError,
  } as ToolResultEvent;
}

// ── Run tests ──────────────────────────────────────────────────────────

import createExtension from "../index.ts";

test("extension registers session_start handler", async () => {
  const { api, handlers } = createMockAPI();
  await createExtension(api);

  const sessionStart = handlers.filter((h) => h.event === "session_start");
  assert(sessionStart.length === 1, `Expected 1 session_start handler, got ${sessionStart.length}`);
});

test("extension registers input handler", async () => {
  const { api, handlers } = createMockAPI();
  await createExtension(api);

  const input = handlers.filter((h) => h.event === "input");
  assert(input.length === 1, `Expected 1 input handler, got ${input.length}`);
});

test("extension registers tool_result handler", async () => {
  const { api, handlers } = createMockAPI();
  await createExtension(api);

  const toolResult = handlers.filter((h) => h.event === "tool_result");
  assert(toolResult.length === 1, `Expected 1 tool_result handler, got ${toolResult.length}`);
});

test("extension registers message_end handler", async () => {
  const { api, handlers } = createMockAPI();
  await createExtension(api);

  const messageEnd = handlers.filter((h) => h.event === "message_end");
  assert(messageEnd.length === 1, `Expected 1 message_end handler, got ${messageEnd.length}`);
});

test("extension registers session_shutdown handler", async () => {
  const { api, handlers } = createMockAPI();
  await createExtension(api);

  const shutdown = handlers.filter((h) => h.event === "session_shutdown");
  assert(shutdown.length === 1, `Expected 1 session_shutdown handler, got ${shutdown.length}`);
});

test("message_end skips non-assistant messages", async () => {
  const { api, handlers } = createMockAPI();
  await createExtension(api);

  const msgEndHandler = handlers.find((h) => h.event === "message_end")!.handler;
  const ctx = createMockContext();

  const result = await msgEndHandler(
    {
      type: "message_end",
      message: { role: "user", content: "hello" },
    },
    ctx,
  );

  // Should return undefined (no review triggered for user messages)
  assert(result === undefined, "Should skip user messages");
});

test("message_end skips when no tool calls were collected", async () => {
  const { api, handlers } = createMockAPI();
  await createExtension(api);

  // Trigger session_start to initialize state
  const sessionHandler = handlers.find((h) => h.event === "session_start")!.handler;
  await sessionHandler({ type: "session_start", reason: "new" }, createMockContext());

  const msgEndHandler = handlers.find((h) => h.event === "message_end")!.handler;
  const ctx = createMockContext();

  const result = await msgEndHandler(
    assistantMessageEnd("just a chat response"),
    ctx,
  );

  assert(result === undefined, "Should skip when no tools were used");
});

test("message_end runs review when tools were collected", async () => {
  const { api, handlers, execCalls } = createMockAPI();
  await createExtension(api);

  // Initialize session state
  const sessionHandler = handlers.find((h) => h.event === "session_start")!.handler;
  await sessionHandler({ type: "session_start", reason: "new" }, createMockContext());

  // Simulate user input
  const inputHandler = handlers.find((h) => h.event === "input")!.handler;
  inputHandler({ type: "input", text: "find AGENTS.md", source: "interactive" }, {});

  // Simulate a tool result
  const toolHandler = handlers.find((h) => h.event === "tool_result")!.handler;
  toolHandler(toolResultEvent("bash", "total 0"), {});

  // Now simulate message_end
  const msgEndHandler = handlers.find((h) => h.event === "message_end")!.handler;
  const ctx = createMockContext();

  const result = (await msgEndHandler(
    assistantMessageEnd("Not found."),
    ctx,
  )) as MessageEndEventResult | undefined;

  // Should have spawned a review subprocess
  assert(execCalls.length === 1, `Expected 1 exec call, got ${execCalls.length}`);
  assert(
    execCalls[0]!.command === "pi",
    `Expected 'pi' command, got '${execCalls[0]!.command}'`,
  );

  // Check args: -p, --no-extensions, --no-skills, --model, @file
  const args = execCalls[0]!.args;
  assert(args.includes("-p"), "Expected -p flag");
  assert(args.includes("--no-extensions"), "Expected --no-extensions flag");
  assert(args.includes("--no-skills"), "Expected --no-skills flag");
  assert(args.some((a) => a.startsWith("@")), "Expected @taskFile argument");

  // Since mock returns PASS, result should be undefined
  assert(result === undefined, "PASS should return undefined (let message through)");
});

test("message_enforces maxReviewCycles", async () => {
  const { api, handlers, execCalls } = createMockAPI();
  await createExtension(api);

  // Initialize
  const sessionHandler = handlers.find((h) => h.event === "session_start")!.handler;
  await sessionHandler({ type: "session_start", reason: "new" }, createMockContext());

  const inputHandler = handlers.find((h) => h.event === "input")!.handler;
  inputHandler({ type: "input", text: "test", source: "interactive" }, {});

  const toolHandler = handlers.find((h) => h.event === "tool_result")!.handler;
  const msgEndHandler = handlers.find((h) => h.event === "message_end")!.handler;
  const ctx = createMockContext();

  // Cycle 1: should run review
  toolHandler(toolResultEvent("bash", "result 1"), {});
  await msgEndHandler(assistantMessageEnd("response 1"), ctx);
  assert(execCalls.length === 1, "Cycle 1: should spawn review");

  // Cycle 2: should run review
  toolHandler(toolResultEvent("bash", "result 2"), {});
  await msgEndHandler(assistantMessageEnd("response 2"), ctx);
  assert(execCalls.length === 2, "Cycle 2: should spawn review");

  // Cycle 3: should skip (maxReviewCycles=2)
  toolHandler(toolResultEvent("bash", "result 3"), {});
  const result = await msgEndHandler(assistantMessageEnd("response 3"), ctx);
  assert(result === undefined, "Cycle 3: should be undefined");
  assert(execCalls.length === 2, "Cycle 3: should NOT have spawned another review");
});

// ── Summary ────────────────────────────────────────────────────────────

// Wait for all async tests to complete before printing summary
setTimeout(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}, 1000);
