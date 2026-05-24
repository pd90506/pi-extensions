import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const extensionDir = dirname(fileURLToPath(import.meta.url));
const policyPath = resolve(extensionDir, "../references/intent-plan-policy.md");
const trackerPolicyPath = resolve(extensionDir, "../references/intent-plan-tracker-policy.md");

function runtimePrompt(): string {
	return `# Intent and Plan Discipline (soft policy)

A global intent/plan policy extension is active. This is a soft behavioral policy, not a hard tool gate.

Core behavior:
- First distinguish whether the user is asking a question, giving a clear trivial execution command, or giving an ambiguous/non-trivial/high-impact execution request.
- For question-only prompts, answer directly. Do not treat advice/explanation questions as permission to modify files.
- For clear trivial execution requests, act directly and keep process narration minimal.
- For ambiguous, non-trivial, or high-impact execution requests, classify as Tier 3: do limited read-only exploration if useful, then stop with an inline plan and wait for explicit user approval before making changes.
- If there is any doubt between Tier 2 and Tier 3, choose Tier 3.
- For Tier 3, you MUST read the detailed classification policy before planning, exploring deeply, or executing: ${policyPath}
- After a Tier 3 plan, do not execute until the user clearly approves. Follow-up questions, requests for alternatives, or discussion of tradeoffs are not approval.
- After approval, follow the approved plan. Small implementation details may be adjusted, but material scope/architecture/API/dependency/data-model/UX/risk changes require stopping for confirmation again.
- For approved complex tasks only, read the tracker policy before creating/updating .pi/plans/<intent-slug>.md: ${trackerPolicyPath}

Only explicitly mention intent classification for Tier 3 or ambiguous cases. Do not be verbose for simple questions or trivial tasks.`;
}

function showStatus(ctx: ExtensionContext, enabled: boolean): void {
	ctx.ui.notify(`intent-plan discipline is ${enabled ? "on" : "off"} for this session.`, "info");
}

export default function intentPlanDiscipline(pi: ExtensionAPI): void {
	let enabled = true;

	pi.registerFlag("no-intent-plan", {
		description: "Disable the intent/plan discipline policy for this session",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("intent-plan", {
		description: "Manage intent/plan discipline for this session: /intent-plan on|off|status",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();

			if (action === "on" || action === "enable") {
				enabled = true;
				showStatus(ctx, enabled);
				return;
			}

			if (action === "off" || action === "disable") {
				enabled = false;
				showStatus(ctx, enabled);
				return;
			}

			if (action === "" || action === "status") {
				showStatus(ctx, enabled);
				ctx.ui.notify(`Detailed policy: ${policyPath}`, "info");
				ctx.ui.notify(`Tracker policy: ${trackerPolicyPath}`, "info");
				return;
			}

			ctx.ui.notify("Usage: /intent-plan on | off | status", "warning");
		},
	});

	pi.on("session_start", async (_event, _ctx) => {
		enabled = pi.getFlag("no-intent-plan") !== true;
	});

	pi.on("before_agent_start", async (event) => {
		if (!enabled) return;

		return {
			systemPrompt: `${event.systemPrompt}\n\n${runtimePrompt()}`,
		};
	});
}
