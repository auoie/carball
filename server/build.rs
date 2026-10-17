// Builds the engine's C API (engine/capi) with CMake and links it statically.
/// The browser's local host's exports (src/bin/host.rs), its module's runtime calls
const HOST_EXPORTS: &[&str] = &[
    "host_init", "host_open", "host_connect", "host_control", "host_datagram", "host_leave", "host_tick", "host_next_tick", "host_drain", "host_drained",
    "host_bot", "host_car", "host_phase", "host_state", "host_state_bytes", "malloc", "free",
];

fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("emscripten") {
        local_host();
        return;
    }
    let dst = cmake::Config::new("../engine")
        .build_target("rlengine_capi")
        .profile("Release")
        .build();
    let build = dst.join("build");
    println!("cargo:rustc-link-search=native={}", build.display());
    println!("cargo:rustc-link-search=native={}", build.join("rocketsim").display());
    for lib in ["rlengine_capi", "rlnet", "rlstats", "RocketSim", "detmath"] {
        println!("cargo:rustc-link-lib=static={lib}");
    }
    // libstdc++ linked in (the release image runs on an older distribution's runtime than the toolchain's: APP-CONTRACT.md),
    // where the toolchain has its archive; else the shared one
    let archive = std::process::Command::new(std::env::var("CXX").unwrap_or_else(|_| "c++".into()))
        .arg("-print-file-name=libstdc++.a")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|p| p.contains('/') && std::path::Path::new(p).exists());
    match archive {
        Some(path) => {
            let dir = std::path::Path::new(&path).parent().unwrap().display().to_string();
            println!("cargo:rustc-link-search=native={dir}");
            println!("cargo:rustc-link-lib=static=stdc++");
        }
        None => println!("cargo:rustc-link-lib=dylib=stdc++"),
    }
    for dir in ["../engine/capi", "../engine/net", "../engine/stats", "../engine/rocketsim/src", "../engine/rocketsim/libsrc", "../engine/detmath", "../engine/CMakeLists.txt"] {
        println!("cargo:rerun-if-changed={dir}");
    }
}

/// The browser's local host (wasm32-unknown-emscripten): the engine's libraries as Emscripten built them
/// (scripts/build_host.sh: CARBALL_ENGINE_WASM, else engine/build-wasm-host), the module an ES module whose calls are
/// the host's exports (client/src/local/)
fn local_host() {
    let dir = std::env::var("CARBALL_ENGINE_WASM").unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/../engine/build-wasm-host").to_string());
    println!("cargo:rerun-if-env-changed=CARBALL_ENGINE_WASM");
    println!("cargo:rustc-link-search=native={dir}");
    println!("cargo:rustc-link-search=native={dir}/rocketsim");
    for lib in ["rlengine_capi", "rlnet", "rlstats", "RocketSim", "detmath"] {
        println!("cargo:rustc-link-lib=static={lib}");
        println!("cargo:rerun-if-changed={dir}/lib{lib}.a");
    }
    let exports = HOST_EXPORTS.iter().map(|e| format!("_{e}")).collect::<Vec<_>>().join(",");
    for arg in [
        "-O3".to_string(),
        "-sMODULARIZE=1".into(),
        "-sEXPORT_ES6=1".into(),
        "-sEXPORT_NAME=createHost".into(),
        "-sENVIRONMENT=web,worker,node".into(),
        "-sALLOW_MEMORY_GROWTH=1".into(),
        "-sSTACK_SIZE=5MB".into(),
        "-sINVOKE_RUN=0".into(),
        // (Rust's unwinding on this target is Emscripten's JavaScript exceptions: their catching on)
        "-sDISABLE_EXCEPTION_CATCHING=0".into(),
        "-sFORCE_FILESYSTEM=1".into(),
        // (no eval or new Function: the page's Content-Security-Policy, as the engine module's: RV-371)
        "-sDYNAMIC_EXECUTION=0".into(),
        format!("-sEXPORTED_FUNCTIONS={exports}"),
        "-sEXPORTED_RUNTIME_METHODS=FS,HEAPU8,stringToNewUTF8".into(),
    ] {
        println!("cargo:rustc-link-arg-bin=carball-host={arg}");
    }
}
