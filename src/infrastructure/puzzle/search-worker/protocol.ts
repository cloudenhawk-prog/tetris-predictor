import type { Block, RowCell } from "@/domain/puzzle/engine";
import type { ScoredMove } from "@/application/puzzle/contracts/move-analysis";
import type { SplitAnalysis } from "@/application/puzzle/planning/split-search";

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

/** Which block is best to split before this turn's move (see `searchSplits`). */
export interface SplitSearchRequest extends Omit<MoveSearchRequest, "type"> {
  type: "split-search";
  /** Splits refined by simulated futures, besides not splitting. */
  splits: number;
}

export type MoveSearchMessage = MoveSearchRequest | SplitSearchRequest | { type: "cancel" };

interface SearchProgressUpdate {
  id: number;
  /** Futures simulated per searched candidate so far. */
  samples: number;
  elapsedMs: number;
  done: boolean;
  /** Set when the trained model could not be loaded and a fallback is used. */
  warning?: string;
}

export interface MoveSearchUpdate extends SearchProgressUpdate {
  moves: ScoredMove[];
}

export interface SplitSearchUpdate extends SearchProgressUpdate {
  /** Null only on a final update when the search produced nothing. */
  analysis: SplitAnalysis | null;
}
