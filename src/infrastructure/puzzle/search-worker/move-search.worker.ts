/// <reference lib="webworker" />
import { reserveIds } from "@/domain/puzzle/engine";
import { searchMoves } from "@/application/puzzle/planning/move-search";
import { DEFAULT_PLANNER_OPTIONS } from "@/application/puzzle/planning/move-planner";
import { searchSplits } from "@/application/puzzle/planning/split-search";
import { toScoredMoves } from "@/application/puzzle/services/lookahead-move-analyzer";
import {
  NeuralBoardValueModel,
  type ValueNetworkFile,
} from "@/infrastructure/puzzle/value-network/neural-board-value-model";
import trainedWeights from "@/infrastructure/puzzle/value-network/weights.json";
import { HeuristicBoardValueModel } from "@/infrastructure/puzzle/heuristic-board-value-model";
import type { BoardValueModel } from "@/application/puzzle/contracts/move-analysis";
import type { MoveSearchMessage, MoveSearchRequest, MoveSearchUpdate, SplitSearchRequest, SplitSearchUpdate } from "@/infrastructure/puzzle/search-worker/protocol";

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

/**
 * Advances `search` in time slices until `thinkMs` runs out (or it finishes),
 * posting the latest result at most every POST_EVERY_MS. A newer request or a
 * cancel stops it.
 */
async function drive<T>(
  request: MoveSearchRequest | SplitSearchRequest,
  search: Generator<T, void, void>,
  post: (latest: T | null, elapsedMs: number, done: boolean) => void,
) {
  activeId = request.id;
  const started = performance.now();
  let lastPost = -Infinity;
  for (;;) {
    let latest: IteratorResult<T, void>;
    const sliceEnd = performance.now() + SLICE_MS;
    do latest = search.next();
    while (!latest.done && performance.now() < sliceEnd);

    const elapsedMs = performance.now() - started;
    const done = latest.done === true || elapsedMs >= request.thinkMs;
    if (latest.value && (done || elapsedMs - lastPost >= POST_EVERY_MS || lastPost < 0)) {
      lastPost = elapsedMs;
      post(latest.value, elapsedMs, done);
    } else if (done) {
      post(null, elapsedMs, done);
    }
    if (done) return;
    await yieldToMessages();
    if (activeId !== request.id) return;
  }
}

/** Split pieces and refill rows get fresh ids here; keep them clear of the ids the page already uses. */
function reserveRequestIds(request: MoveSearchRequest | SplitSearchRequest) {
  reserveIds(Math.max(0, ...request.blocks.map((b) => b.id), ...request.incoming.map((c) => c.id)));
}

function runMoves(request: MoveSearchRequest) {
  const search = searchMoves(request.blocks, request.incoming, request.turn, model, 0x5eed, { depth: request.depth, candidates: request.candidates }, planner);
  return drive(request, search, (latest, elapsedMs, done) => {
    postMessage({
      id: request.id,
      moves: latest ? toScoredMoves(request.blocks, latest) : [],
      samples: latest?.[0]?.samples ?? 0,
      elapsedMs,
      done,
      ...(warning ? { warning } : {}),
    } satisfies MoveSearchUpdate);
  });
}

function runSplits(request: SplitSearchRequest) {
  const search = searchSplits(request.blocks, request.incoming, request.turn, model, 0x5eed, { depth: request.depth, candidates: request.candidates, splits: request.splits }, planner);
  // Keep the last analysis: a final "done" without a fresh one still reports it.
  let last: SplitSearchUpdate["analysis"] = null;
  return drive(request, search, (latest, elapsedMs, done) => {
    last = latest ?? last;
    postMessage({
      id: request.id,
      analysis: last,
      samples: last?.baseline.samples ?? 0,
      elapsedMs,
      done,
      ...(warning ? { warning } : {}),
    } satisfies SplitSearchUpdate);
  });
}

onmessage = (event: MessageEvent<MoveSearchMessage>) => {
  const message = event.data;
  if (message.type === "cancel") {
    activeId = 0;
    return;
  }
  reserveRequestIds(message);
  void (message.type === "search" ? runMoves(message) : runSplits(message));
};
