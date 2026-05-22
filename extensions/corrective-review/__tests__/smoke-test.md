# Corrective Review — Smoke Test

## Prerequisites
- pi-subagents installed: `pi install npm:pi-subagents`
- Extension registered in package.json
- Run Pi from the pi-extensions directory

## Test 1: Extension loads

Start Pi and check the session_start notification:
- Expected: "Corrective Review active · max 2 cycles" appears

## Test 2: Simple question (no tool calls → no review)

Ask: "What is 2+2?"
- Expected: Normal response, no review subagent spawned

## Test 3: Tool call triggers review

Ask: "Search the web for 'TypeScript 5.8 release date' and tell me"
- Expected: Agent does web_search, then before responding to user, corrective review subagent spawns
- If PASS: response shown to user
- If FAIL: agent re-tools with feedback

## Test 4: Lazy shortcut detection

Ask: "Find the file AGENTS.md in this project"
- Pathological case: Agent does `ls` once, no result, says "not found"
- Expected: Review subagent flags lazy shortcut (only tried ls)
- Agent should retry with find/rg

## Test 5: Max cycles enforcement

Intentionally trigger failures to verify the 2-cycle limit.
- After 2 review cycles, the response is sent regardless.
