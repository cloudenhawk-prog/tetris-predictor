import { describe, expect, test } from "vitest";
import { createRng } from "@/domain/puzzle/row-generator";
import { COLS, ROWS } from "@/domain/puzzle/engine";
import { AdamTrainer, Mlp, decodeFloat32, encodeFloat32 } from "@/infrastructure/puzzle/value-network/mlp";
import { BOARD_INPUT_SIZE, encodeBoard } from "@/infrastructure/puzzle/value-network/board-encoder";
import { NeuralBoardValueModel } from "@/infrastructure/puzzle/value-network/neural-board-value-model";
import { DEFAULT_ROW_GENERATION } from "@/domain/puzzle/row-generator";
import trainedWeights from "@/infrastructure/puzzle/value-network/weights.json";
import type { ValueNetworkFile } from "@/infrastructure/puzzle/value-network/neural-board-value-model";

describe("Mlp", () => {
  test("analytic gradients match finite differences", () => {
    const mlp = Mlp.random([5, 4, 3, 1], createRng(1));
    const input = new Float32Array([0.3, -0.2, 0.9, 0.1, 0.5]);
    const grad = new Float32Array(mlp.params.length);
    mlp.accumulateGradient(input, 0.7, grad, mlp.createDeltaBuffers());
    const loss = () => 0.5 * (mlp.forward(input) - 0.7) ** 2;
    for (const i of [0, 7, 20, mlp.params.length - 1]) {
      const original = mlp.params[i] as number;
      mlp.params[i] = original + 1e-3;
      const up = loss();
      mlp.params[i] = original - 1e-3;
      const down = loss();
      mlp.params[i] = original;
      expect(grad[i]).toBeCloseTo((up - down) / 2e-3, 2);
    }
  });

  test("fits a simple function", () => {
    const rng = createRng(2);
    const mlp = Mlp.random([2, 16, 1], rng);
    const trainer = new AdamTrainer(mlp, 0.01);
    const inputs = new Float32Array(200);
    const targets = new Float32Array(100);
    for (let i = 0; i < 100; i++) {
      inputs[2 * i] = rng();
      inputs[2 * i + 1] = rng();
      targets[i] = (inputs[2 * i] as number) + 2 * (inputs[2 * i + 1] as number);
    }
    const all = Array.from({ length: 100 }, (_, i) => i);
    let loss = Infinity;
    for (let step = 0; step < 500; step++) loss = trainer.trainBatch(inputs, targets, all);
    expect(loss).toBeLessThan(1e-3);
  });

  test("snapshots round-trip exactly", () => {
    const mlp = Mlp.random([3, 2, 1], createRng(3));
    expect(Array.from(Mlp.fromSnapshot(mlp.toSnapshot()).params)).toEqual(Array.from(mlp.params));
    const values = new Float32Array([1.5, -2.25, 1e-7]);
    expect(Array.from(decodeFloat32(encodeFloat32(values)))).toEqual(Array.from(values));
  });
});

describe("board encoding", () => {
  test("marks cells, bombs, block starts and widths", () => {
    const B = ROWS - 1;
    const encoded = encodeBoard([{ id: 1, row: B, col: 2, w: 3, bomb: true }], 0, DEFAULT_ROW_GENERATION.schedule);
    expect(encoded).toHaveLength(BOARD_INPUT_SIZE);
    const cells = ROWS * COLS;
    const cell = B * COLS + 2;
    expect(encoded[cell]).toBe(1);
    expect(encoded[cell + 2]).toBe(1);
    expect(encoded[cells + cell]).toBe(1);
    expect(encoded[2 * cells + cell]).toBe(1);
    expect(encoded[2 * cells + cell + 1]).toBe(0);
    expect(encoded[3 * cells + cell]).toBe(0.75);
  });
});

describe("trained weights", () => {
  test("load and prefer a low, tidy board over a nearly full one", () => {
    const model = NeuralBoardValueModel.fromFile(trainedWeights as unknown as ValueNetworkFile);
    const low = [
      { id: 1, row: ROWS - 1, col: 0, w: 3 }, { id: 2, row: ROWS - 1, col: 3, w: 4 },
      { id: 3, row: ROWS - 2, col: 0, w: 2 }, { id: 4, row: ROWS - 2, col: 3, w: 4 },
      { id: 5, row: ROWS - 3, col: 1, w: 4 },
    ];
    const high = Array.from({ length: ROWS - 1 }, (_, r) => [
      { id: 100 + r * 2, row: r + 1, col: 0, w: 3 },
      { id: 101 + r * 2, row: r + 1, col: 4, w: 4 },
    ]).flat();
    expect(model.evaluate(low, 50)).toBeGreaterThan(model.evaluate(high, 50));
  });
});
