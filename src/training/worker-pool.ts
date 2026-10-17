import { Worker } from "node:worker_threads";
import type { GameResult } from "@/training/game-simulation";
import type { SelfPlayConfig } from "@/training/self-play";
import type { ValueNetworkFile } from "@/infrastructure/puzzle/value-network/neural-board-value-model";
import type { EvaluationPolicy, EvaluationSearch, WorkerRequest, WorkerResponse } from "@/training/worker-protocol";

type GeneratedResponse = Extract<WorkerResponse, { type: "generated" }>;

/** A pool of self-play workers; every request is broadcast and answered by all workers. */
export class WorkerPool {
  private readonly workers: Worker[];

  private constructor(workers: Worker[]) {
    this.workers = workers;
  }

  static async start(size: number, seed: number, config: SelfPlayConfig, model: ValueNetworkFile): Promise<WorkerPool> {
    const workers = Array.from(
      { length: size },
      () => new Worker(new URL("./worker.ts", import.meta.url), { execArgv: ["--import", "tsx"] }),
    );
    const pool = new WorkerPool(workers);
    await pool.each((_, i) => ({ type: "init", seed: seed * 7919 + i, config, model }));
    return pool;
  }

  get size(): number {
    return this.workers.length;
  }

  private each<T extends WorkerResponse>(request: (worker: Worker, index: number) => WorkerRequest): Promise<T[]> {
    return Promise.all(
      this.workers.map(
        (worker, i) =>
          new Promise<T>((resolve, reject) => {
            const onError = (error: Error) => {
              worker.off("message", onMessage);
              reject(error);
            };
            const onMessage = (message: T) => {
              worker.off("error", onError);
              resolve(message);
            };
            worker.once("message", onMessage);
            worker.once("error", onError);
            worker.postMessage(request(worker, i));
          }),
      ),
    );
  }

  async setWeights(params: Float32Array): Promise<void> {
    await this.each(() => ({ type: "weights", params }));
  }

  generate(countPerWorker: number, epsilon: number): Promise<GeneratedResponse[]> {
    return this.each<GeneratedResponse>(() => ({ type: "generate", count: countPerWorker, epsilon }));
  }

  async evaluate(policy: EvaluationPolicy, seeds: number[], maxTurns: number, search?: EvaluationSearch): Promise<GameResult[]> {
    const responses = await this.each<Extract<WorkerResponse, { type: "evaluated" }>>((_, i) => ({
      type: "evaluate",
      policy,
      seeds: seeds.filter((_, k) => k % this.workers.length === i),
      maxTurns,
      ...(search ? { search } : {}),
    }));
    return responses.flatMap((response) => response.results);
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.terminate()));
  }
}
