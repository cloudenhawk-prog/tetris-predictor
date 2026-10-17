import { type Block, type RowCell, boardStats } from "@/domain/puzzle/engine";
import type {
  BoardValueModel,
  MoveAnalysisContext,
  PuzzleMoveAnalyzer,
  ScoredMove,
} from "@/application/puzzle/contracts/move-analysis";
import {
  DEFAULT_PLANNER_OPTIONS,
  type MovePlannerOptions,
  type PlannedMove,
  planMoves,
} from "@/application/puzzle/planning/move-planner";
import { describeMove, describeOutcome } from "@/application/puzzle/services/describe-move";

/**
 * Ranks moves by expected return: each move is played against the known
 * incoming row (plus sampled refill rows), and the resulting position is valued
 * by a learned `BoardValueModel`.
 */
export class LookaheadMoveAnalyzer implements PuzzleMoveAnalyzer {
  constructor(
    private readonly valueModel: BoardValueModel,
    private readonly options: MovePlannerOptions = { ...DEFAULT_PLANNER_OPTIONS, refillSamples: 16 },
    private readonly seed = 0x5eed,
  ) {}

  evaluateMoves(blocks: Block[], incoming: RowCell[], context: MoveAnalysisContext = {}): ScoredMove[] {
    const planned = planMoves(blocks, incoming, context.turn ?? 0, this.valueModel, this.seed, this.options);

    return toScoredMoves(
      blocks,
      [...planned].sort((a, b) => b.value - a.value),
    );
  }
}

/**
 * Display form of planned (and optionally searched) moves, keeping their order.
 * Values are shown relative to the top move, since only differences matter.
 */
export function toScoredMoves(
  blocks: Block[],
  moves: Array<PlannedMove & { samples?: number }>,
): ScoredMove[] {
  const best = moves[0]?.value ?? 0;
  return moves.map(({ move, result, value, samples = 0 }) => {
    const block = blocks.find((candidate) => candidate.id === move.blockId) ?? null;
    const stats = boardStats(result.blocks);
    const gap = Math.round((best - value) * 10) / 10;
    const refills = result.steps.length - 1;
    return {
      move,
      block,
      targetCol: block ? block.col + move.delta : -1,
      score: Math.round(value * 10) / 10,
      scoreLabel: gap <= 0 ? "best value" : `−${gap} vs best`,
      cleared: result.cleared,
      holes: stats.holes,
      maxHeight: stats.maxHeight,
      lost: result.lost,
      label: describeMove(block, move),
      rationale: result.lost
        ? "Fatal: stack reaches the top row"
        : describeOutcome(result.cleared, stats.holes, stats.maxHeight) +
          (refills > 0 ? ` · then ${refills} refill row${refills === 1 ? "" : "s"}` : "") +
          (samples > 0 ? ` · ${samples} futures simulated` : ""),
    } satisfies ScoredMove;
  });
}
