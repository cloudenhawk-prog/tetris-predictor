import type { Block, RowCell } from "@/domain/puzzle/engine";
import { createRng, generateRow } from "@/domain/puzzle/row-generator";
import type { BoardValueModel } from "@/application/puzzle/contracts/move-analysis";
import {
  DEFAULT_PLANNER_OPTIONS,
  type MovePlannerOptions,
  type PlannedMove,
  planMoves,
} from "@/application/puzzle/planning/move-planner";
import { moveReturn } from "@/application/puzzle/planning/return-model";

export interface MoveSearchOptions {
  /** How many of the best one-step moves get searched deeper. */
  candidates: number;
  /** Player moves simulated after the candidate (1 = best reply to one sampled row). */
  depth: number;
}

export const DEFAULT_SEARCH_OPTIONS: MoveSearchOptions = { candidates: 6, depth: 3 };

export interface SearchedMove extends PlannedMove {
  /** One-step value from the network alone. */
  baseValue: number;
  /** Simulated futures averaged into `value` (0 = not searched). */
  samples: number;
}

/**
 * Anytime Monte Carlo lookahead from the current board. Each round samples one
 * possible future (the incoming rows after this move) and plays it out for every
 * candidate: `depth` player moves chosen greedily by the network, then valued by
 * the network. Candidates share each round's rows, so their averages compare
 * like for like. Yields the updated ranking after every round; stop iterating
 * whenever the time or sample budget runs out.
 *
 * Searched candidates rank above unsearched moves: they were the best one-step
 * moves to begin with, and their values come from a different estimator.
 */
export function* searchMoves(
  blocks: Block[],
  incoming: RowCell[],
  turn: number,
  valueModel: BoardValueModel,
  seed: number,
  options: MoveSearchOptions = DEFAULT_SEARCH_OPTIONS,
  planner: MovePlannerOptions = DEFAULT_PLANNER_OPTIONS,
): Generator<SearchedMove[], void, void> {
  const moves: SearchedMove[] = planMoves(blocks, incoming, turn, valueModel, seed, planner).map((p) => ({
    ...p,
    baseValue: p.value,
    samples: 0,
  }));
  const ranked = () =>
    [...moves].sort((a, b) =>
      a.samples > 0 !== b.samples > 0 ? (a.samples > 0 ? -1 : 1) : b.value - a.value,
    );
  yield ranked();

  const candidates = moves
    .filter((m) => !m.result.lost)
    .sort((a, b) => b.baseValue - a.baseValue)
    .slice(0, options.candidates);
  if (candidates.length < 2 || options.depth < 1) return;

  const replyPlanner: MovePlannerOptions = { ...planner, refillSamples: 1 };
  const { discount } = planner.returnConfig;
  const totals = new Map<SearchedMove, number>();

  for (let round = 0; ; round++) {
    const roundSeed = (seed ^ Math.imul(round + 1, 0x9e3779b1)) >>> 0;
    for (const candidate of candidates) {
      const rows = createRng(roundSeed);
      let board = candidate.result.blocks;
      let t = turn + candidate.result.steps.length;
      let future = 0;
      let factor = 1;
      for (let d = 0; d < options.depth; d++) {
        const replies = planMoves(board, generateRow(rows, t, planner.rowGeneration), t, valueModel, roundSeed + d, replyPlanner);
        const best = replies.reduce((a, b) => (b.value > a.value ? b : a));
        if (d === options.depth - 1 || best.result.lost) {
          future += factor * best.value;
          break;
        }
        future += factor * moveReturn(best.result, 0, planner.returnConfig);
        factor *= discount ** best.result.steps.length;
        board = best.result.blocks;
        t += best.result.steps.length;
      }
      const total = (totals.get(candidate) ?? 0) + moveReturn(candidate.result, future, planner.returnConfig);
      totals.set(candidate, total);
      candidate.samples = round + 1;
      candidate.value = total / candidate.samples;
    }
    yield ranked();
  }
}

/** Runs the search for a fixed number of rounds and returns the final ranking. */
export function searchMovesFor(
  rounds: number,
  ...args: Parameters<typeof searchMoves>
): SearchedMove[] {
  let latest: SearchedMove[] = [];
  let i = 0;
  for (const ranking of searchMoves(...args)) {
    latest = ranking;
    if (i++ >= rounds) break;
  }
  return latest;
}
