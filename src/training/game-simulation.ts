import {
  type Block,
  HOLD,
  type Move,
  type RowCell,
  isRefillRequired,
  legalMoves,
  playTurn,
  resolvePlayerMove,
} from "@/domain/puzzle/engine";
import { type Rng, type RowGenerationConfig, generateRow } from "@/domain/puzzle/row-generator";
import type { BoardValueModel, MoveScoringModel } from "@/application/puzzle/contracts/move-analysis";
import { HeuristicMoveAnalyzer } from "@/application/puzzle/services/heuristic-move-analyzer";
import { type MovePlannerOptions, planMoves } from "@/application/puzzle/planning/move-planner";
import { type MoveSearchOptions, searchMovesFor } from "@/application/puzzle/planning/move-search";

/** Picks a move at a decision point. `turn` is the number of rows pushed so far. */
export type Policy = (blocks: Block[], incoming: RowCell[], turn: number, rng: Rng) => Move;

export const randomPolicy: Policy = (blocks, _incoming, _turn, rng) => {
  const moves = legalMoves(blocks);
  return moves[Math.floor(rng() * moves.length)] ?? HOLD;
};

export function heuristicPolicy(model: MoveScoringModel): Policy {
  const analyzer = new HeuristicMoveAnalyzer(model);
  return (blocks, incoming) => analyzer.evaluateMoves(blocks, incoming)[0]?.move ?? HOLD;
}

export function valuePolicy(model: BoardValueModel, planner: MovePlannerOptions): Policy {
  return (blocks, incoming, turn, rng) => {
    const planned = planMoves(blocks, incoming, turn, model, Math.floor(rng() * 2 ** 32), planner);
    return pickBest(planned, rng)?.move ?? HOLD;
  };
}

/** Network plus Monte Carlo lookahead with a fixed number of sampled futures. */
export function searchPolicy(
  model: BoardValueModel,
  planner: MovePlannerOptions,
  search: MoveSearchOptions,
  rounds: number,
): Policy {
  return (blocks, incoming, turn, rng) =>
    searchMovesFor(rounds, blocks, incoming, turn, model, Math.floor(rng() * 2 ** 32), search, planner)[0]?.move ?? HOLD;
}

/** Highest value; ties broken at random so "hold" is not favoured by list order. */
export function pickBest<T extends { value: number }>(items: T[], rng: Rng): T | undefined {
  let best: T | undefined;
  let ties = 0;
  for (const item of items) {
    if (!best || item.value > best.value + 1e-9) {
      best = item;
      ties = 1;
    } else if (Math.abs(item.value - best.value) <= 1e-9 && rng() * ++ties < 1) {
      best = item;
    }
  }
  return best;
}

/** Pushes forced refill rows until the player can act (start of game or near-empty board). */
export function refillUntilPlayable(
  blocks: Block[],
  turn: number,
  rng: Rng,
  rows: RowGenerationConfig,
): { blocks: Block[]; turn: number; cleared: number; lost: boolean } {
  let refilling = false;
  let cleared = 0;
  while ((refilling = isRefillRequired(blocks, refilling))) {
    const result = playTurn(blocks, HOLD, generateRow(rng, turn, rows));
    turn++;
    cleared += result.cleared;
    blocks = result.blocks;
    if (result.lost) return { blocks, turn, cleared, lost: true };
  }
  return { blocks, turn, cleared, lost: false };
}

export interface GameResult {
  /** Rows pushed before losing (or the cap). */
  turns: number;
  cleared: number;
  lost: boolean;
  decisions: number;
}

/** Plays one full game from an empty board. */
export function playGame(policy: Policy, rng: Rng, rows: RowGenerationConfig, maxTurns: number): GameResult {
  const start = refillUntilPlayable([], 0, rng, rows);
  let { blocks, turn, cleared, lost } = start;
  let decisions = 0;
  while (!lost && turn < maxTurns) {
    const incoming = generateRow(rng, turn, rows);
    const move = policy(blocks, incoming, turn, rng);
    const firstRefillTurn = turn + 1;
    const result = resolvePlayerMove(blocks, move, incoming, (i) => generateRow(rng, firstRefillTurn + i, rows));
    decisions++;
    turn += result.steps.length;
    cleared += result.cleared;
    blocks = result.blocks;
    lost = result.lost;
  }
  return { turns: turn, cleared, lost, decisions };
}

export interface GameSummary {
  games: number;
  meanTurns: number;
  medianTurns: number;
  meanCleared: number;
  survivedToCap: number;
}

export function summarize(results: GameResult[]): GameSummary {
  const turns = results.map((r) => r.turns).sort((a, b) => a - b);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  return {
    games: results.length,
    meanTurns: mean(turns),
    medianTurns: turns[Math.floor(turns.length / 2)] ?? 0,
    meanCleared: mean(results.map((r) => r.cleared)),
    survivedToCap: results.filter((r) => !r.lost).length,
  };
}
