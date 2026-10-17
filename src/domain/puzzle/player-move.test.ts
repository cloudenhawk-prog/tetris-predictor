import { describe, expect, test } from "vitest";
import { HOLD, ROWS, type Block, type RowCell, isRefillRequired, resolvePlayerMove } from "@/domain/puzzle/engine";

const B = ROWS - 1; // bottom row

const fullRowOf = (row: number, id: number): Block[] => [
  { id, row, col: 0, w: 4 },
  { id: id + 1, row, col: 4, w: 4 },
];
let nextId = 1000;
const refillRow = (): RowCell[] => [{ id: nextId++, col: 0, w: 4 }, { id: nextId++, col: 4, w: 3 }];

describe("refill rule", () => {
  test("starts at one occupied row and continues until three", () => {
    expect(isRefillRequired([], false)).toBe(true);
    expect(isRefillRequired([{ id: 1, row: B, col: 0, w: 1 }], false)).toBe(true);
    const twoRows = [{ id: 1, row: B, col: 0, w: 1 }, { id: 2, row: B - 1, col: 0, w: 1 }];
    expect(isRefillRequired(twoRows, false)).toBe(false);
    expect(isRefillRequired(twoRows, true)).toBe(true);
  });
});

describe("resolvePlayerMove", () => {
  test("a player move without refill is a single push", () => {
    const blocks = [{ id: 1, row: B, col: 0, w: 3 }, { id: 2, row: B - 1, col: 0, w: 3 }];
    const result = resolvePlayerMove(blocks, HOLD, [{ id: 3, col: 0, w: 2 }, { id: 4, col: 3, w: 4 }], refillRow);
    expect(result.steps).toHaveLength(1);
    expect(result.lost).toBe(false);
  });

  test("clearing the board triggers refill pushes until three rows are occupied", () => {
    const result = resolvePlayerMove(fullRowOf(B, 1), HOLD, [{ id: 3, col: 0, w: 3 }], refillRow);
    expect(result.steps[0]?.cleared).toBe(1);
    expect(result.steps).toHaveLength(3);
    expect(new Set(result.blocks.map((b) => b.row)).size).toBe(3);
  });

  test("losing stops the move", () => {
    const tower: Block[] = Array.from({ length: ROWS }, (_, r) => ({ id: r + 1, row: r, col: 0, w: 1 }));
    const result = resolvePlayerMove(tower, HOLD, [{ id: 50, col: 0, w: 2 }], refillRow);
    expect(result.lost).toBe(true);
    expect(result.steps).toEqual([{ cleared: 0, lost: true }]);
  });
});
