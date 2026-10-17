import type {
  MoveScoreFeatures,
  MoveScoringModel,
} from "@/application/puzzle/contracts/move-analysis";

export interface WeightedLinearScoringWeights {
  cleared: number;
  aggregateHeight: number;
  holes: number;
  bumpiness: number;
  maxHeight: number;
  lossPenalty: number;
}

const DEFAULT_WEIGHTS: WeightedLinearScoringWeights = {
  cleared: 120,
  aggregateHeight: -4,
  holes: -25,
  bumpiness: -3,
  maxHeight: -12,
  lossPenalty: -1_000_000,
};

export class WeightedLinearScoringModel implements MoveScoringModel {
  constructor(private readonly weights: WeightedLinearScoringWeights = DEFAULT_WEIGHTS) {}

  score(features: MoveScoreFeatures): number {
    if (features.lost) return this.weights.lossPenalty;

    return (
      this.weights.cleared * features.cleared +
      this.weights.aggregateHeight * features.aggregateHeight +
      this.weights.holes * features.holes +
      this.weights.bumpiness * features.bumpiness +
      this.weights.maxHeight * features.maxHeight
    );
  }
}
