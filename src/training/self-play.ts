import { type Block, legalMoves, playTurn, resolvePlayerMove } from "@/domain/puzzle/engine";
import { type Rng, generateRow } from "@/domain/puzzle/row-generator";
import { type MovePlannerOptions, planMoves, refillRowSource } from "@/application/puzzle/planning/move-planner";
import type { NeuralBoardValueModel } from "@/infrastructure/puzzle/value-network/neural-board-value-model";
import { BOARD_INPUT_SIZE } from "@/infrastructure/puzzle/value-network/board-encoder";
import { pickBest, refillUntilPlayable } from "@/training/game-simulation";

export interface SelfPlayConfig {
  planner: MovePlannerOptions;
  /** Episodes are truncated (not terminated) here; values still bootstrap. */
  maxEpisodeTurns: number;
  /**
   * Share of episodes that start mid-game: a random turn (for difficulty
   * coverage) and a few rows pushed with random moves, so the network sees
   * crowded, messy boards early in training.
   */
  randomStartChance: number;
  maxStartTurn: number;
  maxRandomStartRows: number;
}

export interface EpisodeStats {
  startTurn: number;
  turns: number;
  cleared: number;
  lost: boolean;
}

export interface GeneratedBatch {
  /** `count × BOARD_INPUT_SIZE` encoded decision-point boards. */
  inputs: Float32Array;
  /** TD targets, scaled to the network's output range. */
  targets: Float32Array;
  episodes: EpisodeStats[];
}

interface Episode {
  blocks: Block[];
  turn: number;
  startTurn: number;
  cleared: number;
}

/**
 * Generates TD(0) training targets by self-play. At every decision point the
 * previous decision point's board gets the target
 *   max over moves [ discounted rewards + γ^k · V(next decision point) ],
 * i.e. value iteration on afterstates with sampled incoming rows.
 */
export class SelfPlayGenerator {
  private episode: Episode | null = null;
  private readonly finished: EpisodeStats[] = [];

  constructor(
    private readonly model: NeuralBoardValueModel,
    private readonly config: SelfPlayConfig,
    private readonly rng: Rng,
  ) {}

  generate(count: number, epsilon: number): GeneratedBatch {
    const inputs = new Float32Array(count * BOARD_INPUT_SIZE);
    const targets = new Float32Array(count);
    const rows = this.config.planner.rowGeneration;

    for (let n = 0; n < count; ) {
      const episode = (this.episode ??= this.startEpisode());
      const incoming = generateRow(this.rng, episode.turn, rows);
      const seed = Math.floor(this.rng() * 2 ** 32);
      // Planning (and so the target) can't see bombs in the incoming row.
      const planned = planMoves(episode.blocks, incoming, episode.turn, this.model, seed, this.config.planner);
      const best = pickBest(planned, this.rng);
      if (!best) {
        this.endEpisode(episode, false);
        continue;
      }

      this.model.encode(episode.blocks, episode.turn, inputs.subarray(n * BOARD_INPUT_SIZE, (n + 1) * BOARD_INPUT_SIZE));
      targets[n] = best.value / this.model.scale;
      n++;

      const chosen = this.rng() < epsilon ? planned[Math.floor(this.rng() * planned.length)] ?? best : best;
      // The real row reveals its bombs once pushed.
      const result = incoming.some((cell) => cell.bomb)
        ? resolvePlayerMove(episode.blocks, chosen.move, incoming, refillRowSource(seed, 0, episode.turn + 1, rows))
        : chosen.result;
      episode.blocks = result.blocks;
      episode.turn += result.steps.length;
      episode.cleared += result.cleared;
      if (result.lost) this.endEpisode(episode, true);
      else if (episode.turn - episode.startTurn >= this.config.maxEpisodeTurns) this.endEpisode(episode, false);
    }

    return { inputs, targets, episodes: this.finished.splice(0) };
  }

  private endEpisode(episode: Episode, lost: boolean): void {
    this.finished.push({
      startTurn: episode.startTurn,
      turns: episode.turn - episode.startTurn,
      cleared: episode.cleared,
      lost,
    });
    this.episode = null;
  }

  private startEpisode(): Episode {
    const rows = this.config.planner.rowGeneration;
    for (;;) {
      const randomStart = this.rng() < this.config.randomStartChance;
      const startTurn = randomStart ? Math.floor(this.rng() * this.config.maxStartTurn) : 0;
      let { blocks, turn, lost } = refillUntilPlayable([], startTurn, this.rng, rows);
      if (randomStart) {
        const extraRows = Math.floor(this.rng() * (this.config.maxRandomStartRows + 1));
        for (let i = 0; i < extraRows && !lost; i++) {
          const moves = legalMoves(blocks);
          const move = moves[Math.floor(this.rng() * moves.length)];
          if (!move) break;
          const result = playTurn(blocks, move, generateRow(this.rng, turn, rows));
          blocks = result.blocks;
          lost = result.lost;
          turn++;
          if (!lost) ({ blocks, turn, lost } = refillUntilPlayable(blocks, turn, this.rng, rows));
        }
      }
      if (!lost) return { blocks, turn, startTurn: turn, cleared: 0 };
    }
  }
}
