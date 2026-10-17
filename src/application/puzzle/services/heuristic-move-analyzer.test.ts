import { describe, expect, test } from "vitest";
import { ROWS } from "@/domain/puzzle/engine";

import type { MoveScoreFeatures } from "@/application/puzzle/contracts/move-analysis";
import { HeuristicMoveAnalyzer } from "@/application/puzzle/services/heuristic-move-analyzer";
import { WeightedLinearScoringModel } from "@/infrastructure/puzzle/weighted-linear-scoring-model";

describe("HeuristicMoveAnalyzer", () => {
  test("uses injected scoring model to rank moves", () => {
    const analyzer = new HeuristicMoveAnalyzer({
      score(features: MoveScoreFeatures): number {
        return features.targetCol;
      },
    });

    const blocks = [{ id: 1, row: ROWS - 1, col: 2, w: 2 }];
    const incoming = [{ id: 2, col: 0, w: 1 }];
    const ranked = analyzer.evaluateMoves(blocks, incoming);

    expect(ranked[0]?.targetCol).toBe(6);
    expect(ranked[ranked.length - 1]?.targetCol).toBe(0);
  });
});

describe("WeightedLinearScoringModel", () => {
  test("applies loss penalty for losing positions", () => {
    const model = new WeightedLinearScoringModel();
    const score = model.score({
      move: { blockId: -1, delta: 0 },
      block: null,
      targetCol: -1,
      cleared: 0,
      aggregateHeight: 0,
      holes: 0,
      bumpiness: 0,
      maxHeight: 0,
      lost: true,
    });

    expect(score).toBe(-1_000_000);
  });
});
