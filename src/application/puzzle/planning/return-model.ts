import type { PlayerMoveResult } from "@/domain/puzzle/engine";

/**
 * What the agent optimises: a reward for every row pushed without losing (plus
 * an optional bonus per cleared row), discounted per pushed row.
 */
export interface ReturnConfig {
  discount: number;
  survivalReward: number;
  clearReward: number;
}

export const DEFAULT_RETURN_CONFIG: ReturnConfig = {
  discount: 0.98,
  survivalReward: 1,
  clearReward: 0,
};

/** Upper bound of the return: surviving forever. */
export const maxReturn = (config: ReturnConfig): number =>
  (config.survivalReward + config.clearReward) / (1 - config.discount);

/**
 * Discounted return of one player move, bootstrapped with `valueAfter`, the
 * estimated value of the decision point it ends on (ignored when the move loses).
 */
export function moveReturn(result: PlayerMoveResult, valueAfter: number, config: ReturnConfig): number {
  let total = 0;
  let factor = 1;
  for (const step of result.steps) {
    if (step.lost) return total;
    total += factor * (config.survivalReward + config.clearReward * step.cleared);
    factor *= config.discount;
  }
  return total + factor * valueAfter;
}
