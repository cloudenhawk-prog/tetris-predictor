export const COLS = 8;
export const ROWS = 10;

export interface Block {
  id: number;
  row: number;
  col: number;
  w: number;
  bomb?: boolean;
}

export interface RowCell {
  id: number;
  col: number;
  w: number;
  bomb?: boolean;
}

let idCounter = 1;
export const newId = () => idCounter++;

/**
 * Ids up to `id` are taken, e.g. by a board sent from another thread (each
 * thread has its own counter); `newId` continues above them.
 */
export function reserveIds(id: number): void {
  idCounter = Math.max(idCounter, id + 1);
}

export const cloneBlocks = (blocks: Block[]): Block[] => blocks.map((b) => ({ ...b }));

/**
 * The incoming row as the player sees it: whether a block is a bomb is only
 * revealed once the row has been pushed into the grid.
 */
export const hideBombs = (row: RowCell[]): RowCell[] => row.map(({ id, col, w }) => ({ id, col, w }));

export const overlapCols = (a: { col: number; w: number }, b: { col: number; w: number }) =>
  a.col < b.col + b.w && b.col < a.col + a.w;

export function blockAt(blocks: Block[], row: number, col: number): Block | undefined {
  return blocks.find((b) => b.row === row && col >= b.col && col < b.col + b.w);
}

export function canPlace(
  blocks: Block[],
  row: number,
  col: number,
  w: number,
  ignoreId?: number,
): boolean {
  if (col < 0 || col + w > COLS || row < 0 || row >= ROWS) return false;
  return !blocks.some(
    (b) => b.id !== ignoreId && b.row === row && overlapCols(b, { col, w }),
  );
}

export function canPlaceRun(row: RowCell[], col: number, w: number): boolean {
  if (col < 0 || col + w > COLS) return false;
  return !row.some((r) => overlapCols(r, { col, w }));
}

/** Every block falls independently until it rests on the floor or another block. */
export function gravity(blocks: Block[]): Block[] {
  const list = cloneBlocks(blocks).sort((a, b) => b.row - a.row);
  let moved = true;
  while (moved) {
    moved = false;
    for (const b of list) {
      while (
        b.row + 1 < ROWS &&
        !list.some((o) => o !== b && o.row === b.row + 1 && overlapCols(o, b))
      ) {
        b.row++;
        moved = true;
      }
    }
  }
  return list;
}

function findFullRows(blocks: Block[]): number[] {
  const counts = new Array<number>(ROWS).fill(0);
  for (const b of blocks) counts[b.row] = (counts[b.row] ?? 0) + b.w;
  const rows: number[] = [];
  for (let r = 0; r < ROWS; r++) if ((counts[r] ?? 0) >= COLS) rows.push(r);
  return rows;
}

export type SettlePhaseKind = "gravity" | "clear";

export interface SettlePhase {
  kind: SettlePhaseKind;
  blocks: Block[];
  removedIds: number[];
  /** Full rows that triggered a "clear" phase (empty for gravity). */
  rows: number[];
}

function blocksDestroyedByRows(blocks: Block[], rows: number[]): Set<number> {
  const removed = new Set(blocks.filter((b) => rows.includes(b.row)).map((b) => b.id));
  const queue = blocks.filter((b) => removed.has(b.id) && b.bomb);
  const exploded = new Set<number>();

  while (queue.length) {
    const bomb = queue.shift();
    if (!bomb || exploded.has(bomb.id)) continue;
    exploded.add(bomb.id);
    for (const other of blocks) {
      if (removed.has(other.id)) continue;
      const sideTouch =
        other.row === bomb.row &&
        (other.col + other.w === bomb.col || bomb.col + bomb.w === other.col);
      const verticalTouch =
        Math.abs(other.row - bomb.row) === 1 && overlapCols(other, bomb);
      if (sideTouch || verticalTouch) {
        removed.add(other.id);
        if (other.bomb) queue.push(other);
      }
    }
  }
  return removed;
}

/** Return deterministic visual phases for gravity, row clears, and bomb destruction. */
export function settleWithPhases(blocks: Block[]): {
  blocks: Block[];
  cleared: number;
  phases: SettlePhase[];
} {
  let list = cloneBlocks(blocks);
  let cleared = 0;
  const phases: SettlePhase[] = [];

  for (;;) {
    const fallen = gravity(list);
    if (fallen.some((b) => list.find((o) => o.id === b.id)?.row !== b.row)) {
      phases.push({ kind: "gravity", blocks: cloneBlocks(fallen), removedIds: [], rows: [] });
    }
    list = fallen;

    const rows = findFullRows(list);
    if (rows.length === 0) break;
    cleared += rows.length;
    const removed = blocksDestroyedByRows(list, rows);
    phases.push({
      kind: "clear",
      blocks: cloneBlocks(list),
      removedIds: [...removed],
      rows,
    });
    list = list.filter((b) => !removed.has(b.id));
  }

  return { blocks: list, cleared, phases };
}

/** Clear full rows, apply gravity, repeat until the board is stable. */
export function settle(blocks: Block[]): { blocks: Block[]; cleared: number } {
  const result = settleWithPhases(blocks);
  return { blocks: result.blocks, cleared: result.cleared };
}

/**
 * The incoming row enters at the bottom. Only stacks in contact with it move:
 * blocks overlapping the incoming cells are pushed up one, and anything resting
 * directly on a pushed block is pushed too.
 */
export function pushUp(
  blocks: Block[],
  incoming: RowCell[],
): { blocks: Block[]; overflow: boolean } {
  const list = cloneBlocks(blocks);
  const bottom = ROWS - 1;
  const pushed = new Set<number>();
  const queue: Block[] = [];

  for (const b of list) {
    if (b.row === bottom && incoming.some((c) => overlapCols(c, b))) {
      pushed.add(b.id);
      queue.push(b);
    }
  }
  while (queue.length) {
    const cur = queue.shift();
    if (!cur) break;
    for (const o of list) {
      if (!pushed.has(o.id) && o.row === cur.row - 1 && overlapCols(o, cur)) {
        pushed.add(o.id);
        queue.push(o);
      }
    }
  }

  let overflow = false;
  for (const b of list) {
    if (pushed.has(b.id)) {
      b.row -= 1;
      if (b.row < 0) overflow = true;
    }
  }

  const withRow = [
    ...list.filter((b) => b.row >= 0),
    ...incoming.map((c) => ({
      id: c.id,
      row: bottom,
      col: c.col,
      w: c.w,
      ...(c.bomb === undefined ? {} : { bomb: c.bomb }),
    })),
  ];
  return { blocks: withRow, overflow };
}

export interface Move {
  blockId: number;
  delta: number;
}

/**
 * A block may slide any number of tiles left/right without passing through others.
 * Staying put is not a move: the player must slide a block to advance the turn.
 */
export function legalMoves(blocks: Block[]): Move[] {
  const moves: Move[] = [];
  for (const b of blocks) {
    let left = 0;
    for (const o of blocks) {
      if (o.id !== b.id && o.row === b.row && o.col + o.w <= b.col) {
        left = Math.max(left, o.col + o.w);
      }
    }
    let right = COLS;
    for (const o of blocks) {
      if (o.id !== b.id && o.row === b.row && o.col >= b.col + b.w) {
        right = Math.min(right, o.col);
      }
    }
    for (let target = left; target + b.w <= right; target++) {
      if (target !== b.col) moves.push({ blockId: b.id, delta: target - b.col });
    }
  }
  return moves;
}

export function applyMove(blocks: Block[], move: Move): Block[] {
  if (move.blockId < 0 || move.delta === 0) return cloneBlocks(blocks);
  return blocks.map((b) => (b.id === move.blockId ? { ...b, col: b.col + move.delta } : { ...b }));
}

export interface TurnResult {
  blocks: Block[];
  cleared: number;
  lost: boolean;
}

/** move -> settle -> push incoming row -> settle. */
export function playTurn(blocks: Block[], move: Move, incoming: RowCell[]): TurnResult {
  const first = settle(applyMove(blocks, move));
  const pushedState = pushUp(first.blocks, incoming);
  const second = settle(pushedState.blocks);
  const lost = pushedState.overflow || second.blocks.some((b) => b.row === 0);
  return {
    blocks: second.blocks,
    cleared: first.cleared + second.cleared,
    lost,
  };
}

export interface BoardStats {
  heights: number[];
  aggregate: number;
  maxHeight: number;
  holes: number;
  bumpiness: number;
}

export function boardStats(blocks: Block[]): BoardStats {
  const filled: boolean[][] = Array.from({ length: ROWS }, () =>
    new Array<boolean>(COLS).fill(false),
  );
  for (const b of blocks) {
    const rowCells = filled[b.row];
    if (!rowCells) continue;
    for (let c = b.col; c < b.col + b.w; c++) rowCells[c] = true;
  }

  const heights = new Array<number>(COLS).fill(0);
  let holes = 0;
  for (let c = 0; c < COLS; c++) {
    let top = -1;
    for (let r = 0; r < ROWS; r++) {
      if (filled[r]?.[c]) {
        top = r;
        break;
      }
    }
    if (top === -1) continue;
    heights[c] = ROWS - top;
    for (let r = top + 1; r < ROWS; r++) if (!filled[r]?.[c]) holes++;
  }
  let bumpiness = 0;
  for (let c = 0; c < COLS - 1; c++) bumpiness += Math.abs((heights[c] ?? 0) - (heights[c + 1] ?? 0));
  return {
    heights,
    aggregate: heights.reduce((a, b) => a + b, 0),
    maxHeight: Math.max(...heights, 0),
    holes,
    bumpiness,
  };
}

/**
 * The split power-up: a block becomes `w` blocks of width 1 in the same cells
 * (a bomb's pieces stay bombs). It is not a turn; settle the result straight
 * away (`settle`) to run gravity and clears until the board is stable.
 */
export function splitBlock(blocks: Block[], blockId: number): Block[] {
  return blocks.flatMap((b) =>
    b.id !== blockId || b.w <= 1
      ? [{ ...b }]
      : Array.from({ length: b.w }, (_, i) => ({
          id: newId(),
          row: b.row,
          col: b.col + i,
          w: 1,
          ...(b.bomb === undefined ? {} : { bomb: b.bomb }),
        })),
  );
}

/** Empty rows above the highest block; a block reaching row 0 loses the game. */
export function freeRows(blocks: Block[]): number {
  return blocks.reduce((top, b) => Math.min(top, b.row), ROWS);
}

/** Once the board drops to one occupied row, rows keep spawning until this many are occupied. */
export const REFILL_TARGET_ROWS = 3;

/** No block moves. Only used for forced refill pushes, never as a player choice. */
export const HOLD: Move = { blockId: -1, delta: 0 };

export function occupiedRowCount(blocks: Block[]): number {
  return new Set(blocks.map((b) => b.row)).size;
}

/** Whether the next turn is a forced refill push (no player choice). */
export function isRefillRequired(blocks: Block[], wasRefilling: boolean): boolean {
  const rows = occupiedRowCount(blocks);
  return rows <= 1 || (wasRefilling && rows < REFILL_TARGET_ROWS);
}

export interface PushStep {
  cleared: number;
  lost: boolean;
}

export interface PlayerMoveResult {
  blocks: Block[];
  /** One entry per row pushed: the player's turn followed by any forced refill turns. */
  steps: PushStep[];
  cleared: number;
  lost: boolean;
}

/**
 * A full player move: from one decision point to the next. Plays the chosen move
 * against the known incoming row, then keeps pushing refill rows (drawn from
 * `refillRow`) while the board is too empty for the player to act.
 */
export function resolvePlayerMove(
  blocks: Block[],
  move: Move,
  incoming: RowCell[],
  refillRow: (refillIndex: number) => RowCell[],
  maxRefills = 2 * ROWS,
): PlayerMoveResult {
  let turn = playTurn(blocks, move, incoming);
  const steps: PushStep[] = [{ cleared: turn.cleared, lost: turn.lost }];
  let refilling = false;
  for (let i = 0; i < maxRefills && !turn.lost; i++) {
    refilling = isRefillRequired(turn.blocks, refilling);
    if (!refilling) break;
    turn = playTurn(turn.blocks, HOLD, refillRow(i));
    steps.push({ cleared: turn.cleared, lost: turn.lost });
  }
  return {
    blocks: turn.blocks,
    steps,
    cleared: steps.reduce((sum, step) => sum + step.cleared, 0),
    lost: turn.lost,
  };
}
