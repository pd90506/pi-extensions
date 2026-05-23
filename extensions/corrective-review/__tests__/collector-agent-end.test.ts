// Test: collector can extract review inputs from agent_end event messages.
//
// agent_end provides event.messages (all messages in the prompt cycle),
// while the old turn_end provided event.toolResults + event.message.
// We need a function that bridges agent_end format to ReviewInput.

import { extractReviewFromAgentEnd } from "../collector.ts";
import type { ReviewInput } from "../collector.ts";
import type { Message } from "@earendil-works/pi-ai"; // placeholder — we'll validate at runtime

// ── Helpers to build test messages ──────────────────────────────────────

function userMsg(text: string): Message {
  return { role: "user", content: text } as Message;
}

function assistantMsg(text: string): Message {
  return { role: "assistant", content: text } as Message;
}

function toolResultMsg(toolName: string, text: string, isError = false): Message {
  return {
    role: "toolResult",
    toolName,
    content: text,
    isError,
  } as Message;
}

// ── Tests ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// ── Test cases ──────────────────────────────────────────────────────────

test("extracts user prompt from agent_end messages", () => {
  const messages: Message[] = [
    userMsg("find the AGENTS.md file"),
    assistantMsg("let me search"),
    toolResultMsg("bash", "total 0"),
    assistantMsg("not found"),
  ];

  const result = extractReviewFromAgentEnd(messages);

  assert(result.userPrompt === "find the AGENTS.md file", `Expected user prompt, got: "${result.userPrompt}"`);
});

test("extracts all tool results from agent_end messages", () => {
  const messages: Message[] = [
    userMsg("search for something"),
    toolResultMsg("bash", "file1.txt\nfile2.txt"),
    assistantMsg("found files"),
    toolResultMsg("read", "content of file1..."),
    assistantMsg("here is the content"),
  ];

  const result = extractReviewFromAgentEnd(messages);

  assert(result.toolHistory.length === 2, `Expected 2 tool calls, got ${result.toolHistory.length}`);
  assert(result.toolHistory[0]!.toolName === "bash", `Expected bash, got ${result.toolHistory[0]!.toolName}`);
  assert(result.toolHistory[1]!.toolName === "read", `Expected read, got ${result.toolHistory[1]!.toolName}`);
});

test("extracts final assistant message as draft response", () => {
  const messages: Message[] = [
    userMsg("what is pi"),
    toolResultMsg("bash", "output"),
    assistantMsg("pi is a coding agent"),
  ];

  const result = extractReviewFromAgentEnd(messages);

  assert(result.draftResponse === "pi is a coding agent", `Expected draft response, got: "${result.draftResponse}"`);
});

test("handles empty messages gracefully", () => {
  const messages: Message[] = [];

  const result = extractReviewFromAgentEnd(messages);

  assert(result.userPrompt === "", `Expected empty user prompt, got: "${result.userPrompt}"`);
  assert(result.toolHistory.length === 0, `Expected 0 tool calls, got ${result.toolHistory.length}`);
  assert(result.draftResponse === "", `Expected empty draft response, got: "${result.draftResponse}"`);
});

test("handles messages with no tool calls", () => {
  const messages: Message[] = [
    userMsg("hello"),
    assistantMsg("hi there"),
  ];

  const result = extractReviewFromAgentEnd(messages);

  assert(result.userPrompt === "hello", `Expected user prompt, got: "${result.userPrompt}"`);
  assert(result.toolHistory.length === 0, `Expected 0 tool calls, got ${result.toolHistory.length}`);
  assert(result.draftResponse === "hi there", `Expected draft response, got: "${result.draftResponse}"`);
});

test("marks tool errors in history", () => {
  const messages: Message[] = [
    userMsg("do it"),
    toolResultMsg("bash", "command not found", true),
    assistantMsg("command failed"),
  ];

  const result = extractReviewFromAgentEnd(messages);

  assert(result.toolHistory.length === 1, `Expected 1 tool call, got ${result.toolHistory.length}`);
  assert(result.toolHistory[0]!.isError === true, "Expected isError=true");
});

// ── Summary ─────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
