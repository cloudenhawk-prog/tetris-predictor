import type { Rng } from "@/domain/puzzle/row-generator";

/** Fixed-capacity ring buffer of (input, target) pairs stored in flat typed arrays. */
export class ReplayBuffer {
  readonly inputs: Float32Array;
  readonly targets: Float32Array;
  private next = 0;
  size = 0;

  constructor(
    readonly capacity: number,
    readonly inputSize: number,
  ) {
    this.inputs = new Float32Array(capacity * inputSize);
    this.targets = new Float32Array(capacity);
  }

  add(inputs: Float32Array, targets: Float32Array): void {
    for (let i = 0; i < targets.length; i++) {
      this.inputs.set(inputs.subarray(i * this.inputSize, (i + 1) * this.inputSize), this.next * this.inputSize);
      this.targets[this.next] = targets[i] as number;
      this.next = (this.next + 1) % this.capacity;
      this.size = Math.min(this.capacity, this.size + 1);
    }
  }

  sampleIndices(count: number, rng: Rng, out: Uint32Array = new Uint32Array(count)): Uint32Array {
    for (let i = 0; i < count; i++) out[i] = Math.floor(rng() * this.size);
    return out;
  }
}
