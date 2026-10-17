import type { Block, Move, RowCell } from "@/domain/puzzle/engine";

export interface ScoredMove {
  move: Move;
  block: Block | null;
  targetCol: number;
  score: number;
  /** How the score should be shown to the player. */
  scoreLabel: string;
  cleared: number;
  holes: number;
  maxHeight: number;
  lost: boolean;
  label: string;
  rationale: string;
}

export interface MoveScoreFeatures {
  move: Move;
  block: Block | null;
  targetCol: number;
  cleared: number;
  aggregateHeight: number;
  holes: number;
  bumpiness: number;
  maxHeight: number;
  lost: boolean;
}

export interface MoveScoringModel {
  score(features: MoveScoreFeatures): number;
}

export interface MoveAnalysisContext {
  /** Rows pushed so far in this game; drives the difficulty schedule. */
  turn?: number;
}

export interface PuzzleMoveAnalyzer {
  evaluateMoves(blocks: Block[], incoming: RowCell[], context?: MoveAnalysisContext): ScoredMove[];
}

/**
 * Estimates the expected discounted return from a decision point: the board is
 * settled and the player is about to see the next incoming row.
 */
export interface BoardValueModel {
  evaluate(blocks: Block[], turn: number): number;
}
