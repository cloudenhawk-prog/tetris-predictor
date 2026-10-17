import type { GameResult } from "@/training/game-simulation";
import type { MoveSearchOptions } from "@/application/puzzle/planning/move-search";
import type { EpisodeStats, SelfPlayConfig } from "@/training/self-play";
import type { ValueNetworkFile } from "@/infrastructure/puzzle/value-network/neural-board-value-model";

export type EvaluationPolicy = "network" | "search" | "heuristic" | "random";

export interface EvaluationSearch extends MoveSearchOptions {
  rounds: number;
}

export type WorkerRequest =
  | { type: "init"; seed: number; config: SelfPlayConfig; model: ValueNetworkFile }
  | { type: "weights"; params: Float32Array }
  | { type: "generate"; count: number; epsilon: number }
  | { type: "evaluate"; policy: EvaluationPolicy; seeds: number[]; maxTurns: number; search?: EvaluationSearch };

export type WorkerResponse =
  | { type: "ready" }
  | { type: "generated"; inputs: Float32Array; targets: Float32Array; episodes: EpisodeStats[] }
  | { type: "evaluated"; results: GameResult[] };
