import type { Block, RowCell } from "@/domain/puzzle/engine";
import type { ScoredMove } from "@/application/puzzle/contracts/move-analysis";

export interface MoveSearchRequest {
  type: "search";
  id: number;
  blocks: Block[];
  incoming: RowCell[];
  turn: number;
  thinkMs: number;
  depth: number;
  candidates: number;
}

export type MoveSearchMessage = MoveSearchRequest | { type: "cancel" };

export interface MoveSearchUpdate {
  id: number;
  moves: ScoredMove[];
  /** Futures simulated per searched candidate so far. */
  samples: number;
  elapsedMs: number;
  done: boolean;
  /** Set when the trained model could not be loaded and a fallback is used. */
  warning?: string;
}
