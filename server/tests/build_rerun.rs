//! The build script's rerun list (server/build.rs) covers everything the engine's C API is built from (RV-877): each
//! CMakeLists.txt the top one reaches by add_subdirectory, and each directory the libraries' sources, globs and include
//! directories name. Cargo's own fingerprints are the native build's only guard (scripts/build_images.sh: one fixed
//! folder), so a path missing here would leave an image's server on an old engine while the client's WebAssembly has the
//! new one.

use std::path::{Path, PathBuf};

fn read(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// The rerun list's paths, relative to the engine directory
fn rerun_list(server: &Path) -> Vec<PathBuf> {
    let build = read(&server.join("build.rs"));
    let list = build.split("for dir in [").nth(1).and_then(|rest| rest.split(']').next()).expect("the rerun list");
    list.split('"').filter_map(|s| s.strip_prefix("../engine/")).map(PathBuf::from).collect()
}

/// The directories (relative to the engine directory) a CMakeLists.txt's libraries are built from, and the
/// CMakeLists.txt files it reaches by add_subdirectory
fn cmake_inputs(engine: &Path, dir: &Path, dirs: &mut Vec<PathBuf>, files: &mut Vec<PathBuf>) {
    let text = read(&engine.join(dir).join("CMakeLists.txt"));
    files.push(dir.join("CMakeLists.txt"));
    let args = |line: &str, command: &str| -> Option<Vec<String>> {
        let rest = line.trim().strip_prefix(command)?.strip_prefix('(')?;
        Some(rest.trim_end_matches(')').split_whitespace().map(|a| a.trim_matches('"').to_string()).collect())
    };
    let here = |path: &str| -> PathBuf {
        let path = path.replace("${CMAKE_CURRENT_SOURCE_DIR}/", "").replace("${PROJECT_SOURCE_DIR}/", "");
        dir.join(path)
    };
    for line in text.lines() {
        if let Some(a) = args(line, "add_subdirectory") {
            cmake_inputs(engine, &dir.join(&a[0]), dirs, files);
        }
        for command in ["file", "add_library", "target_include_directories"] {
            let Some(a) = args(line, command) else { continue };
            // (file's mode and variable, a library's or a target's name, before the paths)
            for arg in a.iter().skip(if command == "file" { 2 } else { 1 }) {
                if arg.starts_with("${") && !arg.contains('/')
                    || ["STATIC", "PUBLIC", "PRIVATE", "INTERFACE"].contains(&arg.as_str())
                {
                    continue;
                }
                let path = here(arg);
                // (a source or a glob: its directory; an include directory as named)
                let named = if arg.contains('.') || arg.contains('*') {
                    path.parent().map(Path::to_path_buf)
                } else {
                    Some(path)
                };
                if let Some(d) = named.filter(|d| !d.as_os_str().is_empty()) {
                    dirs.push(d);
                }
            }
        }
    }
}

#[test]
fn the_build_scripts_rerun_list_covers_the_engines_inputs() {
    let server = Path::new(env!("CARGO_MANIFEST_DIR"));
    let engine = server.join("../engine");
    let list = rerun_list(server);
    let (mut dirs, mut files) = (Vec::new(), Vec::new());
    cmake_inputs(&engine, Path::new(""), &mut dirs, &mut files);
    assert!(files.len() >= 2, "the top CMakeLists.txt and RocketSim's: {files:?}");
    for file in &files {
        assert!(list.contains(file), "{} isn't in server/build.rs's rerun list", file.display());
    }
    for dir in &dirs {
        assert!(
            list.iter().any(|entry| dir.starts_with(entry)),
            "{} isn't under any of server/build.rs's rerun paths",
            dir.display()
        );
    }
}
