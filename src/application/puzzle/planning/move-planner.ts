import {
  type Block,
  type Move,
  type PlayerMoveResult,
  type RowCell,
  legalMoves,
  resolvePlayerMove,
} from "@/domain/puzzle/engine";
import {
  DEFAULT_ROW_GENERATION,
  type RowGenerationConfig,
  createRng,
  generateRow,
} from "@/domain/puzzle/row-generator";
import type { BoardValueModel } from "@/application/puzzle/contracts/move-analysis";
import {
  DEFAULT_RETURN_CONFIG,
  type ReturnConfig,
  moveReturn,
} from "@/application/puzzle/planning/return-model";

export interface MovePlannerOptions {
  returnConfig: ReturnConfig;
  rowGeneration: RowGenerationConfig;
  /** Monte Carlo samples for moves that trigger forced refill rows (unknown future rows). */
  refillSamples: number;
}

export const DEFAULT_PLANNER_OPTIONS: MovePlannerOptions = {
  returnConfig: DEFAULT_RETURN_CONFIG,
  rowGeneration: DEFAULT_ROW_GENERATION,
  refillSamples: 1,
};

export interface PlannedMove {
  move: Move;
  /** Outcome under the first refill sample (identical across samples when no refill happens). */
  result: PlayerMoveResult;
  /** Expected discounted return of playing this move. */
  value: number;
}

/**
 * Refill rows for sample `sample`. Every move sees the same rows for a given
 * sample (common random numbers), so moves are compared on equal footing.
 */
export function refillRowSource(
  seed: number,
  sample: number,
  firstTurn: number,
  config: RowGenerationConfig,
): (refillIndex: number) => RowCell[] {
  return (i) => generateRow(createRng((seed ^ (sample * 0x9e3779b1) ^ (i * 0x85ebca6b)) >>> 0), firstTurn + i, config);
}

/**
 * Scores every legal move one player-move ahead: the known incoming row is
 * played, forced refills are sampled, and the resulting decision point is valued
 * by `valueModel`. `turn` is the number of rows pushed before this move.
 */
export function planMoves(
  blocks: Block[],
  incoming: RowCell[],
  turn: number,
  valueModel: BoardValueModel,
  seed: number,
  options: MovePlannerOptions = DEFAULT_PLANNER_OPTIONS,
): PlannedMove[] {
  const evaluate = (move: Move, sample: number) => {
    const result = resolvePlayerMove(
      blocks,
      move,
      incoming,
      refillRowSource(seed, sample, turn + 1, options.rowGeneration),
    );
    const valueAfter = result.lost ? 0 : valueModel.evaluate(result.blocks, turn + result.steps.length);
    return { result, value: moveReturn(result, valueAfter, options.returnConfig) };
  };

  return legalMoves(blocks).map((move) => {
    const first = evaluate(move, 0);
    if (first.result.steps.length === 1 || options.refillSamples <= 1) return { move, ...first };
    let total = first.value;
    for (let s = 1; s < options.refillSamples; s++) total += evaluate(move, s).value;
    return { move, result: first.result, value: total / options.refillSamples };
  });
}
