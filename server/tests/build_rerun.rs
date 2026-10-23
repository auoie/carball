//! The build script's rerun list (server/build.rs) covers everything the engine's C API is built from (RV-877): each
//! CMakeLists.txt the top one reaches by add_subdirectory, each file it include()s, and each directory the libraries'
//! sources, globs and include directories name. Cargo's own fingerprints are the native build's only guard
//! (scripts/build_images.sh: one fixed folder), so a path missing here would leave an image's server on an old engine
//! while the client's WebAssembly has the new one. The CMake files are read as CMake reads them (RV-899): commands in any
//! case, a space before the parenthesis, arguments over several lines, `#` comments, `set` variables.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

fn read(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// A line with its `//` comment cut (one outside a string)
fn without_comment(line: &str) -> &str {
    let mut quoted = false;
    let mut prev = ' ';
    for (i, c) in line.char_indices() {
        if c == '"' && prev != '\\' {
            quoted = !quoted;
        } else if c == '/' && prev == '/' && !quoted {
            return &line[..i - 1];
        }
        prev = c;
    }
    line
}

/// The rerun list's paths in a build script's text, relative to the engine directory (a commented-out entry isn't one:
/// cargo doesn't watch it)
fn rerun_list(build: &str) -> Vec<PathBuf> {
    let code: String = build.lines().map(|l| format!("{}\n", without_comment(l))).collect();
    let list = code.split("for dir in [").nth(1).and_then(|rest| rest.split(']').next()).expect("the rerun list");
    list.split('"').filter_map(|s| s.strip_prefix("../engine/")).map(PathBuf::from).collect()
}

/// A CMake file's commands in order: each name in lower case and its arguments (quotes taken off; `#` comments, line
/// breaks and nested parentheses as CMake reads them)
fn commands(text: &str) -> Vec<(String, Vec<String>)> {
    let mut code = String::new();
    for line in text.lines() {
        let mut quoted = false;
        for c in line.chars() {
            if c == '"' {
                quoted = !quoted;
            } else if c == '#' && !quoted {
                break;
            }
            code.push(c);
        }
        code.push('\n');
    }
    let chars: Vec<char> = code.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if !(chars[i].is_ascii_alphabetic() || chars[i] == '_')
            || (i > 0 && (chars[i - 1].is_ascii_alphanumeric() || chars[i - 1] == '_'))
        {
            i += 1;
            continue;
        }
        let start = i;
        while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
            i += 1;
        }
        let name: String = chars[start..i].iter().collect::<String>().to_ascii_lowercase();
        let mut j = i;
        while j < chars.len() && (chars[j] == ' ' || chars[j] == '\t') {
            j += 1;
        }
        if j >= chars.len() || chars[j] != '(' {
            continue;
        }
        let (mut depth, mut quoted, mut k) = (0, false, j);
        let mut args = Vec::new();
        let mut arg = String::new();
        while k < chars.len() {
            let c = chars[k];
            k += 1;
            match c {
                '"' => quoted = !quoted,
                '(' if !quoted => {
                    depth += 1;
                    if depth > 1 {
                        arg.push(c);
                    }
                }
                ')' if !quoted => {
                    depth -= 1;
                    if depth == 0 {
                        break;
                    }
                    arg.push(c);
                }
                c if c.is_whitespace() && !quoted => {
                    if !arg.is_empty() {
                        args.push(std::mem::take(&mut arg));
                    }
                }
                c => arg.push(c),
            }
        }
        if !arg.is_empty() {
            args.push(arg);
        }
        out.push((name, args));
        i = k;
    }
    out
}

/// What one CMakeLists.txt (in `dir`, relative to the engine directory) builds from: the directories its libraries'
/// sources, globs and include directories name, the files it include()s and the directories it add_subdirectory's
fn inputs_of(dir: &Path, text: &str) -> (Vec<PathBuf>, Vec<PathBuf>, Vec<PathBuf>) {
    let (mut dirs, mut files, mut subdirs) = (Vec::new(), Vec::new(), Vec::new());
    let mut vars: HashMap<String, String> =
        [("CMAKE_CURRENT_SOURCE_DIR", "."), ("PROJECT_SOURCE_DIR", "."), ("CMAKE_CURRENT_LIST_DIR", ".")]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
    let keywords = [
        "STATIC",
        "SHARED",
        "OBJECT",
        "MODULE",
        "INTERFACE",
        "PUBLIC",
        "PRIVATE",
        "SYSTEM",
        "BEFORE",
        "AFTER",
        "OPTIONAL",
        "EXCLUDE_FROM_ALL",
        "CONFIGURE_DEPENDS",
        "LIST_DIRECTORIES",
        "true",
        "false",
    ];
    for (name, args) in commands(text) {
        let resolve = |arg: &str| -> String {
            let mut out = arg.to_string();
            for (k, v) in &vars {
                out = out.replace(&format!("${{{k}}}"), v);
            }
            out
        };
        // (the arguments before the paths: file's mode and variable, a library's or a target's name)
        let skip = match name.as_str() {
            "set" => {
                if let [var, value] = args.as_slice() {
                    let value = resolve(value);
                    vars.insert(var.clone(), value);
                }
                continue;
            }
            "add_subdirectory" => {
                subdirs.push(dir.join(resolve(&args[0])));
                continue;
            }
            "file" => 2,
            "add_library" | "target_sources" | "target_include_directories" => 1,
            "include_directories" | "include" => 0,
            _ => continue,
        };
        for arg in args.iter().skip(skip) {
            if keywords.contains(&arg.as_str()) || arg.starts_with("$<") {
                continue;
            }
            // (a list variable of sources, globbed above: those are read there)
            if arg.starts_with("${") && arg.ends_with('}') && !arg.contains('/') {
                continue;
            }
            let path = resolve(arg);
            assert!(
                !path.contains("${"),
                "{}: can't resolve {arg} in {name}(): teach this guard its variable",
                dir.display()
            );
            if name == "include" {
                // (a module of CMake's own, by name: no file of ours)
                if path.contains('/') || path.contains('.') {
                    files.push(dir.join(path));
                }
                continue;
            }
            let path = dir.join(path.trim_start_matches("./"));
            // (a source or a glob: its directory; an include directory as named)
            let named =
                if arg.contains('.') || arg.contains('*') { path.parent().map(Path::to_path_buf) } else { Some(path) };
            if let Some(d) = named.filter(|d| !d.as_os_str().is_empty()) {
                dirs.push(d);
            }
        }
    }
    (dirs, files, subdirs)
}

/// What the CMakeLists.txt in `dir` builds from, the files it reaches by add_subdirectory followed
fn cmake_inputs(engine: &Path, dir: &Path, dirs: &mut Vec<PathBuf>, files: &mut Vec<PathBuf>) {
    files.push(dir.join("CMakeLists.txt"));
    let (d, f, subdirs) = inputs_of(dir, &read(&engine.join(dir).join("CMakeLists.txt")));
    dirs.extend(d);
    files.extend(f);
    for sub in subdirs {
        cmake_inputs(engine, &sub, dirs, files);
    }
}

#[test]
fn the_build_scripts_rerun_list_covers_the_engines_inputs() {
    let server = Path::new(env!("CARGO_MANIFEST_DIR"));
    let engine = server.join("../engine");
    let list = rerun_list(&read(&server.join("build.rs")));
    let (mut dirs, mut files) = (Vec::new(), Vec::new());
    cmake_inputs(&engine, Path::new(""), &mut dirs, &mut files);
    assert!(files.len() >= 2, "the top CMakeLists.txt and RocketSim's: {files:?}");
    for file in &files {
        assert!(
            list.contains(file) || list.iter().any(|entry| file.starts_with(entry) && entry.extension().is_none()),
            "{} isn't in server/build.rs's rerun list",
            file.display()
        );
    }
    for dir in &dirs {
        assert!(
            list.iter().any(|entry| dir.starts_with(entry)),
            "{} isn't under any of server/build.rs's rerun paths",
            dir.display()
        );
    }
}

/// The readers on made-up files: what CMake reads, this reads (RV-899's cases)
#[test]
fn the_guard_reads_cmake_and_the_build_script_as_they_are_read() {
    let build = "for dir in [\n    \"../engine/a\",\n    // \"../engine/b\",\n    \"../engine/c\", // (a note)\n] {";
    assert_eq!(rerun_list(build), [PathBuf::from("a"), PathBuf::from("c")]);
    let text = r#"
        set(SRC "${CMAKE_CURRENT_SOURCE_DIR}/gen")
        ADD_LIBRARY (one STATIC
            one/a.cpp   # a comment (with a parenthesis
            "two/b.cpp")
        target_sources(one PRIVATE ${SRC}/c.cpp $<$<CONFIG:Debug>:dbg/d.cpp>)
        include_directories(SYSTEM inc)
        Target_Include_Directories(one PUBLIC api)
        include(cmake/flags.cmake)
        include(GNUInstallDirs)
        file(GLOB_RECURSE ALL CONFIGURE_DEPENDS "${PROJECT_SOURCE_DIR}/deep/*.h")
        add_library(two ${ALL})
        add_subdirectory(sub)
        if (WIN32) # nothing
        endif()
    "#;
    let (dirs, files, subdirs) = inputs_of(Path::new("e"), text);
    let names = |v: &[PathBuf]| v.iter().map(|p| p.display().to_string()).collect::<Vec<_>>();
    assert_eq!(names(&dirs), ["e/one", "e/two", "e/gen", "e/inc", "e/api", "e/deep"]);
    assert_eq!(names(&files), ["e/cmake/flags.cmake"]);
    assert_eq!(names(&subdirs), ["e/sub"]);
}

#[test]
#[should_panic(expected = "can't resolve")]
fn the_guard_refuses_a_path_it_cant_resolve() {
    inputs_of(Path::new(""), "add_library(x STATIC ${UNKNOWN}/a.cpp)");
}
