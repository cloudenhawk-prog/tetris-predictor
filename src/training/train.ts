/**
 * Self-play TD training for the board value network.
 *
 *   npm run train                    # continue improving the app's model (60 min)
 *   npm run train -- --minutes 10    # shorter session
 *   npm run train -- --fresh         # start over from random weights
 *
 * Workers play games with the current network (ε-greedy) and produce TD
 * targets; the main thread fits the network on a replay buffer and broadcasts
 * the new weights every iteration. The best network by evaluation score is
 * written to --out (the file the app loads).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_ROW_GENERATION, createRng } from "@/domain/puzzle/row-generator";
import { DEFAULT_PLANNER_OPTIONS } from "@/application/puzzle/planning/move-planner";
import {
  DEFAULT_HIDDEN_LAYERS,
  NeuralBoardValueModel,
  type ValueNetworkFile,
} from "@/infrastructure/puzzle/value-network/neural-board-value-model";
import { AdamTrainer } from "@/infrastructure/puzzle/value-network/mlp";
import { BOARD_INPUT_SIZE } from "@/infrastructure/puzzle/value-network/board-encoder";
import { ReplayBuffer } from "@/training/replay-buffer";
import type { SelfPlayConfig } from "@/training/self-play";
import { summarize } from "@/training/game-simulation";
import { WorkerPool } from "@/training/worker-pool";

export const DEFAULT_WEIGHTS_PATH = "src/infrastructure/puzzle/value-network/weights.json";

const { values: args } = parseArgs({
  options: {
    iterations: { type: "string", default: "100000" },
    minutes: { type: "string", default: "60" },
    workers: { type: "string", default: String(Math.max(1, cpus().length - 1)) },
    decisions: { type: "string", default: "8192" },
    batch: { type: "string", default: "128" },
    "replay-ratio": { type: "string", default: "2" },
    buffer: { type: "string", default: "150000" },
    /** Defaults to 5e-4 for a fresh model, 1e-4 when continuing. */
    lr: { type: "string" },
    "lr-end": { type: "string", default: "0.00005" },
    "epsilon-start": { type: "string", default: "0.1" },
    "epsilon-end": { type: "string", default: "0.01" },
    "eval-every": { type: "string", default: "25" },
    "eval-games": { type: "string", default: "110" },
    "eval-max-turns": { type: "string", default: "3000" },
    hidden: { type: "string", default: DEFAULT_HIDDEN_LAYERS.join(",") },
    out: { type: "string", default: DEFAULT_WEIGHTS_PATH },
    checkpoint: { type: "string", default: "training-output/latest.json" },
    fresh: { type: "boolean", default: false },
    /** Model to continue from; defaults to --out. */
    from: { type: "string" },
    seed: { type: "string", default: String(Date.now() % 1_000_000) },
  },
});

const num = (key: keyof typeof args) => Number(args[key]);
const seed = num("seed");
const rng = createRng(seed);
const startedAt = Date.now();
const deadline = startedAt + num("minutes") * 60_000;
const iterations = num("iterations");

const config: SelfPlayConfig = {
  planner: { ...DEFAULT_PLANNER_OPTIONS, rowGeneration: DEFAULT_ROW_GENERATION },
  maxEpisodeTurns: 2000,
  randomStartChance: 0.5,
  maxStartTurn: DEFAULT_ROW_GENERATION.schedule.rampEndTurn + 50,
  maxRandomStartRows: 4,
};

function loadStartingModel(): NeuralBoardValueModel | null {
  const path = args.from ?? args.out;
  if (args.fresh || !existsSync(path)) return null;
  try {
    const loaded = NeuralBoardValueModel.fromFile(JSON.parse(readFileSync(path, "utf8")) as ValueNetworkFile);
    // Keep the network, but train against the current game config.
    console.log(`Continuing from ${path}`);
    return new NeuralBoardValueModel(loaded.network, config.planner.returnConfig, config.planner.rowGeneration.schedule);
  } catch (error) {
    console.log(`Cannot continue from ${path} (${(error as Error).message}); starting fresh`);
    return null;
  }
}
const continued = loadStartingModel();
const model =
  continued ??
  NeuralBoardValueModel.create(args.hidden.split(",").map(Number), rng, config.planner.returnConfig, config.planner.rowGeneration.schedule);
const startLr = args.lr === undefined ? (continued ? 1e-4 : 5e-4) : Number(args.lr);

const trainer = new AdamTrainer(model.network, startLr);
const buffer = new ReplayBuffer(num("buffer"), BOARD_INPUT_SIZE);
const pool = await WorkerPool.start(num("workers"), seed, config, model.toFile());
const evalSeeds = Array.from({ length: num("eval-games") }, (_, i) => 1_000_000 + i);
const batchIndices = new Uint32Array(num("batch"));
const evalSettings = { games: evalSeeds.length, maxTurns: num("eval-max-turns") };

const evaluateNetwork = async (label: string) => {
  const summary = summarize(await pool.evaluate("network", evalSeeds, num("eval-max-turns")));
  console.log(
    `  ${label}: mean ${summary.meanTurns.toFixed(1)} turns, median ${summary.medianTurns}, ` +
      `cleared ${summary.meanCleared.toFixed(1)}, reached cap ${summary.survivedToCap}/${summary.games}`,
  );
  return summary;
};

/**
 * Score of the model currently at --out under today's settings, so a worse run
 * never replaces it. Skipped when the architecture differs (deliberate change).
 */
async function baselineScore(): Promise<number> {
  if (!existsSync(args.out)) return -Infinity;
  let params: Float32Array;
  try {
    params = NeuralBoardValueModel.fromFile(JSON.parse(readFileSync(args.out, "utf8")) as ValueNetworkFile).network.params;
  } catch {
    return -Infinity;
  }
  if (params.length !== model.network.params.length) return -Infinity;
  await pool.setWeights(params);
  const summary = await evaluateNetwork(`baseline ${args.out}`);
  await pool.setWeights(model.network.params);
  return summary.meanTurns;
}
let bestScore = await baselineScore();

const save = (path: string, notes: Record<string, unknown>) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(model.toFile(notes)));
};

console.log(`Training with ${pool.size} workers, ${num("decisions")} decisions/iteration, seed ${seed}`);

for (let it = 1; it <= iterations && Date.now() < deadline; it++) {
  const progress = Math.min(1, Math.max((Date.now() - startedAt) / (deadline - startedAt), it / iterations));
  const epsilon = num("epsilon-start") + (num("epsilon-end") - num("epsilon-start")) * progress;
  trainer.learningRate = num("lr-end") + 0.5 * (startLr - num("lr-end")) * (1 + Math.cos(Math.PI * progress));

  const t0 = Date.now();
  const generated = await pool.generate(Math.ceil(num("decisions") / pool.size), epsilon);
  const t1 = Date.now();
  let fresh = 0;
  const episodes = generated.flatMap((g) => g.episodes);
  for (const g of generated) {
    buffer.add(g.inputs, g.targets);
    fresh += g.targets.length;
  }

  const steps = Math.ceil((fresh * num("replay-ratio")) / batchIndices.length);
  let loss = 0;
  for (let s = 0; s < steps; s++) {
    loss += trainer.trainBatch(buffer.inputs, buffer.targets, buffer.sampleIndices(batchIndices.length, rng, batchIndices));
  }
  await pool.setWeights(model.network.params);
  const t2 = Date.now();

  const fromStart = episodes.filter((e) => e.startTurn <= 3);
  const meanLen = fromStart.reduce((a, e) => a + e.turns, 0) / Math.max(1, fromStart.length);
  console.log(
    `it ${it} | loss ${(loss / steps).toExponential(2)} | ε ${epsilon.toFixed(3)} | lr ${trainer.learningRate.toExponential(1)}` +
      ` | episodes ${episodes.length} (from start: ${fromStart.length}, mean ${meanLen.toFixed(0)} turns)` +
      ` | play ${((t1 - t0) / 1000).toFixed(1)}s train ${((t2 - t1) / 1000).toFixed(1)}s`,
  );

  const lastIteration = it === iterations || Date.now() >= deadline;
  if (it % num("eval-every") === 0 || lastIteration) {
    const summary = await evaluateNetwork("eval");
    const score = summary.meanTurns;
    const notes = { iteration: it, seed, eval: summary, evalSettings };
    save(args.checkpoint, notes);
    if (score > bestScore) {
      bestScore = score;
      save(args.out, notes);
      console.log(`  saved best model to ${args.out}`);
    }
  }
}

await pool.close();
