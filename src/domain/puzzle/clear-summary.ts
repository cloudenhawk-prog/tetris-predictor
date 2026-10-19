import type { SettlePhase } from "@/domain/puzzle/engine";

/** Blocks of width 1, 2, 3 and 4. */
export type WidthCounts = [number, number, number, number];

/** One clear in a settle cascade: full rows removed at once, plus any bomb blasts. */
export interface ClearStep {
  rows: number;
  /** Every destroyed block, by width (cleared rows and bomb blasts). */
  destroyedByWidth: WidthCounts;
  /** Destroyed blocks that were not on a full row, i.e. caught in a blast. */
  destroyedByBlast: number;
  bombsDetonated: number;
}

export const emptyWidthCounts = (): WidthCounts => [0, 0, 0, 0];

export function summarizeClears(phases: SettlePhase[]): ClearStep[] {
  return phases
    .filter((phase) => phase.kind === "clear")
    .map((phase) => {
      const removed = new Set(phase.removedIds);
      const destroyed = phase.blocks.filter((b) => removed.has(b.id));
      const destroyedByWidth = emptyWidthCounts();
      for (const b of destroyed) destroyedByWidth[Math.min(4, Math.max(1, b.w)) - 1]++;
      return {
        rows: phase.rows.length,
        destroyedByWidth,
        destroyedByBlast: destroyed.filter((b) => !phase.rows.includes(b.row)).length,
        bombsDetonated: destroyed.filter((b) => b.bomb).length,
      };
    });
}
