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
    // Five free rows by default would block preemptive advice; keep the stack high.
    board: [{ id: 5, row: 2, col: 0, w: 1 }],
    cleared: 0,
    value: 10,
    baseValue: 10,
    lossRisk: 0,
    samples: 20,
    doomed: false,
    ...overrides,
  });
  const baseline = (overrides: Partial<SplitOption>) => option({ block: null, ...overrides });

  test("rescues a lost position with the best split that survives", () => {
    const advice = adviseSplit({
      baseline: baseline({ doomed: true, value: 0, lossRisk: 1, samples: 0 }),
      splits: [option({ doomed: true, value: 0 }), option({ block: { id: 2, row: B, col: 4, w: 2 }, value: 3 })],
    });
    expect(advice.kind).toBe("rescue");
    expect(advice.kind !== "none" && advice.option.block?.id).toBe(2);
  });

  test("advises splitting ahead of time only when crowded, in danger and clearly better", () => {
    const danger = baseline({ value: 6, lossRisk: 0.6 });
    expect(adviseSplit({ baseline: danger, splits: [option({ value: 14, lossRisk: 0.1 })] }).kind).toBe("preempt");
    // Not enough gain.
    expect(adviseSplit({ baseline: danger, splits: [option({ value: 8, lossRisk: 0.1 })] }).kind).toBe("none");
    // Not in danger.
    expect(adviseSplit({ baseline: baseline({ value: 6, lossRisk: 0.1 }), splits: [option({ value: 14, lossRisk: 0 })] }).kind).toBe("none");
    // Not crowded.
    const roomy = baseline({ value: 6, lossRisk: 0.6, board: [{ id: 5, row: B, col: 0, w: 1 }] });
    expect(adviseSplit({ baseline: roomy, splits: [option({ value: 14, lossRisk: 0.1 })] }).kind).toBe("none");
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
