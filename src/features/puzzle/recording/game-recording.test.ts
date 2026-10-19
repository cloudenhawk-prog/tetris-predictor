import { describe, expect, test } from "vitest";
import { type RecordedTurn, scoreGains } from "@/features/puzzle/recording/game-recording";

const turn = (n: number, rowsDestroyed: number, scoreAfter: number | null): RecordedTurn => ({
  index: n,
  turn: n,
  at: "",
  kind: "player",
  board: [],
  boardEdited: false,
  move: null,
  moveSource: "none",
  nextRow: [],
  nextRowRandomized: false,
  clears: [],
  rowsDestroyed,
  blocksDestroyed: [0, 0, 0, 0],
  boardAfter: [],
  lost: false,
  rowsDestroyedCounter: 0,
  scoreAfter,
});

describe("scoreGains", () => {
  test("trusts changes that match destroyed rows", () => {
    expect(scoreGains([turn(0, 0, 0), turn(1, 1, 10), turn(2, 0, 10), turn(3, 2, 35)], 0)).toEqual([
      { status: "ok", gained: 0 },
      { status: "ok", gained: 10 },
      { status: "ok", gained: 0 },
      { status: "ok", gained: 25 },
    ]);
  });

  test("an unchanged score after destroyed rows was not updated; the next change lumps turns", () => {
    expect(scoreGains([turn(0, 1, 0), turn(1, 0, 0), turn(2, 1, 30), turn(3, 1, 40)], 0).map((g) => g.status)).toEqual([
      "missing",
      "ok",
      "catch-up",
      "ok",
    ]);
  });

  test("a score left at 0 never counts as tracked points", () => {
    expect(scoreGains([turn(0, 1, 0), turn(1, 2, 0)], 0).map((g) => g.status)).toEqual(["missing", "missing"]);
  });

  test("flags changes without rows, untracked turns and gaps", () => {
    const turns = [turn(0, 0, 5), turn(1, 1, null), turn(2, 1, 20), turn(5, 1, 50)];
    expect(scoreGains(turns, 0).map((g) => g.status)).toEqual(["inconsistent", "untracked", "untracked", "gap"]);
  });
});
