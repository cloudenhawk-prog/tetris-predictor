import { describe, expect, test } from "vitest";
import { COLS } from "@/domain/puzzle/engine";
import {
  DEFAULT_ROW_GENERATION,
  createRng,
  difficultyProgress,
  generateRow,
  widthWeightsAt,
} from "@/domain/puzzle/row-generator";

describe("generateRow", () => {
  test("rows leave one or two empty cells and never overlap", () => {
    const rng = createRng(7);
    for (let i = 0; i < 2000; i++) {
      const row = generateRow(rng, i % 300);
      const cells = new Set<number>();
      for (const cell of row) {
        expect(cell.w).toBeGreaterThanOrEqual(1);
        expect(cell.w).toBeLessThanOrEqual(4);
        for (let c = cell.col; c < cell.col + cell.w; c++) {
          expect(c).toBeLessThan(COLS);
          expect(cells.has(c)).toBe(false);
          cells.add(c);
        }
      }
      expect([COLS - 1, COLS - 2]).toContain(cells.size);
    }
  });

  test("is deterministic for a seed", () => {
    const strip = (seed: number) => generateRow(createRng(seed), 0).map(({ col, w, bomb }) => ({ col, w, bomb }));
    expect(strip(3)).toEqual(strip(3));
  });

  test("larger blocks get more likely between ramp start and cap", () => {
    const { schedule } = DEFAULT_ROW_GENERATION;
    expect(difficultyProgress(0, schedule)).toBe(0);
    expect(difficultyProgress(schedule.rampEndTurn + 100, schedule)).toBe(1);
    expect(widthWeightsAt(0, schedule)).toEqual(schedule.earlyWidthWeights);
    expect(widthWeightsAt(10_000, schedule)).toEqual(schedule.lateWidthWeights);

    const meanWidth = (turn: number) => {
      const rng = createRng(11);
      const widths = Array.from({ length: 3000 }, () => generateRow(rng, turn)).flat().map((c) => c.w);
      return widths.reduce((a, b) => a + b, 0) / widths.length;
    };
    expect(meanWidth(schedule.rampEndTurn)).toBeGreaterThan(meanWidth(0) + 0.2);
  });

  test("about one bomb per 80 rows, at most one per row, never on a 4-wide block", () => {
    const rng = createRng(21);
    const rows = Array.from({ length: 40_000 }, (_, i) => generateRow(rng, i % 400));
    const bombs = rows.map((row) => row.filter((cell) => cell.bomb));
    expect(bombs.every((b) => b.length <= 1)).toBe(true);
    expect(bombs.flat().every((cell) => cell.w < 4)).toBe(true);
    const rate = bombs.filter((b) => b.length > 0).length / rows.length;
    expect(rate).toBeGreaterThan(0.8 / 80);
    expect(rate).toBeLessThan(1.2 / 80);
  });
});
