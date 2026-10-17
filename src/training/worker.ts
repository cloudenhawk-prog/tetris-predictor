import { parentPort } from "node:worker_threads";
import { createRng } from "@/domain/puzzle/row-generator";
import { NeuralBoardValueModel } from "@/infrastructure/puzzle/value-network/neural-board-value-model";
import { WeightedLinearScoringModel } from "@/infrastructure/puzzle/weighted-linear-scoring-model";
import { SelfPlayGenerator, type SelfPlayConfig } from "@/training/self-play";
import { DEFAULT_SEARCH_OPTIONS } from "@/application/puzzle/planning/move-search";
import { type Policy, heuristicPolicy, playGame, randomPolicy, searchPolicy, valuePolicy } from "@/training/game-simulation";
import type { EvaluationPolicy, EvaluationSearch, WorkerRequest, WorkerResponse } from "@/training/worker-protocol";

if (!parentPort) throw new Error("worker.ts must run in a worker thread");
const port = parentPort;

let model: NeuralBoardValueModel | null = null;
let config: SelfPlayConfig | null = null;
let generator: SelfPlayGenerator | null = null;

const post = (message: WorkerResponse, transfer: ArrayBuffer[] = []) => port.postMessage(message, transfer);

function policyFor(name: EvaluationPolicy, search: EvaluationSearch = { ...DEFAULT_SEARCH_OPTIONS, rounds: 8 }): Policy {
  if (name === "random") return randomPolicy;
  if (name === "heuristic") return heuristicPolicy(new WeightedLinearScoringModel());
  if (!model || !config) throw new Error("Worker not initialised");
  if (name === "search") return searchPolicy(model, config.planner, search, search.rounds);
  return valuePolicy(model, config.planner);
}

port.on("message", (message: WorkerRequest) => {
  switch (message.type) {
    case "init":
      model = NeuralBoardValueModel.fromFile(message.model);
      config = message.config;
      generator = new SelfPlayGenerator(model, config, createRng(message.seed));
      post({ type: "ready" });
      break;
    case "weights":
      model?.network.params.set(message.params);
      post({ type: "ready" });
      break;
    case "generate": {
      if (!generator) throw new Error("Worker not initialised");
      const batch = generator.generate(message.count, message.epsilon);
      post({ type: "generated", ...batch }, [batch.inputs.buffer as ArrayBuffer, batch.targets.buffer as ArrayBuffer]);
      break;
    }
    case "evaluate": {
      const policy = policyFor(message.policy, message.search);
      const rows = config?.planner.rowGeneration;
      if (!rows) throw new Error("Worker not initialised");
      const results = message.seeds.map((seed) => playGame(policy, createRng(seed), rows, message.maxTurns));
      post({ type: "evaluated", results });
      break;
    }
  }
});
