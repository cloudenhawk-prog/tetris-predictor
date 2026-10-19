import type { MoveSearchMessage, MoveSearchRequest, MoveSearchUpdate, SplitSearchRequest, SplitSearchUpdate } from "@/infrastructure/puzzle/search-worker/protocol";

export type MoveSearchParams = Omit<MoveSearchRequest, "type" | "id">;
export type SplitSearchParams = Omit<SplitSearchRequest, "type" | "id">;

type Update = MoveSearchUpdate | SplitSearchUpdate;

/**
 * Runs move and split searches off the main thread. Starting a search
 * supersedes the previous one; the worker (and the model weights) load on first use.
 */
export class MoveSearchClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private listener: ((update: Update) => void) | null = null;

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL("./move-search.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (event: MessageEvent<Update>) => this.listener?.(event.data);
    }
    return this.worker;
  }

  /** Loads the worker and model ahead of the first search. */
  warmUp(): void {
    this.ensureWorker();
  }

  search(params: MoveSearchParams, onUpdate: (update: MoveSearchUpdate) => void): void {
    this.start({ type: "search", ...params }, onUpdate);
  }

  searchSplits(params: SplitSearchParams, onUpdate: (update: SplitSearchUpdate) => void): void {
    this.start({ type: "split-search", ...params }, onUpdate);
  }

  private start<U extends Update>(
    request: Omit<MoveSearchRequest, "id"> | Omit<SplitSearchRequest, "id">,
    onUpdate: (update: U) => void,
  ): void {
    const id = this.nextId++;
    this.listener = (update) => {
      if (update.id === id) onUpdate(update as U);
    };
    this.ensureWorker().postMessage({ ...request, id } as MoveSearchMessage);
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
