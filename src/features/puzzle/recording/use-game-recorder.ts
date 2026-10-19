import { useEffect, useRef, useState } from "react";
import type { Block, Move, RowCell } from "@/domain/puzzle/engine";
import type { ClearStep } from "@/domain/puzzle/clear-summary";
import type { ScoredMove } from "@/application/puzzle/contracts/move-analysis";
import {
  RECORDING_VERSION,
  type RecordedMove,
  type RecordedTurn,
  type RecordingEvent,
  type RecordingSession,
  newSessionId,
  sameRecordedBoard,
  sumWidthCounts,
  toRecordedBlocks,
  toRecordedCells,
} from "./game-recording";
import {
  type DiskStatus,
  activeSessionId,
  deleteAllSessions,
  downloadSessions,
  listSessionIds,
  loadAllSessions,
  loadSession,
  saveSessionLocally,
  saveSessionToDisk,
  setActiveSessionId,
} from "./recording-store";

export interface TurnRecordInput {
  turn: number;
  forced: boolean;
  /** Decision-point board, before the move. */
  board: Block[];
  move: Move | null;
  moveSource: RecordedTurn["moveSource"];
  analysis: ScoredMove[] | null;
  nextRow: RowCell[];
  nextRowRandomized: boolean;
  moveClears: ClearStep[];
  pushClears: ClearStep[];
  boardAfter: Block[];
  lost: boolean;
  rowsDestroyedCounter: number;
  scoreAfter: number | null;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type EventInput = DistributiveOmit<RecordingEvent, "at">;

function toRecordedMove(board: Block[], move: Move): RecordedMove | undefined {
  const block = board.find((b) => b.id === move.blockId);
  if (!block) return undefined;
  return { row: block.row, fromCol: block.col, toCol: block.col + move.delta, w: block.w, bomb: Boolean(block.bomb) };
}

/**
 * Records real games played with the tool. The active session id lives in
 * browser storage, so recording resumes into the same session after a reload.
 */
export function useGameRecorder() {
  const [session, setSession] = useState<RecordingSession | null>(null);
  const [storedSessions, setStoredSessions] = useState(0);
  const [diskStatus, setDiskStatus] = useState<DiskStatus | null>(null);
  const [localSaveFailed, setLocalSaveFailed] = useState(false);
  const sessionRef = useRef<RecordingSession | null>(null);
  const resumedRef = useRef(false);

  const persist = (next: RecordingSession) => {
    sessionRef.current = next;
    setSession(next);
    setLocalSaveFailed(!saveSessionLocally(next));
    setStoredSessions(listSessionIds().length);
    void saveSessionToDisk(next).then(setDiskStatus);
  };

  const withEvent = (current: RecordingSession, event: EventInput): RecordingSession => {
    const at = new Date().toISOString();
    return { ...current, updatedAt: at, events: [...current.events, { ...event, at } as RecordingEvent] };
  };

  useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    setStoredSessions(listSessionIds().length);
    const id = activeSessionId();
    const resumed = id ? loadSession(id) : null;
    if (resumed && !resumed.endedAt) persist(withEvent(resumed, { type: "page-loaded" }));
    else if (id) setActiveSessionId(null);
  }, []);

  const start = (turn: number, rowsDestroyed: number, score: number | null) => {
    const now = new Date();
    const fresh: RecordingSession = {
      version: RECORDING_VERSION,
      id: newSessionId(now),
      startedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      turns: [],
      events: [],
    };
    setActiveSessionId(fresh.id);
    persist(withEvent(fresh, { type: "started", turn, rowsDestroyed, score }));
  };

  const stop = () => {
    const current = sessionRef.current;
    if (!current) return;
    const stopped = withEvent(current, { type: "stopped" });
    persist({ ...stopped, endedAt: stopped.updatedAt });
    setActiveSessionId(null);
    sessionRef.current = null;
    setSession(null);
  };

  /** Notes something that happened outside a turn (counter edits, board resets). No-op when not recording. */
  const logEvent = (event: EventInput) => {
    const current = sessionRef.current;
    if (current) persist(withEvent(current, event));
  };

  const recordTurn = (input: TurnRecordInput) => {
    const current = sessionRef.current;
    if (!current) return;
    const board = toRecordedBlocks(input.board);
    const previous = current.turns.at(-1);
    const rankIndex = input.move && input.analysis
      ? input.analysis.findIndex((m) => m.move.blockId === input.move?.blockId && m.move.delta === input.move?.delta)
      : -1;
    const top = input.analysis?.[0];
    const analysisTop = top ? toRecordedMove(input.board, top.move) : undefined;
    const clears = [
      ...input.moveClears.map((step) => ({ ...step, stage: "move" as const })),
      ...input.pushClears.map((step) => ({ ...step, stage: "push" as const })),
    ];
    const at = new Date().toISOString();
    const turn: RecordedTurn = {
      index: current.turns.length,
      turn: input.turn,
      at,
      kind: input.forced && !input.move ? "forced" : "player",
      board,
      boardEdited: previous ? !sameRecordedBoard(previous.boardAfter, board) : false,
      move: input.move ? (toRecordedMove(input.board, input.move) ?? null) : null,
      moveSource: input.move ? input.moveSource : "none",
      ...(rankIndex >= 0 ? { analysisRank: rankIndex + 1 } : {}),
      ...(analysisTop ? { analysisTop } : {}),
      nextRow: toRecordedCells(input.nextRow),
      nextRowRandomized: input.nextRowRandomized,
      clears,
      rowsDestroyed: clears.reduce((sum, step) => sum + step.rows, 0),
      blocksDestroyed: sumWidthCounts(clears),
      boardAfter: toRecordedBlocks(input.boardAfter),
      lost: input.lost,
      rowsDestroyedCounter: input.rowsDestroyedCounter,
      scoreAfter: input.scoreAfter,
    };
    persist({ ...current, updatedAt: at, turns: [...current.turns, turn] });
  };

  const exportAll = () => downloadSessions(loadAllSessions());

  const clearAll = () => {
    if (sessionRef.current) return;
    deleteAllSessions();
    setStoredSessions(0);
    setDiskStatus(null);
  };

  return { session, recording: session !== null, storedSessions, diskStatus, localSaveFailed, start, stop, logEvent, recordTurn, exportAll, clearAll };
}

export type GameRecorder = ReturnType<typeof useGameRecorder>;
