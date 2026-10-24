// The browser's local host module (server/src/bin/host.rs built by scripts/build_host.sh into engine/build-wasm-host; the
// alias @host): its exports, as the Rust declares them (usize and u32 as numbers, pointers as offsets into HEAPU8)
declare module "@host/carball_host.mjs" {
  export interface HostModule {
    _host_init(dir: number): number;
    _host_open(teamSize: number, seed: number): void;
    _host_connect(id: number): void;
    _host_control(id: number, bytes: number, len: number, now: number): void;
    _host_datagram(id: number, bytes: number, len: number, now: number): void;
    _host_leave(id: number): void;
    _host_tick(now: number): void;
    _host_next_tick(): number;
    _host_drain(): number;
    _host_drained(): number;
    _host_bot(id: number, throttle: number, steer: number, pitch: number, yaw: number, roll: number, jump: number, boost: number, handbrake: number): void;
    _host_car(id: number): number;
    _host_phase(id: number): number;
    _host_input_stat(id: number, which: number): number;
    _host_state(id: number): number;
    _host_state_bytes(): number;
    _malloc(size: number): number;
    _free(pointer: number): void;
    stringToNewUTF8(text: string): number;
    readonly HEAPU8: Uint8Array;
    readonly FS: {
      mkdir(path: string): void;
      writeFile(path: string, data: Uint8Array): void;
    };
  }
  export default function createHost(options?: {
    readonly wasmBinary?: ArrayBuffer;
    readonly locateFile?: (path: string) => string;
    /** The host's log lines (the server's stderr: joins, leaves) */
    readonly printErr?: (text: string) => void;
  }): Promise<HostModule>;
}
