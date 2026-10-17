import { type Block, boardStats } from "@/domain/puzzle/engine";
import type { BoardValueModel } from "@/application/puzzle/contracts/move-analysis";

/**
 * Hand-weighted board value (lower, flatter, fewer gaps is better). Fallback for
 * when the trained weights do not match the current board encoding; only
 * relative values matter for ranking moves.
 */
export class HeuristicBoardValueModel implements BoardValueModel {
  evaluate(blocks: Block[]): number {
    const stats = boardStats(blocks);
    return -(0.4 * stats.aggregate + 2.5 * stats.holes + 0.3 * stats.bumpiness + 1.2 * stats.maxHeight) / 10;
  }
}
