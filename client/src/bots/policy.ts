// A bot package's policy: its ONNX model run by onnxruntime-web (the WebAssembly CPU build, one thread, in the local
// host's worker), observations in, its outputs (the actions' logits) back. Loaded only when a bot match starts.
import type * as OrtModule from "onnxruntime-web/wasm";
import type { PolicySpec } from "./manifest";

type Ort = typeof OrtModule;
type Session = Awaited<ReturnType<Ort["InferenceSession"]["create"]>>;

let ortLoaded: Promise<Ort> | null = null;

/** onnxruntime-web, its WebAssembly file served by the page's bundler, no worker or threads of its own */
function ort(): Promise<Ort> {
  ortLoaded ??= (async () => {
    const [module, wasm] = await Promise.all([import("onnxruntime-web/wasm"), import("onnxruntime-web/ort-wasm-simd-threaded.wasm?url")]);
    module.env.wasm.numThreads = 1;
    module.env.wasm.proxy = false;
    module.env.wasm.wasmPaths = { wasm: wasm.default };
    return module;
  })();
  return ortLoaded;
}

export class OnnxPolicy {
  readonly #session: Session;
  readonly #ort: Ort;
  readonly #spec: PolicySpec;

  private constructor(module: Ort, session: Session, spec: PolicySpec) {
    this.#ort = module;
    this.#session = session;
    this.#spec = spec;
  }

  /** `runtime`: onnxruntime's module as given (the tests': its Node build), else the page's */
  static async create(model: Uint8Array, spec: PolicySpec, runtime?: Ort): Promise<OnnxPolicy> {
    const module = runtime ?? (await ort());
    const session = await module.InferenceSession.create(model, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    return new OnnxPolicy(module, session, spec);
  }

  /** The model on these inputs (by the spec's input names, each its flat values and shape): its first output, flat */
  async run(inputs: readonly { readonly data: Float32Array; readonly shape: readonly number[] }[]): Promise<Float32Array> {
    const feeds: Record<string, InstanceType<Ort["Tensor"]>> = {};
    this.#spec.inputs.forEach((input, i) => {
      const value = inputs[i];
      if (value) feeds[input.name] = new this.#ort.Tensor("float32", value.data, value.shape);
    });
    const output = this.#spec.outputs[0]?.name;
    if (output === undefined) throw new Error("a policy without outputs");
    const results = await this.#session.run(feeds);
    const data = results[output]?.data;
    if (!(data instanceof Float32Array)) throw new Error(`policy output ${output}: not float32`);
    return data;
  }
}
