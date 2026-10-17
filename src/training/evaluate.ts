/**
 * Compares policies on identical seeded games.
 *
 *   npm run evaluate -- --games 220 --policies network,heuristic,random
 *   npm run evaluate -- --policies network,search --search-depth 3 --search-rounds 8
 */
import { existsSync, readFileSync } from "node:fs";
import { cpus } from "node:os";
import { parseArgs } from "node:util";
import { DEFAULT_ROW_GENERATION } from "@/domain/puzzle/row-generator";
import { DEFAULT_PLANNER_OPTIONS } from "@/application/puzzle/planning/move-planner";
import {
  NeuralBoardValueModel,
  type ValueNetworkFile,
} from "@/infrastructure/puzzle/value-network/neural-board-value-model";
import { DEFAULT_SEARCH_OPTIONS } from "@/application/puzzle/planning/move-search";
import { summarize } from "@/training/game-simulation";
import { WorkerPool } from "@/training/worker-pool";
import type { EvaluationPolicy } from "@/training/worker-protocol";

const { values: args } = parseArgs({
  options: {
    games: { type: "string", default: "220" },
    "max-turns": { type: "string", default: "3000" },
    policies: { type: "string", default: "network,heuristic,random" },
    weights: { type: "string", default: "src/infrastructure/puzzle/value-network/weights.json" },
    workers: { type: "string", default: String(Math.max(1, cpus().length - 1)) },
    "first-seed": { type: "string", default: "5000000" },
    "search-depth": { type: "string", default: String(DEFAULT_SEARCH_OPTIONS.depth) },
    "search-candidates": { type: "string", default: String(DEFAULT_SEARCH_OPTIONS.candidates) },
    "search-rounds": { type: "string", default: "8" },
  },
});

const model = existsSync(args.weights)
  ? NeuralBoardValueModel.fromFile(JSON.parse(readFileSync(args.weights, "utf8")) as ValueNetworkFile)
  : NeuralBoardValueModel.create();
const pool = await WorkerPool.start(
  Number(args.workers),
  1,
  {
    planner: { ...DEFAULT_PLANNER_OPTIONS, rowGeneration: DEFAULT_ROW_GENERATION },
    maxEpisodeTurns: 0,
    randomStartChance: 0,
    maxStartTurn: 0,
    maxRandomStartRows: 0,
  },
  model.toFile(),
);
const seeds = Array.from({ length: Number(args.games) }, (_, i) => Number(args["first-seed"]) + i);

for (const policy of args.policies.split(",") as EvaluationPolicy[]) {
  const started = Date.now();
  const search = {
    depth: Number(args["search-depth"]),
    candidates: Number(args["search-candidates"]),
    rounds: Number(args["search-rounds"]),
  };
  const summary = summarize(await pool.evaluate(policy, seeds, Number(args["max-turns"]), search));
  console.log(
    `${policy.padEnd(10)} mean ${summary.meanTurns.toFixed(1).padStart(6)} turns | median ${String(summary.medianTurns).padStart(4)}` +
      ` | cleared ${summary.meanCleared.toFixed(1).padStart(6)} | reached cap ${summary.survivedToCap}/${summary.games}` +
      ` | ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}

await pool.close();
