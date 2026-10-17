import type { Block, RowCell } from "@/domain/puzzle/engine";
import { createDefaultMoveAnalyzer } from "@/application/puzzle/create-move-analyzer";
import type { ScoredMove } from "@/application/puzzle/contracts/move-analysis";

const defaultAnalyzer = createDefaultMoveAnalyzer();

// Compatibility wrapper; new code should depend on PuzzleMoveAnalyzer.
export function evaluateMoves(blocks: Block[], incoming: RowCell[]): ScoredMove[] {
  return defaultAnalyzer.evaluateMoves(blocks, incoming);
}

export type { ScoredMove };
