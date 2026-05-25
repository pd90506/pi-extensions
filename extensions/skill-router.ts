import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const extensionDir = dirname(fileURLToPath(import.meta.url));
const skillRouterDir = resolve(extensionDir, "skill-router");
const planModeDir = resolve(extensionDir, "plan-mode");

export default function skillRouter(pi: ExtensionAPI): void {
	pi.on("resources_discover", async () => {
		return {
			skillPaths: [skillRouterDir, planModeDir],
		};
	});
}