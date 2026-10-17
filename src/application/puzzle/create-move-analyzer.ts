import type { PuzzleMoveAnalyzer } from "@/application/puzzle/contracts/move-analysis";
import { HeuristicMoveAnalyzer } from "@/application/puzzle/services/heuristic-move-analyzer";
import { LookaheadMoveAnalyzer } from "@/application/puzzle/services/lookahead-move-analyzer";
import { WeightedLinearScoringModel } from "@/infrastructure/puzzle/weighted-linear-scoring-model";
import {
  NeuralBoardValueModel,
  type ValueNetworkFile,
} from "@/infrastructure/puzzle/value-network/neural-board-value-model";
import trainedWeights from "@/infrastructure/puzzle/value-network/weights.json";

/** The trained value network (see `npm run train`) with one-move lookahead. */
export function createDefaultMoveAnalyzer(): PuzzleMoveAnalyzer {
  return new LookaheadMoveAnalyzer(NeuralBoardValueModel.fromFile(trainedWeights as unknown as ValueNetworkFile));
}

/** The original hand-weighted analyzer; used as a training baseline. */
export function createHeuristicMoveAnalyzer(): PuzzleMoveAnalyzer {
  return new HeuristicMoveAnalyzer(new WeightedLinearScoringModel());
}
