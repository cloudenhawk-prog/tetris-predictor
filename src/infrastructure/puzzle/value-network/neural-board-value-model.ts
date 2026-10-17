import type { Block } from "@/domain/puzzle/engine";
import { DEFAULT_ROW_GENERATION, type DifficultySchedule } from "@/domain/puzzle/row-generator";
import type { BoardValueModel } from "@/application/puzzle/contracts/move-analysis";
import {
  DEFAULT_RETURN_CONFIG,
  type ReturnConfig,
  maxReturn,
} from "@/application/puzzle/planning/return-model";
import { BOARD_INPUT_SIZE, encodeBoard } from "@/infrastructure/puzzle/value-network/board-encoder";
import { Mlp, type MlpSnapshot } from "@/infrastructure/puzzle/value-network/mlp";

export const DEFAULT_HIDDEN_LAYERS = [128, 64];

/** Everything needed to rebuild a trained model; stored as `weights.json`. */
export interface ValueNetworkFile {
  version: 1;
  network: MlpSnapshot;
  returnConfig: ReturnConfig;
  schedule: DifficultySchedule;
  trainedAt?: string;
  notes?: Record<string, unknown>;
}

/**
 * Board value from the network. The network predicts the return as a fraction
 * of `maxReturn` to keep outputs near [0, 1].
 */
export class NeuralBoardValueModel implements BoardValueModel {
  private readonly input = new Float32Array(BOARD_INPUT_SIZE);
  readonly scale: number;

  constructor(
    readonly network: Mlp,
    readonly returnConfig: ReturnConfig = DEFAULT_RETURN_CONFIG,
    readonly schedule: DifficultySchedule = DEFAULT_ROW_GENERATION.schedule,
  ) {
    if (network.inputSize !== BOARD_INPUT_SIZE) {
      throw new Error(`Network expects ${network.inputSize} inputs, encoder produces ${BOARD_INPUT_SIZE}`);
    }
    this.scale = maxReturn(returnConfig);
  }

  static create(
    hiddenLayers = DEFAULT_HIDDEN_LAYERS,
    rng?: () => number,
    returnConfig?: ReturnConfig,
    schedule?: DifficultySchedule,
  ): NeuralBoardValueModel {
    return new NeuralBoardValueModel(Mlp.random([BOARD_INPUT_SIZE, ...hiddenLayers, 1], rng), returnConfig, schedule);
  }

  static fromFile(file: ValueNetworkFile): NeuralBoardValueModel {
    return new NeuralBoardValueModel(Mlp.fromSnapshot(file.network), file.returnConfig, file.schedule);
  }

  toFile(notes?: Record<string, unknown>): ValueNetworkFile {
    return {
      version: 1,
      network: this.network.toSnapshot(),
      returnConfig: this.returnConfig,
      schedule: this.schedule,
      trainedAt: new Date().toISOString(),
      ...(notes ? { notes } : {}),
    };
  }

  encode(blocks: Block[], turn: number, out?: Float32Array): Float32Array {
    return encodeBoard(blocks, turn, this.schedule, out);
  }

  /**
   * Not clamped to [0, maxReturn]: bootstrapped value estimates drift upwards
   * during training, and only their differences matter for ranking moves.
   */
  evaluate(blocks: Block[], turn: number): number {
    return this.network.forward(this.encode(blocks, turn, this.input)) * this.scale;
  }
}
