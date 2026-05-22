// extensions/permissions/classifier.ts
// Bash command risk classifier — uses lightweight LLM call for risk assessment

export type RiskLevel = "low" | "medium" | "high";

export interface ClassificationResult {
  risk: RiskLevel;
  reason: string;
}
