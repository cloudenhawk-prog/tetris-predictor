/// <reference lib="webworker" />
import { searchMoves } from "@/application/puzzle/planning/move-search";
import { DEFAULT_PLANNER_OPTIONS } from "@/application/puzzle/planning/move-planner";
import { toScoredMoves } from "@/application/puzzle/services/lookahead-move-analyzer";
import {
  NeuralBoardValueModel,
  type ValueNetworkFile,
} from "@/infrastructure/puzzle/value-network/neural-board-value-model";
import trainedWeights from "@/infrastructure/puzzle/value-network/weights.json";
import { HeuristicBoardValueModel } from "@/infrastructure/puzzle/heuristic-board-value-model";
import type { BoardValueModel } from "@/application/puzzle/contracts/move-analysis";
import type { MoveSearchMessage, MoveSearchRequest, MoveSearchUpdate } from "@/infrastructure/puzzle/search-worker/protocol";

// Weights trained for a different board size/encoding cannot load; keep the tool usable.
let warning: string | undefined;
let model: BoardValueModel;
try {
  model = NeuralBoardValueModel.fromFile(trainedWeights as unknown as ValueNetworkFile);
} catch (error) {
  warning = `Trained model unavailable (${(error as Error).message}). Using a basic heuristic; run npm run train.`;
  model = new HeuristicBoardValueModel();
}
const planner = { ...DEFAULT_PLANNER_OPTIONS, refillSamples: 16 };
const SLICE_MS = 40;
const POST_EVERY_MS = 200;
let activeId = 0;

const yieldToMessages = () => new Promise((resolve) => setTimeout(resolve, 0));

async function run(request: MoveSearchRequest) {
  activeId = request.id;
  const started = performance.now();
  const search = searchMoves(
    request.blocks,
    request.incoming,
    request.turn,
    model,
    0x5eed,
    { depth: request.depth, candidates: request.candidates },
    planner,
  );
  let lastPost = -Infinity;
  for (;;) {
    let latest: ReturnType<typeof search.next>;
    const sliceEnd = performance.now() + SLICE_MS;
    do latest = search.next();
    while (!latest.done && performance.now() < sliceEnd);

    const elapsedMs = performance.now() - started;
    const done = latest.done === true || elapsedMs >= request.thinkMs;
    if (latest.value && (done || elapsedMs - lastPost >= POST_EVERY_MS || lastPost < 0)) {
      lastPost = elapsedMs;
      const update: MoveSearchUpdate = {
        id: request.id,
        moves: toScoredMoves(request.blocks, latest.value),
        samples: latest.value[0]?.samples ?? 0,
        elapsedMs,
        done,
        ...(warning ? { warning } : {}),
      };
      postMessage(update);
    } else if (done) {
      postMessage({ id: request.id, moves: [], samples: 0, elapsedMs, done } satisfies MoveSearchUpdate);
    }
    if (done) return;
    await yieldToMessages();
    if (activeId !== request.id) return;
  }
}

onmessage = (event: MessageEvent<MoveSearchMessage>) => {
  if (event.data.type === "cancel") activeId = 0;
  else void run(event.data);
};
