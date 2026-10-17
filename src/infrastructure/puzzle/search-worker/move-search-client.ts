import type { MoveSearchRequest, MoveSearchUpdate } from "@/infrastructure/puzzle/search-worker/protocol";

export type MoveSearchParams = Omit<MoveSearchRequest, "type" | "id">;

/**
 * Runs move searches off the main thread. Starting a search supersedes the
 * previous one; the worker (and the model weights) load on first use.
 */
export class MoveSearchClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private listener: ((update: MoveSearchUpdate) => void) | null = null;

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL("./move-search.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (event: MessageEvent<MoveSearchUpdate>) => this.listener?.(event.data);
    }
    return this.worker;
  }

  /** Loads the worker and model ahead of the first search. */
  warmUp(): void {
    this.ensureWorker();
  }

  search(params: MoveSearchParams, onUpdate: (update: MoveSearchUpdate) => void): void {
    const id = this.nextId++;
    this.listener = (update) => {
      if (update.id === id) onUpdate(update);
    };
    this.ensureWorker().postMessage({ type: "search", id, ...params } satisfies MoveSearchRequest);
  }

  cancel(): void {
    this.listener = null;
    this.worker?.postMessage({ type: "cancel" });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.listener = null;
  }
}
