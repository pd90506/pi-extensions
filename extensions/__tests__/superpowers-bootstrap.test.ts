// Regression tests for Pi Superpowers bootstrap alignment with upstream.

import assert from "node:assert/strict";
import createExtension from "../superpowers-bootstrap.ts";

interface HandlerRecord {
  event: string;
  handler: (...args: unknown[]) => unknown;
}

function createMockAPI(tools: Array<{ name: string }> = []): { handlers: HandlerRecord[]; api: any } {
  const handlers: HandlerRecord[] = [];
  return {
    handlers,
    api: {
      on(event: string, handler: (...args: unknown[]) => unknown) {
        handlers.push({ event, handler });
      },
      getAllTools() {
        return tools;
      },
    },
  };
}

function createMockContext() {
  const notifications: Array<{ message: string; level?: string }> = [];
  return {
    notifications,
    ctx: {
      hasUI: true,
      ui: {
        notify(message: string, level?: string) {
          notifications.push({ message, level });
        },
      },
      sessionManager: {
        buildSessionContext: () => ({ messages: [] }),
        getEntries: () => [],
      },
    } as any,
  };
}

async function getBootstrapAndNotifications() {
  const { api, handlers } = createMockAPI([{ name: "subagent" }]);
  createExtension(api);
  const { ctx, notifications } = createMockContext();

  await handlers.find((h) => h.event === "session_start")!.handler({ type: "session_start" }, ctx);
  const result = await handlers.find((h) => h.event === "before_agent_start")!.handler(
    { type: "before_agent_start", prompt: "hello" },
    ctx,
  ) as { message?: { content?: string } } | undefined;

  assert.ok(result?.message?.content, "expected bootstrap content");
  return { bootstrap: result.message.content, notifications };
}

async function main() {
  const { bootstrap, notifications } = await getBootstrapAndNotifications();

  const headerLine = bootstrap.split("\n")[1];
  assert.equal(headerLine, "You have superpowers.", "bootstrap should match upstream header exactly");
  assert.doesNotMatch(bootstrap, /You have superpowers \(/, "bootstrap should omit version");
  assert.doesNotMatch(bootstrap, /unknown/, "bootstrap should not mention unknown version");

  assert.deepEqual(notifications, [
    { message: "Superpowers loaded", level: "info" },
  ]);

  console.log("superpowers-bootstrap tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
