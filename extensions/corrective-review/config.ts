// extensions/corrective-review/config.ts

export interface CorrectiveReviewConfig {
  /** Maximum number of review→re-tool cycles per prompt cycle (default: 2). */
  maxReviewCycles: number;
  /** Enable intent alignment dimension (🎯). */
  intentAlignment: boolean;
  /** Enable lazy shortcuts dimension (🏃). */
  lazyShortcuts: boolean;
  /** Enable evidence support dimension (🧾). */
  evidenceSupport: boolean;
  /**
   * Model to use for the review subprocess.
   * Uses the current session model when not set.
   * Format: "provider/model-id" (e.g., "deepseek/deepseek-v4-pro").
   */
  reviewModel?: string;
}

export const DEFAULT_CONFIG: CorrectiveReviewConfig = {
  maxReviewCycles: 2,
  intentAlignment: true,
  lazyShortcuts: true,
  evidenceSupport: true,
};
