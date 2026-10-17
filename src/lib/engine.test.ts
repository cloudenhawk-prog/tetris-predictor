import { describe, expect, test } from "vitest";
import { ROWS, gravity, legalMoves, playTurn, pushUp, settleWithPhases, type Block } from "@/domain/puzzle/engine";

const B = ROWS - 1; // bottom row

describe("existing puzzle rules", () => {
  test("blocks fall independently to the floor", () => {
    expect(gravity([{ id: 1, row: 0, col: 0, w: 2 }, { id: 2, row: 4, col: 3, w: 1 }]).map(b => b.row)).toEqual([B, B]);
  });
  test("an incoming row lifts only touching stacks and preserves identities", () => {
    const board = [{ id: 1, row: B, col: 0, w: 2 }, { id: 2, row: B - 1, col: 0, w: 1 }, { id: 3, row: B, col: 4, w: 1 }];
    const result = pushUp(board, [{ id: 4, col: 0, w: 2 }]);
    expect(result.blocks.map(b => [b.id, b.row])).toEqual([[1, B - 1], [2, B - 2], [3, B], [4, B]]);
    expect(board[0]?.row).toBe(B);
  });
  test("full rows are deleted simultaneously", () => {
    const blocks = [B - 1, B].flatMap(row => [{ id: row * 2, row, col: 0, w: 4 }, { id: row * 2 + 1, row, col: 4, w: 4 }]);
    const result = settleWithPhases(blocks);
    expect(result.cleared).toBe(2);
    expect(result.phases.filter(p => p.kind === "clear")).toHaveLength(1);
    expect(result.blocks).toEqual([]);
  });
  test("bomb chains destroy edge-touching blocks but not corners", () => {
    const blocks: Block[] = [{ id: 1, row: B, col: 0, w: 4, bomb: true }, { id: 2, row: B, col: 4, w: 4 }, { id: 3, row: B - 1, col: 3, w: 1, bomb: true }, { id: 4, row: B - 2, col: 3, w: 1 }, { id: 5, row: B - 1, col: 5, w: 1 }];
    const result = settleWithPhases(blocks);
    expect(result.phases.find(p => p.kind === "clear")?.removedIds.sort()).toEqual([1, 2, 3, 4]);
    expect(result.blocks.map(b => b.id)).toEqual([5]);
  });
  test("moves cannot pass through another block", () => {
    const moves = legalMoves([{ id: 1, row: B, col: 0, w: 2 }, { id: 2, row: B, col: 4, w: 2 }]);
    expect(moves.filter(m => m.blockId === 1).map(m => m.delta)).toEqual([1, 2]);
  });
  test("staying put is not a legal move", () => {
    const moves = legalMoves([{ id: 1, row: B, col: 0, w: 2 }]);
    expect(moves.every(m => m.blockId === 1 && m.delta !== 0)).toBe(true);
    expect(legalMoves([])).toEqual([]);
  });
  test("a turn clears the existing board before pushing the incoming row", () => {
    const result = playTurn([{ id: 1, row: B, col: 0, w: 4 }, { id: 2, row: B, col: 4, w: 4 }], { blockId: -1, delta: 0 }, [{ id: 3, col: 0, w: 3 }, { id: 4, col: 4, w: 3 }]);
    expect(result.cleared).toBe(1);
    expect(result.blocks.map(b => [b.id, b.row])).toEqual([[3, B], [4, B]]);
    expect(result.lost).toBe(false);
  });
});
