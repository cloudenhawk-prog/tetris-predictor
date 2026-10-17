/**
 * Minimal dependency-free multilayer perceptron (ReLU hidden layers, linear
 * scalar output). Runs in the browser for inference and in Node for training.
 * All parameters live in one Float32Array so they can be serialized or sent to
 * worker threads cheaply.
 */

export interface MlpSnapshot {
  sizes: number[];
  /** Base64-encoded little-endian Float32 parameters. */
  params: string;
}

interface LayerView {
  inSize: number;
  outSize: number;
  w: Float32Array;
  b: Float32Array;
  wOffset: number;
  bOffset: number;
}

export function parameterCount(sizes: number[]): number {
  let n = 0;
  for (let l = 1; l < sizes.length; l++) n += (sizes[l - 1] ?? 0) * (sizes[l] ?? 0) + (sizes[l] ?? 0);
  return n;
}

export class Mlp {
  readonly params: Float32Array;
  private readonly layers: LayerView[] = [];
  private readonly activations: Float32Array[];

  constructor(
    readonly sizes: number[],
    params?: Float32Array,
  ) {
    const count = parameterCount(sizes);
    if (params && params.length !== count) {
      throw new Error(`Expected ${count} parameters for [${sizes.join(", ")}], got ${params.length}`);
    }
    this.params = params ?? new Float32Array(count);
    let offset = 0;
    for (let l = 1; l < sizes.length; l++) {
      const inSize = sizes[l - 1] ?? 0;
      const outSize = sizes[l] ?? 0;
      const wOffset = offset;
      const bOffset = offset + inSize * outSize;
      this.layers.push({
        inSize,
        outSize,
        wOffset,
        bOffset,
        w: this.params.subarray(wOffset, bOffset),
        b: this.params.subarray(bOffset, bOffset + outSize),
      });
      offset = bOffset + outSize;
    }
    this.activations = sizes.map((size) => new Float32Array(size));
  }

  get inputSize(): number {
    return this.sizes[0] ?? 0;
  }

  /** He-initialised weights, zero biases. */
  static random(sizes: number[], rng: () => number = Math.random): Mlp {
    const mlp = new Mlp(sizes);
    for (const layer of mlp.layers) {
      const scale = Math.sqrt(2 / layer.inSize);
      for (let i = 0; i < layer.w.length; i++) {
        // Box–Muller normal sample.
        const u = 1 - rng();
        const v = rng();
        layer.w[i] = scale * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      }
    }
    return mlp;
  }

  static fromSnapshot(snapshot: MlpSnapshot): Mlp {
    return new Mlp(snapshot.sizes, decodeFloat32(snapshot.params));
  }

  toSnapshot(): MlpSnapshot {
    return { sizes: [...this.sizes], params: encodeFloat32(this.params) };
  }

  forward(input: Float32Array): number {
    this.run(input);
    return this.activations[this.activations.length - 1]?.[0] ?? 0;
  }

  /** Forward pass keeping every layer's activations for backprop. */
  private run(input: Float32Array): void {
    this.activations[0]?.set(input.subarray(0, this.inputSize));
    const last = this.layers.length - 1;
    for (let l = 0; l <= last; l++) {
      const { inSize, outSize, w, b } = this.layers[l] as LayerView;
      const x = this.activations[l] as Float32Array;
      const y = this.activations[l + 1] as Float32Array;
      for (let o = 0; o < outSize; o++) {
        let sum = b[o] as number;
        const row = o * inSize;
        for (let i = 0; i < inSize; i++) sum += (w[row + i] as number) * (x[i] as number);
        y[o] = l === last || sum > 0 ? sum : 0;
      }
    }
  }

  /** Adds d(0.5·(out − target)²)/dθ into `grad`; returns the squared error. */
  accumulateGradient(input: Float32Array, target: number, grad: Float32Array, deltas: Float32Array[]): number {
    this.run(input);
    const last = this.layers.length - 1;
    const out = (this.activations[last + 1] as Float32Array)[0] as number;
    const err = out - target;
    (deltas[last + 1] as Float32Array)[0] = err;
    for (let l = last; l >= 0; l--) {
      const { inSize, outSize, w, wOffset, bOffset } = this.layers[l] as LayerView;
      const x = this.activations[l] as Float32Array;
      const dy = deltas[l + 1] as Float32Array;
      const dx = deltas[l] as Float32Array;
      if (l > 0) dx.fill(0);
      for (let o = 0; o < outSize; o++) {
        const d = dy[o] as number;
        if (d === 0) continue;
        grad[bOffset + o] = (grad[bOffset + o] as number) + d;
        const row = o * inSize;
        for (let i = 0; i < inSize; i++) {
          grad[wOffset + row + i] = (grad[wOffset + row + i] as number) + d * (x[i] as number);
          if (l > 0) dx[i] = (dx[i] as number) + d * (w[row + i] as number);
        }
      }
      // ReLU derivative for the layer below.
      if (l > 0) for (let i = 0; i < inSize; i++) if ((x[i] as number) <= 0) dx[i] = 0;
    }
    return err * err;
  }

  createDeltaBuffers(): Float32Array[] {
    return this.sizes.map((size) => new Float32Array(size));
  }
}

/** Adam optimiser with optional L2 weight decay. */
export class AdamTrainer {
  private readonly m: Float32Array;
  private readonly v: Float32Array;
  private readonly grad: Float32Array;
  private readonly deltas: Float32Array[];
  private step = 0;

  constructor(
    private readonly mlp: Mlp,
    public learningRate = 1e-3,
    private readonly weightDecay = 0,
    private readonly beta1 = 0.9,
    private readonly beta2 = 0.999,
    private readonly epsilon = 1e-8,
  ) {
    this.m = new Float32Array(mlp.params.length);
    this.v = new Float32Array(mlp.params.length);
    this.grad = new Float32Array(mlp.params.length);
    this.deltas = mlp.createDeltaBuffers();
  }

  /**
   * One gradient step on the samples at `indices`. `inputs` holds samples back to
   * back (`inputSize` floats each). Returns the mean squared error.
   */
  trainBatch(inputs: Float32Array, targets: Float32Array, indices: ArrayLike<number>): number {
    const size = this.mlp.inputSize;
    this.grad.fill(0);
    let loss = 0;
    for (let k = 0; k < indices.length; k++) {
      const idx = indices[k] as number;
      loss += this.mlp.accumulateGradient(
        inputs.subarray(idx * size, (idx + 1) * size),
        targets[idx] as number,
        this.grad,
        this.deltas,
      );
    }
    this.step++;
    const n = indices.length;
    const { params } = this.mlp;
    const c1 = 1 - this.beta1 ** this.step;
    const c2 = 1 - this.beta2 ** this.step;
    for (let i = 0; i < params.length; i++) {
      const g = (this.grad[i] as number) / n + this.weightDecay * (params[i] as number);
      const m = this.beta1 * (this.m[i] as number) + (1 - this.beta1) * g;
      const v = this.beta2 * (this.v[i] as number) + (1 - this.beta2) * g * g;
      this.m[i] = m;
      this.v[i] = v;
      params[i] = (params[i] as number) - (this.learningRate * (m / c1)) / (Math.sqrt(v / c2) + this.epsilon);
    }
    return loss / n;
  }
}

export function encodeFloat32(values: Float32Array): string {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function decodeFloat32(encoded: string): Float32Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}
