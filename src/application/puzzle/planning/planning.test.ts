import { describe, expect, test } from "vitest";
import type { BoardValueModel } from "@/application/puzzle/contracts/move-analysis";
import { moveReturn } from "@/application/puzzle/planning/return-model";
import { LookaheadMoveAnalyzer } from "@/application/puzzle/services/lookahead-move-analyzer";
import { DEFAULT_PLANNER_OPTIONS, planMoves } from "@/application/puzzle/planning/move-planner";
import { type SearchedMove, searchMoves, searchMovesFor } from "@/application/puzzle/planning/move-search";
import { type Block, ROWS, resolvePlayerMove } from "@/domain/puzzle/engine";

const B = ROWS - 1; // bottom row

const config = { discount: 0.5, survivalReward: 1, clearReward: 0 };

describe("moveReturn", () => {
  test("discounts each pushed row and bootstraps from the next decision point", () => {
    const result = { blocks: [], cleared: 0, lost: false, steps: [{ cleared: 0, lost: false }, { cleared: 0, lost: false }] };
    expect(moveReturn(result, 8, config)).toBe(1 + 0.5 + 0.25 * 8);
  });

  test("a losing move gets no reward for the losing push and no future value", () => {
    const result = { blocks: [], cleared: 0, lost: true, steps: [{ cleared: 0, lost: true }] };
    expect(moveReturn(result, 8, config)).toBe(0);
  });
});

describe("LookaheadMoveAnalyzer", () => {
  test("ranks by the value model and puts losing moves last", () => {
    // Prefers boards whose highest block sits lower (larger row index).
    const model: BoardValueModel = {
      evaluate: (blocks) => Math.min(...blocks.map((b) => b.row)),
    };
    const tower: Block[] = [
      ...Array.from({ length: B }, (_, r) => ({ id: r + 1, row: r + 1, col: 0, w: 1 })),
      { id: 20, row: B, col: 3, w: 1 },
    ];
    const ranked = new LookaheadMoveAnalyzer(model, DEFAULT_PLANNER_OPTIONS).evaluateMoves(tower, [{ id: 30, col: 0, w: 2 }], { turn: 5 });
    expect(ranked.length).toBeGreaterThan(1);
    const firstLoss = ranked.findIndex((m) => m.lost);
    expect(ranked.slice(firstLoss).every((m) => m.lost)).toBe(true);
    expect(ranked[0]?.lost).toBe(false);
    expect(ranked[0]?.scoreLabel).toBe("best value");
    expect(ranked[ranked.length - 1]?.scoreLabel).toMatch(/^−[\d.]+ vs best$/);
  });
});

describe("searchMoves", () => {
  const board: Block[] = [
    { id: 1, row: B, col: 0, w: 3 },
    { id: 2, row: B, col: 4, w: 2 },
    { id: 3, row: B - 1, col: 0, w: 2 },
    { id: 4, row: B - 1, col: 5, w: 3 },
    { id: 5, row: B - 2, col: 1, w: 1 },
  ];
  const incoming = [{ id: 40, col: 0, w: 4 }, { id: 41, col: 5, w: 3 }];
  const lowStack: BoardValueModel = { evaluate: (blocks) => Math.min(...blocks.map((b) => b.row), ROWS) };

  test("first yields the one-step ranking, then refines the top candidates", () => {
    const search = searchMoves(board, incoming, 0, lowStack, 1, { candidates: 3, depth: 2 });
    const first = search.next().value as SearchedMove[];
    expect(first.every((m) => m.samples === 0)).toBe(true);
    let latest = first;
    for (let i = 0; i < 4; i++) latest = search.next().value as SearchedMove[];
    const searched = latest.filter((m) => m.samples > 0);
    expect(searched).toHaveLength(3);
    expect(searched.every((m) => m.samples === 4)).toBe(true);
    // Searched candidates come first, and are the best one-step moves.
    expect(latest.slice(0, 3).every((m) => m.samples > 0)).toBe(true);
    const topBase = [...first].sort((a, b) => b.value - a.value).slice(0, 3).map((m) => m.baseValue);
    expect(searched.map((m) => m.baseValue).sort()).toEqual(topBase.sort());
  });

  test("is deterministic for a seed", () => {
    const run = () => searchMovesFor(3, board, incoming, 0, lowStack, 7, { candidates: 3, depth: 2 }).map((m) => [m.move, m.value]);
    expect(run()).toEqual(run());
  });
});

describe("planMoves", () => {
  test("ignores bombs in the incoming row: they are hidden until pushed", () => {
    const model: BoardValueModel = { evaluate: (blocks) => blocks.length };
    // Block 1 fills the incoming row's gap, so the pushed row clears at once and
    // a bomb in it would blast block 2, lifted right above it.
    const board: Block[] = [
      { id: 1, row: B, col: 7, w: 1 },
      { id: 2, row: B, col: 0, w: 3 },
    ];
    const values = (bomb: boolean) =>
      planMoves(board, [{ id: 10, col: 0, w: 3, ...(bomb ? { bomb } : {}) }, { id: 11, col: 3, w: 4 }], 0, model, 1).map((p) => p.value);
    expect(values(true)).toEqual(values(false));
    // With the bomb visible, the outcome would differ.
    const blast = (bomb: boolean) =>
      resolvePlayerMove(board, { blockId: 1, delta: 0 }, [{ id: 10, col: 0, w: 3, ...(bomb ? { bomb } : {}) }, { id: 11, col: 3, w: 4 }], () => []).blocks.length;
    expect(blast(true)).not.toBe(blast(false));
  });
});
