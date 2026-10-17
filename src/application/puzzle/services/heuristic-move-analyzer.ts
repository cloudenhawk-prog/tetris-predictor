import {
  type Block,
  type RowCell,
  boardStats,
  legalMoves,
  playTurn,
} from "@/domain/puzzle/engine";
import type {
  MoveScoreFeatures,
  MoveScoringModel,
  PuzzleMoveAnalyzer,
  ScoredMove,
} from "@/application/puzzle/contracts/move-analysis";
import { describeMove, describeOutcome } from "@/application/puzzle/services/describe-move";

export class HeuristicMoveAnalyzer implements PuzzleMoveAnalyzer {
  constructor(private readonly scoringModel: MoveScoringModel) {}

  evaluateMoves(blocks: Block[], incoming: RowCell[]): ScoredMove[] {
    const scored = legalMoves(blocks).map((move) => {
      const result = playTurn(blocks, move, incoming);
      const stats = boardStats(result.blocks);
      const block = blocks.find((candidate) => candidate.id === move.blockId) ?? null;

      const features: MoveScoreFeatures = {
        move,
        block,
        targetCol: block ? block.col + move.delta : -1,
        cleared: result.cleared,
        aggregateHeight: stats.aggregate,
        holes: stats.holes,
        bumpiness: stats.bumpiness,
        maxHeight: stats.maxHeight,
        lost: result.lost,
      };

      const label = describeMove(block, move);
      const rationale = result.lost
        ? "Fatal: stack reaches the top row"
        : describeOutcome(result.cleared, stats.holes, stats.maxHeight);
      const score = Math.round(this.scoringModel.score(features));

      return {
        move,
        block,
        targetCol: features.targetCol,
        score,
        scoreLabel: `${score > 0 ? "+" : ""}${score} score`,
        cleared: result.cleared,
        holes: stats.holes,
        maxHeight: stats.maxHeight,
        lost: result.lost,
        label,
        rationale,
      } satisfies ScoredMove;
    });

    return scored.sort((a, b) => b.score - a.score);
  }
}
