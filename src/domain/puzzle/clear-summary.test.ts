import { describe, expect, test } from "vitest";
import { type Block, ROWS, settleWithPhases } from "@/domain/puzzle/engine";
import { summarizeClears } from "@/domain/puzzle/clear-summary";

const B = ROWS - 1; // bottom row

describe("summarizeClears", () => {
  test("counts rows, destroyed widths and bomb blasts per cascade step", () => {
    const blocks: Block[] = [
      { id: 1, row: B, col: 0, w: 4 },
      { id: 2, row: B, col: 4, w: 3, bomb: true },
      { id: 3, row: B, col: 7, w: 1 },
      { id: 4, row: B - 1, col: 5, w: 2 }, // caught in the blast
      { id: 5, row: B - 1, col: 0, w: 1 },
    ];
    const [step, ...rest] = summarizeClears(settleWithPhases(blocks).phases);
    expect(rest).toEqual([]);
    expect(step).toEqual({ rows: 1, destroyedByWidth: [1, 1, 1, 1], destroyedByBlast: 1, bombsDetonated: 1 });
  });
});
