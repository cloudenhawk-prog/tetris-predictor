import { describe, expect, test } from "vitest";
import type { BoardValueModel } from "@/application/puzzle/contracts/move-analysis";
import {
  DEFAULT_SPLIT_POLICY,
  type SplitAnalysis,
  type SplitOption,
  adviseSplit,
  searchSplits,
  shouldCheckSplits,
} from "@/application/puzzle/planning/split-search";
import { bestRescueSplit } from "@/application/puzzle/planning/move-search";
import { planMoves } from "@/application/puzzle/planning/move-planner";
import { type Block, ROWS, freeRows, isRefillRequired, reserveIds, settle, splitBlock } from "@/domain/puzzle/engine";

const B = ROWS - 1; // bottom row

// Hand-picked ids below; keep the pieces' fresh ids clear of them.
reserveIds(100);

// Bottom row filled except column 7; the 2-wide block above overhangs that gap.
const board: Block[] = [
  { id: 1, row: B, col: 0, w: 4 },
  { id: 2, row: B, col: 4, w: 3, bomb: true },
  { id: 3, row: B - 1, col: 6, w: 2 },
];
const incoming = [{ id: 40, col: 0, w: 4 }, { id: 41, col: 5, w: 3 }];
const lowStack: BoardValueModel = { evaluate: (blocks) => Math.min(...blocks.map((b) => b.row), ROWS) };

describe("splitBlock", () => {
  test("turns a block into 1-wide blocks in the same cells, keeping bombs", () => {
    const split = splitBlock(board, 2);
    const pieces = split.filter((b) => !board.some((o) => o.id === b.id));
    expect(pieces.map((b) => [b.row, b.col, b.w, b.bomb])).toEqual([
      [B, 4, 1, true],
      [B, 5, 1, true],
      [B, 6, 1, true],
    ]);
    expect(new Set(split.map((b) => b.id)).size).toBe(split.length);
  });

  test("settling a split runs gravity and clears: the overhanging half fills the gap", () => {
    const { blocks, cleared } = settle(splitBlock(board, 3));
    expect(cleared).toBe(1);
    expect(blocks.some((b) => b.row === B - 1)).toBe(false);
  });

  test("leaves 1-wide blocks as they are", () => {
    const single: Block[] = [{ id: 9, row: B, col: 0, w: 1 }];
    expect(splitBlock(single, 9)).toEqual(single);
  });
});

describe("searchSplits", () => {
  test("values every splittable block against not splitting, then refines the best", () => {
    const search = searchSplits(board, incoming, 0, lowStack, 1, { candidates: 3, depth: 2, splits: 3 });
    const first = search.next().value as SplitAnalysis;
    expect(first.baseline.block).toBeNull();
    expect(first.splits.map((s) => s.block?.id).sort()).toEqual([1, 2, 3]);
    expect(first.splits.find((s) => s.block?.id === 3)?.cleared).toBe(1);
    expect([first.baseline, ...first.splits].every((s) => s.samples === 0)).toBe(true);

    let latest = first;
    for (let i = 0; i < 3; i++) latest = search.next().value as SplitAnalysis;
    expect(latest.baseline.samples).toBe(3);
    // Splitting block 3 clears the bottom row and leaves one occupied row: the next
    // push is a forced refill, valued directly rather than searched.
    const forced = latest.splits.find((s) => s.block?.id === 3);
    expect(forced && isRefillRequired(forced.board, false)).toBe(true);
    expect(forced?.samples).toBe(0);
    expect(latest.splits.filter((s) => s.samples === 3).map((s) => s.block?.id).sort()).toEqual([1, 2]);
    for (const option of [latest.baseline, ...latest.splits]) {
      expect(option.lossRisk).toBeGreaterThanOrEqual(0);
      expect(option.lossRisk).toBeLessThanOrEqual(1);
    }
  });
});

describe("adviseSplit", () => {
  const option = (overrides: Partial<SplitOption>): SplitOption => ({
    block: { id: 1, row: B, col: 0, w: 3 },
    // Two free rows: crowded enough to consider splitting ahead of time.
    board: [{ id: 5, row: 2, col: 0, w: 1 }],
    cleared: 0,
    value: 40,
    baseValue: 40,
    lossRisk: 0,
    rescueRate: 0,
    samples: 20,
    doomed: false,
    ...overrides,
  });
  const baseline = (overrides: Partial<SplitOption>) => option({ block: null, ...overrides });
  const { splitCost, minAdvantage } = DEFAULT_SPLIT_POLICY;

  test("rescues a lost position with the best split that survives", () => {
    const advice = adviseSplit({
      baseline: baseline({ doomed: true, value: 0, lossRisk: 1, samples: 0 }),
      splits: [option({ doomed: true, value: 0 }), option({ block: { id: 2, row: B, col: 4, w: 2 }, value: 3 })],
    });
    expect(advice.kind).toBe("rescue");
    expect(advice.kind !== "none" && advice.option.block?.id).toBe(2);
  });

  test("splits ahead of time only when it beats waiting with the split kept as a last resort", () => {
    // Waiting loses half the time: splitting now (no later splits needed) wins easily.
    const losing = baseline({ value: 25, lossRisk: 0.5 });
    expect(adviseSplit({ baseline: losing, splits: [option({ value: 45 })] }).kind).toBe("preempt");
    // Waiting needs the split later in 90% of futures but then does as well: no reason to split now.
    const lastResort = baseline({ value: 45, rescueRate: 0.9 });
    expect(adviseSplit({ baseline: lastResort, splits: [option({ value: 45 })] }).kind).toBe("none");
    // Splitting now must cover its cost plus the margin, net of what waiting expects to spend.
    const edge = 40 + splitCost * (1 - 0.5) + minAdvantage;
    const halfRescued = baseline({ value: 40, rescueRate: 0.5 });
    expect(adviseSplit({ baseline: halfRescued, splits: [option({ value: edge - 0.1 })] }).kind).toBe("none");
    expect(adviseSplit({ baseline: halfRescued, splits: [option({ value: edge + 0.1 })] }).kind).toBe("preempt");
  });

  test("stays quiet when not crowded or not in trouble", () => {
    const split = option({ value: 50 });
    expect(adviseSplit({ baseline: baseline({ value: 10, lossRisk: 0.1 }), splits: [split] }).kind).toBe("none");
    const roomy = baseline({ value: 10, lossRisk: 0.9, board: [{ id: 5, row: B, col: 0, w: 1 }] });
    expect(adviseSplit({ baseline: roomy, splits: [split] }).kind).toBe("none");
  });

  test("only checks splits when every move loses or the board is crowded", () => {
    const low: Block[] = [{ id: 1, row: B, col: 0, w: 1 }];
    const high: Block[] = [{ id: 1, row: DEFAULT_SPLIT_POLICY.maxFreeRows - 1, col: 0, w: 1 }];
    expect(freeRows(high)).toBe(DEFAULT_SPLIT_POLICY.maxFreeRows - 1);
    expect(shouldCheckSplits(low, false)).toBe(false);
    expect(shouldCheckSplits(low, true)).toBe(true);
    expect(shouldCheckSplits(high, false)).toBe(true);
  });
});

describe("bestRescueSplit", () => {
  // From a simulated late game: every move tops out against this row, but a split saves it.
  const doomedBoard: Block[] = [
    [9, 0, 3], [9, 4, 1], [9, 5, 3], [8, 0, 4], [8, 5, 1], [8, 7, 1], [7, 3, 1], [7, 0, 2], [7, 2, 1],
    [7, 4, 3], [6, 0, 3], [6, 5, 3], [6, 4, 1], [5, 1, 3], [5, 6, 1], [5, 7, 1], [4, 2, 3], [4, 5, 3],
    [3, 0, 3], [3, 3, 1], [3, 5, 2], [2, 1, 3], [2, 4, 4], [1, 0, 4], [1, 4, 2], [1, 6, 1],
  ].map(([row, col, w], i) => ({ id: 200 + i, row: row!, col: col!, w: w! }));
  const row = [{ id: 300, col: 1, w: 2 }, { id: 301, col: 4, w: 3 }, { id: 302, col: 7, w: 1 }];

  test("finds the split that saves a doomed position", () => {
    expect(planMoves(doomedBoard, row, 300, lowStack, 1).every((m) => m.result.lost)).toBe(true);
    const rescue = bestRescueSplit(doomedBoard, row, 300, lowStack, 1);
    expect(rescue?.planned.result.lost).toBe(false);
  });

  test("the split check advises it as a rescue", () => {
    const analysis = searchSplits(doomedBoard, row, 300, lowStack, 1, { candidates: 3, depth: 2, splits: 2 }).next().value as SplitAnalysis;
    expect(analysis.baseline.doomed).toBe(true);
    const advice = adviseSplit(analysis);
    expect(advice.kind).toBe("rescue");
    expect(advice.kind === "rescue" && advice.option.doomed).toBe(false);
  });
});
