import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Bomb, Eraser, MoveHorizontal, Scissors } from "lucide-react";
import { COLS, ROWS, type Block, type Move, type RowCell, applyMove as engineApplyMove, blockAt, canPlace, canPlaceRun, isRefillRequired, newId, occupiedRowCount, pushUp, settleWithPhases, splitBlock } from "@/domain/puzzle/engine";
import { generateRow } from "@/domain/puzzle/row-generator";
import { summarizeClears } from "@/domain/puzzle/clear-summary";
import type { ScoredMove } from "@/application/puzzle/contracts/move-analysis";
import { DEFAULT_SPLIT_SEARCH_OPTIONS, type SplitAdvice, type SplitAnalysis, adviseSplit, shouldCheckSplits } from "@/application/puzzle/planning/split-search";
import { MoveSearchClient } from "@/infrastructure/puzzle/search-worker/move-search-client";
import { sameRecordedBoard, toRecordedBlocks } from "./recording/game-recording";
import { type TurnRecordInput, useGameRecorder } from "./recording/use-game-recorder";

const CLEAR_MS = 1100;
const CLEAR_GAP_MS = 450;
export const LIFT_MS = 1000;
export const ROWS_PER_SECOND = 3;
// Danger can't be judged without simulated futures, whatever the Think time setting.
const SPLIT_MIN_THINK_MS = 2000;
// Wait for the board and Next Row to stop changing before checking for danger.
const SPLIT_CHECK_DELAY_MS = 700;

type Tool = "draw" | "erase" | "bomb" | "split";
type DragState = {
  zone: "board" | "next";
  row: number;
  start: number;
  end: number;
  blockId?: number;
  grabOffset?: number;
  locked?: boolean;
};
type HoverState = { zone: DragState["zone"]; row: number; col: number };
type MotionBlock = Block & { travelRows: number; motion: "fall" | "lift" };
export type SearchSettings = { thinkSeconds: number; depth: number; candidates: number };
export const DEFAULT_SEARCH_SETTINGS: SearchSettings = { thinkSeconds: 2, depth: 3, candidates: 6 };
type SearchProgress = { samples: number; elapsedMs: number; thinkMs: number; done: boolean; warning?: string };
/** The danger check: whether to use the split power-up before this turn's move. */
type SplitCheck = SearchProgress & { analysis: SplitAnalysis | null; advice: SplitAdvice | null };

const TRACK_SCORE_KEY = "tetris-predictor.recording.track-score";

const moveKey = (move: ScoredMove["move"]) => `${move.blockId}:${move.delta}`;

/** How the turn about to be played was reached, for the recorder. */
type TurnOrigin = Pick<TurnRecordInput, "board" | "move" | "moveSource">;

export function usePuzzleWorkbench() {
  // Search runs in a worker (which also holds the model weights) so the UI stays responsive.
  const searchRef = useRef<MoveSearchClient | null>(null);
  const searchClient = () => (searchRef.current ??= new MoveSearchClient());
  useEffect(() => {
    searchClient().warmUp();
    return () => searchRef.current?.dispose();
  }, []);
  const [searchSettings, setSearchSettings] = useState<SearchSettings>(DEFAULT_SEARCH_SETTINGS);
  const [searchProgress, setSearchProgress] = useState<SearchProgress | null>(null);
  const [splitCheck, setSplitCheck] = useState<SplitCheck | null>(null);
  const selectedKeyRef = useRef<string | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [nextRow, setNextRow] = useState<RowCell[]>([]);
  const [tool, setTool] = useState<Tool>("draw");
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hovered, setHovered] = useState<HoverState | null>(null);
  const [analysis, setAnalysis] = useState<ScoredMove[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [turnsSurvived, setTurnsSurvived] = useState(0);
  const [status, setStatus] = useState<"ready" | "lost">("ready");
  const [rowsDestroyed, setRowsDestroyed] = useState(0);
  const [refilling, setRefilling] = useState(false);
  const [movedThisTurn, setMovedThisTurn] = useState<{ id: number; originCol: number } | null>(null);
  const [animating, setAnimating] = useState(false);
  const [removingIds, setRemovingIds] = useState<number[]>([]);
  const [motionBlocks, setMotionBlocks] = useState<MotionBlock[]>([]);
  const [lifting, setLifting] = useState(false);
  const [nextRowRandomized, setNextRowRandomized] = useState(false);
  // The real game's score, kept up to date by hand while recording with score tracking on.
  const [score, setScore] = useState(0);
  const committedScoreRef = useRef(0);
  const [trackScore, setTrackScore] = useState(false);
  useEffect(() => {
    try {
      setTrackScore(localStorage.getItem(TRACK_SCORE_KEY) === "1");
    } catch {
      // Defaults to off.
    }
  }, []);
  const recorder = useGameRecorder();
  // The latest analysis and the board it was computed for, kept through a manual
  // slide so the recorder can note where the played move ranked.
  const analysisForRef = useRef<{ board: Block[]; moves: ScoredMove[] } | null>(null);

  const nextFilled = nextRow.reduce((a, r) => a + r.w, 0);
  const nextValid = nextFilled === COLS - 1 || nextFilled === COLS - 2;
  // Staying put is not a move: a block must have moved, unless this push is forced
  // (refilling, or the board is too empty to act on).
  const forcedPush = refilling || occupiedRowCount(blocks) <= 1;
  const canAdvance = nextValid && status !== "lost" && (forcedPush || movedThisTurn !== null);
  const ranked = useMemo(() => analysis?.slice(0, 6) ?? [], [analysis]);
  const preview = ranked[selected] ?? null;
  const dragPreview = useMemo(() => {
    if (!drag || drag.blockId !== undefined || tool !== "draw") return null;
    const col = Math.min(drag.start, drag.end);
    const width = Math.abs(drag.end - drag.start) + 1;
    const valid =
      drag.zone === "board"
        ? canPlace(blocks, drag.row, col, width)
        : canPlaceRun(nextRow, col, width) && nextFilled + width <= COLS - 1;
    return { ...drag, col, width, valid };
  }, [blocks, drag, nextRow, tool, nextFilled]);
  const movePreview = useMemo(() => {
    if (!drag || drag.blockId === undefined || drag.locked) return null;
    const pool: Block[] =
      drag.zone === "board" ? blocks : nextRow.map((cell) => ({ ...cell, row: 0 }));
    const block = pool.find((candidate) => candidate.id === drag.blockId);
    if (!block) return null;
    const siblings = pool.filter(
      (candidate) => candidate.id !== block.id && candidate.row === block.row,
    );
    const left = siblings.reduce(
      (boundary, candidate) =>
        candidate.col + candidate.w <= block.col
          ? Math.max(boundary, candidate.col + candidate.w)
          : boundary,
      0,
    );
    const right = siblings.reduce(
      (boundary, candidate) =>
        candidate.col >= block.col + block.w ? Math.min(boundary, candidate.col) : boundary,
      COLS,
    );
    const requested = drag.end - (drag.grabOffset ?? 0);
    const targetCol = Math.max(left, Math.min(right - block.w, requested));
    return { block, targetCol, zone: drag.zone };
  }, [blocks, drag, nextRow]);
  const hoveredBoardBlock =
    hovered?.zone === "board" ? blockAt(blocks, hovered.row, hovered.col) : undefined;
  const hoveredNextBlock =
    hovered?.zone === "next"
      ? nextRow.find((cell) => hovered.col >= cell.col && hovered.col < cell.col + cell.w)
      : undefined;
  const HoverToolIcon = tool === "draw" ? MoveHorizontal : tool === "erase" ? Eraser : tool === "bomb" ? Bomb : Scissors;
  // Splitting comes before the move; with a block already slid, its origin would be lost.
  const canSplit = !animating && status !== "lost" && !refilling && movedThisTurn === null;

  const resetAnalysis = () => {
    searchRef.current?.cancel();
    setSearchProgress(null);
    setSplitCheck(null);
    setAnalysis(null);
    setSelected(0);
    selectedKeyRef.current = null;
  };

  const selectMove = (index: number) => {
    setSelected(index);
    const entry = analysis?.[index];
    selectedKeyRef.current = entry ? moveKey(entry.move) : null;
  };

  const pause = (duration: number) => new Promise((resolve) => setTimeout(resolve, duration));

  const runSettleAnimation = async (source: Block[]) => {
    const result = settleWithPhases(source);
    let current = source;
    for (const phase of result.phases) {
      if (phase.kind === "gravity") {
        const falling = phase.blocks.flatMap((target) => {
          const origin = current.find((block) => block.id === target.id);
          const travelRows = origin ? target.row - origin.row : 0;
          return travelRows > 0 ? [{ ...target, travelRows, motion: "fall" as const }] : [];
        });
        const longestFall = Math.max(...falling.map((block) => block.travelRows), 0);
        setMotionBlocks(falling);
        await pause((longestFall / ROWS_PER_SECOND) * 1000);
        current = phase.blocks;
        setBlocks(current);
        setMotionBlocks([]);
        await pause(120);
      } else {
        setRemovingIds(phase.removedIds);
        await pause(CLEAR_MS);
        current = current.filter((b) => !phase.removedIds.includes(b.id));
        setBlocks(current);
        setRemovingIds([]);
        await pause(CLEAR_GAP_MS);
      }
    }
    setBlocks(result.blocks);
    return result;
  };

  const commitBoardDrag = (row: number, startCol: number, endCol: number) => {
    resetAnalysis();
    setStatus("ready");
    const hit = blockAt(blocks, row, startCol);
    if (hit && startCol !== endCol) {
      if (!movePreview || movePreview.targetCol === movePreview.block.col) return;
      const origin = movedThisTurn ?? { id: movePreview.block.id, originCol: movePreview.block.col };
      setMovedThisTurn(movePreview.targetCol === origin.originCol ? null : origin);
      setBlocks(
        blocks.map((block) =>
          block.id === movePreview.block.id ? { ...block, col: movePreview.targetCol } : block,
        ),
      );
      return;
    }
    if (tool === "erase") {
      if (hit) {
        setBlocks(blocks.filter((b) => b.id !== hit.id));
        if (movedThisTurn?.id === hit.id) setMovedThisTurn(null);
      }
      return;
    }
    if (tool === "bomb") {
      if (hit) setBlocks(blocks.map((b) => (b.id === hit.id ? { ...b, bomb: !b.bomb } : b)));
      return;
    }
    if (tool === "split") {
      if (hit) void splitAt(hit.id, "manual");
      return;
    }
    const start = Math.min(startCol, endCol);
    const width = Math.min(4, Math.abs(endCol - startCol) + 1);
    if (!canPlace(blocks, row, start, width)) return;
    setBlocks([...blocks, { id: newId(), row, col: start, w: width }]);
  };

  const commitNextDrag = (startCol: number, endCol: number) => {
    resetAnalysis();
    const hit = nextRow.find((r) => startCol >= r.col && startCol < r.col + r.w);
    if (hit && startCol !== endCol) {
      if (!movePreview || movePreview.targetCol === hit.col) return;
      setNextRow(nextRow.map((r) => (r.id === hit.id ? { ...r, col: movePreview.targetCol } : r)));
      return;
    }
    if (tool === "erase") {
      if (hit) setNextRow(nextRow.filter((r) => r !== hit));
      return;
    }
    if (tool === "bomb") {
      if (hit) setNextRow(nextRow.map((r) => (r === hit ? { ...r, bomb: !r.bomb } : r)));
      return;
    }
    const start = Math.min(startCol, endCol);
    const width = Math.min(4, Math.abs(endCol - startCol) + 1);
    if (!canPlaceRun(nextRow, start, width) || nextFilled + width > COLS - 1) return;
    setNextRow([...nextRow, { id: newId(), col: start, w: width }]);
  };

  const startDrag = (zone: DragState["zone"], row: number, col: number) => {
    if (animating) return;
    if (zone === "board" && refilling) return;
    const hit =
      zone === "board"
        ? blockAt(blocks, row, col)
        : nextRow.find((r) => col >= r.col && col < r.col + r.w);
    {
      if (hit) {
        setDrag({
          zone,
          row,
          start: col,
          end: col,
          blockId: hit.id,
          grabOffset: col - hit.col,
          locked:
            zone === "board" &&
            (!nextValid || (movedThisTurn !== null && movedThisTurn.id !== hit.id)),
        });
        return;
      }
    }
    setDrag({ zone, row, start: col, end: col });
  };

  const extendDrag = (zone: DragState["zone"], row: number, col: number) => {
    setDrag((current) => {
      if (!current || current.zone !== zone || current.row !== row) return current;
      if (current.blockId !== undefined) return { ...current, end: col };
      const delta = Math.max(-3, Math.min(3, col - current.start));
      return { ...current, end: current.start + delta };
    });
  };

  const finishDrag = () => {
    if (!drag) return;
    if (drag.zone === "board") commitBoardDrag(drag.row, drag.start, drag.end);
    else commitNextDrag(drag.start, drag.end);
    setDrag(null);
  };

  const trackPointer = (
    event: PointerEvent<HTMLDivElement>,
    zone: DragState["zone"],
  ) => {
    if (!drag || drag.zone !== zone) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const col = Math.max(0, Math.min(COLS - 1, Math.floor(((event.clientX - rect.left) / rect.width) * COLS)));
    const row =
      zone === "board"
        ? Math.max(0, Math.min(ROWS - 1, Math.floor(((event.clientY - rect.top) / rect.height) * ROWS)))
        : 0;
    extendDrag(zone, row, col);
  };

  /** `board` defaults to the shown board; pass it when the state hasn't caught up yet (right after a split). */
  const compute = (board: Block[] = blocks) => {
    if (!nextValid) return;
    const thinkMs = searchSettings.thinkSeconds * 1000;
    selectedKeyRef.current = null;
    setSelected(0);
    setSplitCheck(null);
    setSearchProgress({ samples: 0, elapsedMs: 0, thinkMs, done: false });
    const analyzed = { board, moves: [] as ScoredMove[] };
    analysisForRef.current = analyzed;
    searchClient().search(
      { blocks: board, incoming: nextRow, turn: turnsSurvived, thinkMs, depth: searchSettings.depth, candidates: searchSettings.candidates },
      (update) => {
        if (update.moves.length > 0) {
          analyzed.moves = update.moves;
          setAnalysis(update.moves);
          // Keep the player's chosen move selected while the ranking shifts.
          const key = selectedKeyRef.current;
          const index = key ? update.moves.findIndex((m) => moveKey(m.move) === key) : -1;
          setSelected(index >= 0 ? index : 0);
        }
        setSearchProgress({ samples: update.samples, elapsedMs: update.elapsedMs, thinkMs, done: update.done, warning: update.warning });
        // Danger check: when no move survives, or the board is crowded, look for a split worth using.
        const everyMoveLoses = analyzed.moves.length > 0 && analyzed.moves.every((m) => m.lost);
        if (update.done && analyzed.moves.length > 0 && shouldCheckSplits(board, everyMoveLoses)) checkSplits(board);
      },
    );
  };

  /** Values splitting each block before this turn's move against not splitting (see `searchSplits`). */
  const checkSplits = (board: Block[] = blocks) => {
    const thinkMs = Math.max(SPLIT_MIN_THINK_MS, searchSettings.thinkSeconds * 1000);
    setSplitCheck({ samples: 0, elapsedMs: 0, thinkMs, done: false, analysis: null, advice: null });
    searchClient().searchSplits(
      {
        blocks: board,
        incoming: nextRow,
        turn: turnsSurvived,
        thinkMs,
        depth: searchSettings.depth,
        candidates: searchSettings.candidates,
        splits: DEFAULT_SPLIT_SEARCH_OPTIONS.splits,
      },
      (update) => {
        setSplitCheck({
          samples: update.samples,
          elapsedMs: update.elapsedMs,
          thinkMs,
          done: update.done,
          warning: update.warning,
          analysis: update.analysis,
          // Judged on the final numbers only, so the advice doesn't flicker while samples come in.
          advice: update.done && update.analysis ? adviseSplit(update.analysis) : null,
        });
      },
    );
  };

  // Danger check on its own: once a crowded board and a valid Next Row are entered,
  // look for a split worth using, unless a search is already running or done.
  const idleForSplitCheck = canSplit && nextValid && !forcedPush && splitCheck === null && searchProgress === null;
  useEffect(() => {
    if (!idleForSplitCheck || !shouldCheckSplits(blocks, false)) return;
    const timer = setTimeout(() => checkSplits(blocks), SPLIT_CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [idleForSplitCheck, blocks, nextRow, turnsSurvived]);

  /** Shown only when the check advises splitting: no move survives, or splitting now clearly beats waiting. */
  const splitAdvice = splitCheck?.done && splitCheck.advice && splitCheck.advice.kind !== "none" ? splitCheck.advice : null;
  const dismissSplitAdvice = () =>
    setSplitCheck((current) => (current ? { ...current, advice: { kind: "none", reason: "Dismissed." } } : current));

  /**
   * The split power-up: the block becomes 1-wide blocks and the board settles at
   * once (gravity and clears until stable). Not a turn: the round doesn't advance
   * and a move is still required. A split taken from the analysis re-runs it on
   * the new board.
   */
  const splitAt = async (blockId: number, source: "manual" | "advised") => {
    const block = blocks.find((b) => b.id === blockId);
    if (!canSplit || !block || block.w <= 1) return;
    resetAnalysis();
    setAnimating(true);
    setDrag(null);
    setHovered(null);
    const pieces = splitBlock(blocks, blockId);
    setBlocks(pieces);
    await pause(350);
    const settled = await runSettleAnimation(pieces);
    const rowsDestroyedCounter = rowsDestroyed + settled.cleared;
    setRowsDestroyed(rowsDestroyedCounter);
    recorder.logEvent({
      type: "block-split",
      turn: turnsSurvived,
      turnsRecorded: recorder.session?.turns.length ?? 0,
      block: [block.row, block.col, block.w, block.bomb ? 1 : 0],
      source,
      clears: summarizeClears(settled.phases),
      boardAfter: toRecordedBlocks(settled.blocks),
      rowsDestroyedCounter,
    });
    const needsRefill = isRefillRequired(settled.blocks, false);
    setRefilling(needsRefill);
    setAnimating(false);
    if (source === "advised" && !needsRefill && nextValid) compute(settled.blocks);
  };

  const stopSearch = () => {
    searchRef.current?.cancel();
    setSearchProgress((current) => (current ? { ...current, done: true } : current));
    setSplitCheck((current) =>
      current && !current.done
        ? { ...current, done: true, advice: current.analysis ? adviseSplit(current.analysis) : null }
        : current,
    );
  };

  /** Apply the analyzed move, then play the turn: one click per player move. */
  const applyMove = async (entry: ScoredMove) => {
    if (animating || !nextValid || status === "lost") return;
    searchRef.current?.cancel();
    setAnimating(true);
    const moved = engineApplyMove(blocks, entry.move);
    setBlocks(moved);
    await pause(650);
    await runTurn(moved, { board: blocks, move: entry.move, moveSource: "applied" });
  };

  const advanceTurn = async () => {
    if (animating || !canAdvance) return;
    const moved = movedThisTurn ? blocks.find((b) => b.id === movedThisTurn.id) : undefined;
    if (!moved || !movedThisTurn) {
      await runTurn(blocks, { board: blocks, move: null, moveSource: "none" });
      return;
    }
    const board = blocks.map((b) => (b.id === moved.id ? { ...b, col: movedThisTurn.originCol } : b));
    const move: Move = { blockId: moved.id, delta: moved.col - movedThisTurn.originCol };
    await runTurn(blocks, { board, move, moveSource: "manual" });
  };

  const analysisFor = (board: Block[]) => {
    const analyzed = analysisForRef.current;
    return analyzed && analyzed.moves.length > 0 && sameRecordedBoard(toRecordedBlocks(analyzed.board), toRecordedBlocks(board))
      ? analyzed.moves
      : null;
  };

  /** settle -> push the next row -> settle, animated, starting from `source`. */
  const runTurn = async (source: Block[], origin: TurnOrigin) => {
    const shownAnalysis = analysisFor(origin.board);
    const pushedRow = nextRow;
    resetAnalysis();
    setAnimating(true);
    setDrag(null);
    setHovered(null);
    const first = await runSettleAnimation(source);
    const stableBlocks = first.blocks;
    const pushed = pushUp(stableBlocks, nextRow);
    const lifted = pushed.blocks.flatMap((target) => {
      const origin = stableBlocks.find((block) => block.id === target.id);
      if (!origin) return [{ ...target, travelRows: 1, motion: "lift" as const }];
      return origin.row !== target.row
        ? [{ ...target, travelRows: 1, motion: "lift" as const }]
        : [];
    });
    setBlocks(stableBlocks);
    setMotionBlocks(lifted);
    setLifting(true);
    await pause(LIFT_MS);
    setBlocks(pushed.blocks);
    setNextRow([]);
    setMotionBlocks([]);
    setLifting(false);
    await pause(160);
    const second = await runSettleAnimation(pushed.blocks);
    setMovedThisTurn(null);
    const rowsDestroyedCounter = rowsDestroyed + first.cleared + second.cleared;
    setRowsDestroyed(rowsDestroyedCounter);
    setTurnsSurvived((current) => current + 1);
    const lost = pushed.overflow || second.blocks.some((b) => b.row === 0);
    recorder.recordTurn({
      turn: turnsSurvived,
      forced: forcedPush,
      ...origin,
      analysis: shownAnalysis,
      nextRow: pushedRow,
      nextRowRandomized,
      moveClears: summarizeClears(first.phases),
      pushClears: summarizeClears(second.phases),
      boardAfter: second.blocks,
      lost,
      rowsDestroyedCounter,
      scoreAfter: trackScore ? score : null,
    });
    setNextRowRandomized(false);
    analysisForRef.current = null;
    setRefilling(!lost && isRefillRequired(second.blocks, refilling));
    setStatus(lost ? "lost" : "ready");
    resetAnalysis();
    setAnimating(false);
  };

  const counterValue = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);

  const setTurn = (turn: number) => {
    resetAnalysis();
    const to = counterValue(turn);
    if (to !== turnsSurvived) recorder.logEvent({ type: "turn-set", from: turnsSurvived, to });
    setTurnsSurvived(to);
  };

  /** Editable so the counter can be restored after a page reload. */
  const setRowsDestroyedCount = (count: number) => {
    const to = counterValue(count);
    if (to !== rowsDestroyed) recorder.logEvent({ type: "rows-destroyed-set", from: rowsDestroyed, to });
    setRowsDestroyed(to);
  };

  const setScoreCount = (value: number) => setScore(counterValue(value));

  /** Logs a score edit once the field loses focus, not on every keystroke. */
  const commitScore = () => {
    const from = committedScoreRef.current;
    if (score === from) return;
    committedScoreRef.current = score;
    recorder.logEvent({ type: "score-set", from, to: score, turnsRecorded: recorder.session?.turns.length ?? 0 });
  };

  const toggleTrackScore = () => {
    const enabled = !trackScore;
    setTrackScore(enabled);
    try {
      localStorage.setItem(TRACK_SCORE_KEY, enabled ? "1" : "0");
    } catch {
      // Only a convenience; the toggle still works for this page.
    }
    recorder.logEvent({ type: "score-tracking", enabled, score });
  };

  const toggleRecording = () => {
    if (recorder.recording) recorder.stop();
    else recorder.start(turnsSurvived, rowsDestroyed, trackScore ? score : null);
  };

  /** Same generator and difficulty schedule the model is trained on, for the upcoming turn. */
  const randomizeNextRow = () => {
    if (animating) return;
    resetAnalysis();
    setNextRow(generateRow(Math.random, turnsSurvived));
    setNextRowRandomized(true);
  };

  const clearBoard = () => {
    recorder.logEvent({ type: "board-cleared" });
    setNextRowRandomized(false);
    setBlocks([]);
    setNextRow([]);
    setTurnsSurvived(0);
    setStatus("ready");
    setRowsDestroyed(0);
    setScore(0);
    committedScoreRef.current = 0;
    setRefilling(false);
    setMovedThisTurn(null);
    setDrag(null);
    setHovered(null);
    setMotionBlocks([]);
    setLifting(false);
    resetAnalysis();
  };

  return { splitCheck, splitAdvice, dismissSplitAdvice, splitAt, canSplit, blocks, nextRow, tool, setTool, drag, hovered, setHovered, ranked, preview, selected, setSelected: selectMove, analysis, searchSettings, setSearchSettings, searchProgress, stopSearch, turnsSurvived, setTurn, rowsDestroyed, setRowsDestroyed: setRowsDestroyedCount, score, setScore: setScoreCount, commitScore, trackScore, toggleTrackScore, recorder, toggleRecording, status, canAdvance, forcedPush, refilling, movedThisTurn, animating, removingIds, motionBlocks, lifting, nextFilled, nextValid, dragPreview, movePreview, hoveredBoardBlock, hoveredNextBlock, HoverToolIcon, setNextRow, randomizeNextRow, resetAnalysis, startDrag, extendDrag, finishDrag, trackPointer, compute: () => compute(), applyMove, advanceTurn, clearBoard };
}

export type PuzzleWorkbench = ReturnType<typeof usePuzzleWorkbench>;
