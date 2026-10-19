import type { Block, RowCell } from "@/domain/puzzle/engine";
import { type ClearStep, type WidthCounts, emptyWidthCounts } from "@/domain/puzzle/clear-summary";

/**
 * Data recorded while using the tool on a real game, to compare the real game's
 * rows (and bombs) with the generator the model is trained on.
 *
 * Boards are compact tuples: a block is `[row, col, width, bomb]` (row 0 is the
 * top, bomb is 0/1) and a Next Row cell is `[col, width, bomb]`.
 */
export const RECORDING_VERSION = 2;

export type RecordedBlock = [row: number, col: number, w: number, bomb: 0 | 1];
export type RecordedCell = [col: number, w: number, bomb: 0 | 1];

export interface RecordedMove {
  row: number;
  fromCol: number;
  toCol: number;
  w: number;
  bomb: boolean;
}

export interface RecordedTurn {
  /** Position in this session (0, 1, 2…), so gaps and reorderings are detectable. */
  index: number;
  /** Round number ("Turns survived") before this row was pushed. */
  turn: number;
  at: string;
  /** "player": a block was slid; "forced": a refill push with no move required. */
  kind: "player" | "forced";
  /** Decision-point board as entered, before the move (after any manual corrections). */
  board: RecordedBlock[];
  /** True when `board` differs from the previous turn's `boardAfter` (the board was corrected by hand). */
  boardEdited: boolean;
  move: RecordedMove | null;
  /** How the move was made: by hand, or with "Apply & advance" on a ranked move. */
  moveSource: "manual" | "applied" | "none";
  /** 1-based rank of the played move in the analysis shown at the time, if any. */
  analysisRank?: number;
  /** The analysis' top move at the time, if one was computed. */
  analysisTop?: RecordedMove;
  /** The Next Row that was pushed, bombs included. */
  nextRow: RecordedCell[];
  /** True if the Next Row came from "Random" (not from the real game). */
  nextRowRandomized: boolean;
  /** Each clear in order: first those caused by the move, then those after the push. */
  clears: Array<ClearStep & { stage: "move" | "push" }>;
  /** Rows destroyed this turn (the combo size, including cascades). */
  rowsDestroyed: number;
  /** Blocks destroyed this turn by width (1–4). */
  blocksDestroyed: WidthCounts;
  boardAfter: RecordedBlock[];
  lost: boolean;
  /** The "Rows destroyed" counter after this turn (resets on reload unless re-entered). */
  rowsDestroyedCounter: number;
  /**
   * The game's score after this turn: the Score counter when the row was pushed
   * (enter it before pushing), or null while score tracking is off. Hand-entered,
   * so it can be stale; see `scoreGains` for the per-turn points and which to trust.
   */
  scoreAfter: number | null;
}

export type RecordingEvent = { at: string } & (
  | { type: "started"; turn: number; rowsDestroyed: number; score: number | null }
  | { type: "page-loaded" }
  | { type: "turn-set"; from: number; to: number }
  | { type: "rows-destroyed-set"; from: number; to: number }
  | { type: "board-cleared" }
  | { type: "stopped" }
  /** The Score counter was edited (logged when the field loses focus), after `turnsRecorded` turns. */
  | { type: "score-set"; from: number; to: number; turnsRecorded: number }
  | { type: "score-tracking"; enabled: boolean; score: number }
);

/**
 * One recording, from pressing Record to pressing Stop. It survives page
 * reloads: a reload appends a "page-loaded" event and keeps recording into the
 * same session, so a game is not split when the tool has to be reset.
 */
export interface RecordingSession {
  version: typeof RECORDING_VERSION;
  id: string;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  turns: RecordedTurn[];
  events: RecordingEvent[];
}

export const toRecordedBlocks = (blocks: Block[]): RecordedBlock[] =>
  [...blocks]
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .map((b) => [b.row, b.col, b.w, b.bomb ? 1 : 0]);

export const toRecordedCells = (row: RowCell[]): RecordedCell[] =>
  [...row].sort((a, b) => a.col - b.col).map((c) => [c.col, c.w, c.bomb ? 1 : 0]);

export const sameRecordedBoard = (a: RecordedBlock[], b: RecordedBlock[]): boolean =>
  a.length === b.length && a.every((block, i) => block.join() === b[i]?.join());

export function newSessionId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

export function sumWidthCounts(steps: ClearStep[]): WidthCounts {
  const total = emptyWidthCounts();
  for (const step of steps) step.destroyedByWidth.forEach((n, i) => (total[i] = (total[i] ?? 0) + n));
  return total;
}

/**
 * Points scored on one turn, judged with what we know of the game: points come
 * only from destroyed rows, and destroying rows always scores.
 *
 * - "ok": `gained` is trustworthy (0 when no rows were destroyed).
 * - "missing": rows were destroyed but the score didn't change, so it wasn't updated.
 * - "catch-up": the first change after a missing update; `gained` lumps several turns.
 * - "inconsistent": the score changed without destroyed rows, or went down.
 * - "gap": turns are missing before this one (reload, re-entered round).
 * - "untracked": no score on this turn or the one before.
 */
export type ScoreGain =
  | { status: "ok" | "catch-up" | "inconsistent"; gained: number }
  | { status: "missing" | "gap" | "untracked" };

export function scoreGains(turns: RecordedTurn[], startScore: number | null = null): ScoreGain[] {
  let pending = false; // destroyed rows whose points haven't shown up in the score yet
  return turns.map((turn, i) => {
    const before = i === 0 ? startScore : (turns[i - 1]?.scoreAfter ?? null);
    const previousTurn = turns[i - 1];
    if (previousTurn && turn.turn !== previousTurn.turn + 1) {
      pending = false;
      return { status: "gap" };
    }
    if (turn.scoreAfter === null || before === null) {
      pending = false;
      return { status: "untracked" };
    }
    const gained = turn.scoreAfter - before;
    if (gained === 0) {
      if (turn.rowsDestroyed === 0) return { status: "ok", gained };
      pending = true;
      return { status: "missing" };
    }
    const status = pending ? "catch-up" : gained < 0 || turn.rowsDestroyed === 0 ? "inconsistent" : "ok";
    pending = false;
    return { status, gained };
  });
}
