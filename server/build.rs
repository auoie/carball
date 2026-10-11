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
    println!("cargo:rustc-link-lib=dylib=stdc++");
    for dir in ["../engine/capi", "../engine/net", "../engine/stats", "../engine/rocketsim/src", "../engine/rocketsim/libsrc", "../engine/detmath", "../engine/CMakeLists.txt"] {
        println!("cargo:rerun-if-changed={dir}");
    }
}
