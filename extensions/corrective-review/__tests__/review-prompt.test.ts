// extensions/corrective-review/__tests__/review-prompt.test.ts

import { parseReviewVerdict } from "../review-prompt.ts";

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

// ── Basic verdict parsing ─────────────────────────────────────────────

test("parses plain PASS", () => {
  const result = parseReviewVerdict("PASS\nAll good here.");
  assert(result.verdict === "PASS", `Expected PASS, got ${result.verdict}`);
  assert(result.feedback === "PASS\nAll good here.", `Feedback should be full response`);
});

test("parses plain FAIL", () => {
  const result = parseReviewVerdict("FAIL\nLazy shortcut detected.");
  assert(result.verdict === "FAIL", `Expected FAIL, got ${result.verdict}`);
  assert(result.feedback.includes("Lazy shortcut"), "Feedback should include reason");
});

// ── Markdown formatting variants ──────────────────────────────────────

test("parses **PASS** with bold markdown", () => {
  const result = parseReviewVerdict("**PASS**\nEverything looks solid.");
  assert(result.verdict === "PASS", `Expected PASS, got ${result.verdict}`);
});

test("parses *FAIL* with italic markdown", () => {
  const result = parseReviewVerdict("*FAIL*\nMissing evidence.");
  assert(result.verdict === "FAIL", `Expected FAIL, got ${result.verdict}`);
});

test("parses ## PASS with heading markdown", () => {
  const result = parseReviewVerdict("## PASS\n\nAll checks passed.");
  assert(result.verdict === "PASS", `Expected PASS, got ${result.verdict}`);
});

test("parses **PASS:** with trailing colon", () => {
  const result = parseReviewVerdict("**PASS:** All checks passed.");
  assert(result.verdict === "PASS", `Expected PASS, got ${result.verdict}`);
});

test("parses ___FAIL___ with triple underscore", () => {
  const result = parseReviewVerdict("___FAIL___\nProblems found.");
  assert(result.verdict === "FAIL", `Expected FAIL, got ${result.verdict}`);
});

// ── Whitespace handling ───────────────────────────────────────────────

test("strips leading whitespace on first line", () => {
  const result = parseReviewVerdict("  \t  PASS\nAll good.");
  assert(result.verdict === "PASS", `Expected PASS, got ${result.verdict}`);
});

test("handles # FAIL: with hash and colon", () => {
  const result = parseReviewVerdict("# FAIL: Intent misalignment detected.");
  assert(result.verdict === "FAIL", `Expected FAIL, got ${result.verdict}`);
});

test("handles output with only empty lines before verdict", () => {
  const result = parseReviewVerdict("\n\n   \nPASS\nAll good.");
  assert(result.verdict === "PASS", `Expected PASS, got ${result.verdict}`);
});

// ── Edge cases ────────────────────────────────────────────────────────

test("defaults to FAIL for unrecognized first line", () => {
  const result = parseReviewVerdict("UNCLEAR\nNot sure what to do.");
  assert(result.verdict === "FAIL", `Expected FAIL for unrecognized, got ${result.verdict}`);
});

test("handles empty response gracefully", () => {
  const result = parseReviewVerdict("");
  assert(result.verdict === "FAIL", `Expected FAIL for empty, got ${result.verdict}`);
  assert(result.feedback === "(empty review output)", "Should indicate empty output");
});

test("handles single-line PASS without trailing newline", () => {
  const result = parseReviewVerdict("PASS");
  assert(result.verdict === "PASS", `Expected PASS, got ${result.verdict}`);
});

test("only first line matters — PASS in body doesn't flip verdict", () => {
  const result = parseReviewVerdict("FAIL\nBut the agent did pass some checks.");
  assert(result.verdict === "FAIL", "FAIL on first line should win");
});

test("case-insensitive: lowercase pass", () => {
  const result = parseReviewVerdict("pass\nall good");
  assert(result.verdict === "PASS", `Expected PASS for lowercase, got ${result.verdict}`);
});

test("case-insensitive: mixed case Pass", () => {
  const result = parseReviewVerdict("Pass\nall good");
  assert(result.verdict === "PASS", `Expected PASS for mixed case, got ${result.verdict}`);
});

// ── ANSI escape code handling ─────────────────────────────────────────

test("strips ANSI color codes: green PASS", () => {
  const result = parseReviewVerdict("\x1b[32mPASS\x1b[0m\nAll clear.");
  assert(result.verdict === "PASS", `Expected PASS, got ${result.verdict}`);
});

test("strips ANSI color codes: red FAIL", () => {
  const result = parseReviewVerdict("\x1b[31mFAIL\x1b[0m\nIntent drift.");
  assert(result.verdict === "FAIL", `Expected FAIL, got ${result.verdict}`);
});

test("strips ANSI codes with multiple escape sequences", () => {
  const result = parseReviewVerdict("\x1b[1m\x1b[32mPASS\x1b[0m\nBold green PASS.");
  assert(result.verdict === "PASS", `Expected PASS, got ${result.verdict}`);
});

test("handles output with only whitespace lines", () => {
  const result = parseReviewVerdict("   \n  \n  ");
  assert(result.verdict === "FAIL", "All whitespace should default to FAIL");
  assert(result.feedback === "(empty review output)", "Should indicate empty output");
});

// ── Summary ───────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
