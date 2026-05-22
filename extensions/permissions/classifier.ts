// extensions/permissions/classifier.ts

export type RiskLevel = "low" | "medium" | "high";

export interface ClassificationResult {
  risk: RiskLevel;
  reason: string;
}

// ── Read-only bash command patterns ──
const READ_ONLY_BASH_PATTERNS = [
  /^(cat|head|tail|less|more|zcat|bzcat|zless)\s/i,
  /^(ls|dir|tree|exa|eza)\s/i,
  /^(grep|egrep|fgrep|rg|ag|ack)\s/i,
  /^(find|locate|fd)\s/i,
  /^(wc|file|stat|du|df|md5sum|sha\ds+um|cksum|xxd|od|hexdump)\s/i,
  /^(which|type|whereis|where|command\s+-v)\s/i,
  /^(pwd|echo|printf)\s/i,
  /^(whoami|id|groups|users|last|w)\s/i,
  /^(uname|hostname|date|uptime|arch)\s/i,
  /^(env|printenv|tty)\s/i,
  /^(readlink|realpath|dirname|basename)\s/i,
  /^(sort|uniq|cut|tr|sed\s+-n|awk|column|fmt|nl)\s/i,
  /^git\s+(status|diff|log|show|branch|tag|stash\s+list|remote\s+-v|rev-parse|ls-files|ls-tree|rev-list|describe|shortlog)/i,
  /^(npm|yarn|pnpm|bun)\s+(list|ls|outdated|view|info|why|explain)\b/i,
  /^docker\s+(ps|images|info|inspect|logs|stats|version)\b/i,
  /^(kubectl|k)\s+(get|describe|logs|top|explain|api-resources|api-versions|cluster-info)\b/i,
  /^(man|info|help|apropos|whatis)\s/i,
];

// ── High-risk (destructive) bash command patterns ──
const HIGH_RISK_PATTERNS = [
  /\brm\s+(-[^ ]*[rf][^ ]*|--recursive|--force)/i,
  /\bsudo\b/i,
  /\b(chmod|chown)\b.*(777|o\+w|a\+w)/i,
  /\bcurl\b.*\|.*\b(ba)?sh\b/i,
  /\bwget\b.*\|.*\b(ba)?sh\b/i,
  /\bgit\s+push\s+.*(-f|--force)/i,
  /\bgit\s+reset\s+--hard/i,
  /\b(drop|truncate|delete)\s+(database|table)/i,
  /\b(kill|pkill|killall|skill)\b/i,
  /\b(shutdown|reboot|halt|poweroff|init\s+[06])\b/i,
  /\bdd\s+if=/i,
  /\bmkfs\.\w+/i,
  /\bchroot\b/i,
  /\bmount\b.*\bremount/i,
  /\biptables\b/i,
  /\bnft\b/i,
  /\beval\b/i,
  /\bsource\s+.*\bcurl\b/i,
  /\bsh\s+-c\s+["'].*curl/i,
  /^>\s*\/dev\//i,
];

/** Check if a bash command is read-only (no side effects). */
export function isReadOnlyBash(command: string): boolean {
  const trimmed = command.trim();
  // Disallow anything with output redirection (could write files)
  if (/\d*>[>&]?\s*\S/.test(trimmed)) return false;
  return READ_ONLY_BASH_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Local heuristic classifier — no API key needed.
 * Checks patterns: high-risk → high, low-risk → low, otherwise medium.
 */
export function classifyBashCommandLocal(command: string): ClassificationResult {
  const trimmed = command.trim();

  if (HIGH_RISK_PATTERNS.some((p) => p.test(trimmed))) {
    return { risk: "high", reason: "Destructive command pattern detected" };
  }

  if (isReadOnlyBash(trimmed)) {
    return { risk: "low", reason: "Read-only command" };
  }

  return { risk: "medium", reason: "Potentially state-modifying command" };
}
