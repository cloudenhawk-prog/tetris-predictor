import { COLS, type RowCell, newId } from "@/domain/puzzle/engine";

export type Rng = () => number;

/** Small deterministic PRNG (mulberry32) so simulations and training are reproducible. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Relative odds of block widths 1, 2, 3 and 4. */
export type WidthWeights = readonly [number, number, number, number];

/**
 * Difficulty ramps linearly from `earlyWidthWeights` (before `rampStartTurn`)
 * to `lateWidthWeights` (capped from `rampEndTurn` on). A turn is one pushed row.
 */
export interface DifficultySchedule {
  rampStartTurn: number;
  rampEndTurn: number;
  earlyWidthWeights: WidthWeights;
  lateWidthWeights: WidthWeights;
}

export interface RowGenerationConfig {
  schedule: DifficultySchedule;
  /** Chance that any generated block is a bomb. */
  bombChance: number;
  /** Relative odds of a row leaving 1 or 2 empty cells. */
  emptyCellWeights: readonly [one: number, two: number];
}

export const DEFAULT_ROW_GENERATION: RowGenerationConfig = {
  schedule: {
    rampStartTurn: 30,
    rampEndTurn: 200,
    earlyWidthWeights: [0.35, 0.3, 0.2, 0.15],
    lateWidthWeights: [0.15, 0.25, 0.3, 0.3],
  },
  bombChance: 0.04,
  emptyCellWeights: [0.5, 0.5],
};

/** 0 before the ramp starts, 1 once it is capped. */
export function difficultyProgress(turn: number, schedule: DifficultySchedule): number {
  const span = schedule.rampEndTurn - schedule.rampStartTurn;
  if (span <= 0) return turn >= schedule.rampEndTurn ? 1 : 0;
  return Math.min(1, Math.max(0, (turn - schedule.rampStartTurn) / span));
}

export function widthWeightsAt(turn: number, schedule: DifficultySchedule): WidthWeights {
  const t = difficultyProgress(turn, schedule);
  const [a, b] = [schedule.earlyWidthWeights, schedule.lateWidthWeights];
  return [0, 1, 2, 3].map((i) => (a[i] ?? 0) * (1 - t) + (b[i] ?? 0) * t) as unknown as WidthWeights;
}

function pickWeighted(rng: Rng, weights: readonly number[]): number {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i] ?? 0;
    if (roll < 0) return i;
  }
  return weights.length - 1;
}

/** A random incoming row with 1–2 empty cells, sized for the given turn's difficulty. */
export function generateRow(
  rng: Rng,
  turn: number,
  config: RowGenerationConfig = DEFAULT_ROW_GENERATION,
): RowCell[] {
  const emptyCount = pickWeighted(rng, config.emptyCellWeights) + 1;
  const empty = new Set<number>();
  while (empty.size < emptyCount) empty.add(Math.floor(rng() * COLS));

  const widths = widthWeightsAt(turn, config.schedule);
  const row: RowCell[] = [];
  let col = 0;
  while (col < COLS) {
    if (empty.has(col)) {
      col++;
      continue;
    }
    let room = 0;
    while (col + room < COLS && !empty.has(col + room)) room++;
    const w = pickWeighted(rng, widths.slice(0, Math.min(room, 4))) + 1;
    row.push({ id: newId(), col, w, ...(rng() < config.bombChance ? { bomb: true } : {}) });
    col += w;
  }
  return row;
}
