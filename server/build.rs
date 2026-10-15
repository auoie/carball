// Builds the engine's C API (engine/capi) with CMake and links it statically.
fn main() {
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
