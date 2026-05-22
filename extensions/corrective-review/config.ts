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
}

export const DEFAULT_CONFIG: CorrectiveReviewConfig = {
  maxReviewCycles: 2,
  intentAlignment: true,
  lazyShortcuts: true,
  evidenceSupport: true,
};
