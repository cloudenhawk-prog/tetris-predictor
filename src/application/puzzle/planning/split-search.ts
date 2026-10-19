import {
  type Block,
  HOLD,
  type RowCell,
  freeRows,
  isRefillRequired,
  settle,
  splitBlock,
} from "@/domain/puzzle/engine";
import type { BoardValueModel } from "@/application/puzzle/contracts/move-analysis";
import {
  DEFAULT_PLANNER_OPTIONS,
  type MovePlannerOptions,
  type PlannedMove,
  planMove,
} from "@/application/puzzle/planning/move-planner";
import {
  DEFAULT_SEARCH_OPTIONS,
  type MoveSearchOptions,
  type SearchedMove,
  searchMoves,
} from "@/application/puzzle/planning/move-search";

/** One way to use (or not use) the split power-up before this turn's move. */
export interface SplitOption {
  /** The block split, or null for not splitting (the baseline). */
  block: Block | null;
  /** The board once the split has settled: the decision point the move is played from. */
  board: Block[];
  /** Rows destroyed while the split settled. */
  cleared: number;
  /** Expected return of the best move from `board`. */
  value: number;
  /** `value` from the network alone, before any simulated futures. */
  baseValue: number;
  /**
   * Share of simulated futures lost within the lookahead, for the best move.
   * Before any futures are simulated it is 1 when every move loses at once, else 0.
   */
  lossRisk: number;
  samples: number;
  /** No move from `board` survives the known incoming row. */
  doomed: boolean;
}

export interface SplitAnalysis {
  baseline: SplitOption;
  /** Every splittable block, best first (searched ones first, see `byRank`). */
  splits: SplitOption[];
}

export interface SplitSearchOptions extends MoveSearchOptions {
  /** How many of the best splits (by the network) get simulated futures, besides the baseline. */
  splits: number;
}

export const DEFAULT_SPLIT_SEARCH_OPTIONS: SplitSearchOptions = { ...DEFAULT_SEARCH_OPTIONS, splits: 4 };

const byValue = (a: SplitOption, b: SplitOption) => b.value - a.value;

/** Searched options rank above the rest: they were the best by the network, and their values come from a different estimator. */
const byRank = (a: SplitOption, b: SplitOption) =>
  a.samples > 0 !== b.samples > 0 ? (a.samples > 0 ? -1 : 1) : byValue(a, b);

/** Value added by `option` over not splitting, compared like for like (both searched, or both network only). */
export const splitGain = (option: SplitOption, baseline: SplitOption): number =>
  option.samples > 0 && baseline.samples > 0 ? option.value - baseline.value : option.baseValue - baseline.baseValue;

function fromRanking(option: SplitOption, ranking: SearchedMove[]): void {
  const best = ranking[0];
  if (!best) return;
  option.value = best.value;
  option.samples = best.samples;
  option.doomed = ranking.every((m) => m.result.lost);
  option.lossRisk = best.samples > 0 ? best.losses / best.samples : option.doomed ? 1 : 0;
  if (best.samples === 0) option.baseValue = best.value;
}

/**
 * Which block, if any, is best to split before this turn's move. Splitting is
 * not a turn: each option's board is the split board settled at once, and is
 * valued like any decision point, by the best move against the known incoming
 * row. The first ranking is the network alone; then the baseline and the top
 * `splits` options are refined by `searchMoves` on shared sampled futures, so
 * their values and loss risks compare like for like. Iterate until the time
 * budget runs out.
 */
export function* searchSplits(
  blocks: Block[],
  incoming: RowCell[],
  turn: number,
  valueModel: BoardValueModel,
  seed: number,
  options: SplitSearchOptions = DEFAULT_SPLIT_SEARCH_OPTIONS,
  planner: MovePlannerOptions = DEFAULT_PLANNER_OPTIONS,
): Generator<SplitAnalysis, void, void> {
  const search: MoveSearchOptions = { candidates: options.candidates, depth: options.depth, searchAlone: true };
  const option = (block: Block | null): { option: SplitOption; refine?: Generator<SearchedMove[], void, void> } => {
    const settled = block ? settle(splitBlock(blocks, block.id)) : { blocks, cleared: 0 };
    const entry: SplitOption = {
      block,
      board: settled.blocks,
      cleared: settled.cleared,
      value: 0,
      baseValue: 0,
      lossRisk: 0,
      samples: 0,
      doomed: false,
    };
    // A split that empties the board leaves no choice: the next row is a forced push.
    if (isRefillRequired(settled.blocks, false)) {
      const forced: PlannedMove = planMove(settled.blocks, HOLD, incoming, turn, valueModel, seed, planner);
      Object.assign(entry, { value: forced.value, baseValue: forced.value, doomed: forced.result.lost, lossRisk: forced.result.lost ? 1 : 0 });
      return { option: entry };
    }
    const refine = searchMoves(settled.blocks, incoming, turn, valueModel, seed, search, planner);
    const first = refine.next();
    if (!first.done) fromRanking(entry, first.value);
    return { option: entry, refine };
  };

  const baseline = option(null);
  const splits = blocks.filter((b) => b.w > 1).map(option);
  const analysis = (): SplitAnalysis => ({
    baseline: { ...baseline.option },
    splits: splits.map((s) => ({ ...s.option })).sort(byRank),
  });
  yield analysis();

  const refined = [baseline, ...[...splits].sort((a, b) => byValue(a.option, b.option)).slice(0, options.splits)]
    .filter((entry) => entry.refine && !entry.option.doomed);
  while (refined.length > 0) {
    for (let i = refined.length - 1; i >= 0; i--) {
      const entry = refined[i];
      const next = entry?.refine?.next();
      if (!entry || !next || next.done) refined.splice(i, 1);
      else fromRanking(entry.option, next.value);
    }
    yield analysis();
  }
}

/**
 * When the split power-up is worth using. It is costly, so beyond rescuing a
 * lost position it is only advised when the board is crowded, in danger, and
 * the split clearly helps.
 */
export interface SplitPolicy {
  /** Only consider splitting ahead of time with fewer free rows than this above the stack. */
  maxFreeRows: number;
  /** ...when the best move without splitting loses within the lookahead at least this often... */
  minLossRisk: number;
  /** ...and the split adds at least this much value (expected discounted rows survived)... */
  minValueGain: number;
  /** ...and cuts the loss risk by at least this much. */
  minRiskDrop: number;
}

/** With the 10-row board: at most 4 free rows, i.e. the stack fills more than half the board. */
export const DEFAULT_SPLIT_POLICY: SplitPolicy = {
  maxFreeRows: 5,
  minLossRisk: 0.3,
  minValueGain: 4,
  minRiskDrop: 0.2,
};

export type SplitAdvice =
  /** No move survives the next row without a split; `option` is the best split that does. */
  | { kind: "rescue"; option: SplitOption; gain: number }
  /** Not lost yet, but in danger, and this split clearly helps. */
  | { kind: "preempt"; option: SplitOption; gain: number }
  | { kind: "none"; reason: string };

/** Whether a split analysis is worth running after a move search: every move loses, or the board is crowded. */
export function shouldCheckSplits(
  blocks: Block[],
  everyMoveLoses: boolean,
  policy: SplitPolicy = DEFAULT_SPLIT_POLICY,
): boolean {
  return everyMoveLoses || freeRows(blocks) < policy.maxFreeRows;
}

export function adviseSplit(analysis: SplitAnalysis, policy: SplitPolicy = DEFAULT_SPLIT_POLICY): SplitAdvice {
  const { baseline } = analysis;
  const best = analysis.splits.find((s) => !s.doomed);
  if (baseline.doomed) {
    return best
      ? { kind: "rescue", option: best, gain: splitGain(best, baseline) }
      : { kind: "none", reason: "No move survives the next row, with or without a split." };
  }
  if (!best) return { kind: "none", reason: "No block can be split usefully." };
  const free = freeRows(baseline.board);
  if (free >= policy.maxFreeRows) return { kind: "none", reason: `The board isn't crowded yet (${free} free rows).` };
  if (baseline.samples === 0) return { kind: "none", reason: "Danger can't be judged without think time." };
  if (baseline.lossRisk < policy.minLossRisk) {
    return { kind: "none", reason: `Not in enough danger to spend a split (${pct(baseline.lossRisk)} loss risk).` };
  }
  const gain = splitGain(best, baseline);
  const drop = baseline.lossRisk - best.lossRisk;
  if (best.samples === 0 || gain < policy.minValueGain || drop < policy.minRiskDrop) {
    return { kind: "none", reason: `In danger, but no split helps enough (best: ${signed(gain)} value, risk ${pct(baseline.lossRisk)} → ${pct(best.lossRisk)}).` };
  }
  return { kind: "preempt", option: best, gain };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const signed = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x * 10) / 10)}`;
