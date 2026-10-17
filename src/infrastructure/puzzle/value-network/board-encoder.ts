import { type Block, COLS, ROWS } from "@/domain/puzzle/engine";
import { type DifficultySchedule, difficultyProgress } from "@/domain/puzzle/row-generator";

const CELLS = ROWS * COLS;
const CELL_CHANNELS = 4; // occupied, bomb, block starts here, block width / 4
const SUMMARY_FEATURES = COLS + ROWS + 5;

export const BOARD_INPUT_SIZE = CELLS * CELL_CHANNELS + SUMMARY_FEATURES;

/**
 * Turns a decision-point board into the network input. The raw grid carries
 * block identity (edges, widths, bombs) so the network can learn which blocks
 * are movable; a few generic summaries (heights, row fill, gaps) speed up
 * learning without encoding any strategy.
 */
export function encodeBoard(
  blocks: Block[],
  turn: number,
  schedule: DifficultySchedule,
  out: Float32Array = new Float32Array(BOARD_INPUT_SIZE),
): Float32Array {
  out.fill(0);
  const rowFill = new Array<number>(ROWS).fill(0);
  for (const b of blocks) {
    if (b.row < 0 || b.row >= ROWS) continue;
    rowFill[b.row] = (rowFill[b.row] ?? 0) + b.w;
    for (let c = b.col; c < b.col + b.w; c++) {
      const cell = b.row * COLS + c;
      out[cell] = 1;
      if (b.bomb) out[CELLS + cell] = 1;
      out[3 * CELLS + cell] = b.w / 4;
    }
    out[2 * CELLS + b.row * COLS + b.col] = 1;
  }

  let offset = CELLS * CELL_CHANNELS;
  let holes = 0;
  let maxHeight = 0;
  let bumpiness = 0;
  let previous = -1;
  for (let c = 0; c < COLS; c++) {
    let top = ROWS;
    for (let r = 0; r < ROWS; r++) {
      if (out[r * COLS + c]) {
        top = r;
        break;
      }
    }
    for (let r = top + 1; r < ROWS; r++) if (!out[r * COLS + c]) holes++;
    const height = ROWS - top;
    maxHeight = Math.max(maxHeight, height);
    if (previous >= 0) bumpiness += Math.abs(height - previous);
    previous = height;
    out[offset++] = height / ROWS;
  }
  let occupiedRows = 0;
  for (let r = 0; r < ROWS; r++) {
    const fill = rowFill[r] ?? 0;
    if (fill > 0) occupiedRows++;
    out[offset++] = fill / COLS;
  }
  out[offset++] = holes / 20;
  out[offset++] = bumpiness / 20;
  out[offset++] = maxHeight / ROWS;
  out[offset++] = occupiedRows / ROWS;
  out[offset++] = difficultyProgress(turn, schedule);
  return out;
}
