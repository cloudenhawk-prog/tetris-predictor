import type { Block, Move } from "@/domain/puzzle/engine";

export function describeMove(block: Block | null, move: Move): string {
  if (block === null) return "HOLD POSITION";
  const direction = move.delta < 0 ? "LEFT" : "RIGHT";
  return `SLIDE ${direction} ${Math.abs(move.delta)} · R${block.row + 1}C${block.col + 1} W${block.w}`;
}

export function describeOutcome(cleared: number, holes: number, maxHeight: number): string {
  return `${cleared} clearance${cleared === 1 ? "" : "s"}, ${holes} gap${holes === 1 ? "" : "s"}, peak ${maxHeight}`;
}
