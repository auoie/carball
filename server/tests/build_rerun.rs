//! The build script's rerun list (server/build.rs) covers everything the engine's C API is built from (RV-877): each
//! CMakeLists.txt the top one reaches by add_subdirectory, each file it include()s, and each directory the libraries'
//! sources, globs and include directories name. Cargo's own fingerprints decide when a development build rebuilds the
//! engine, so a path missing here would leave a server on an old engine while the client's WebAssembly has the new one.
//! (The image build doesn't depend on it: its server links the engine's libraries from their own Dockerfile stage,
//! rebuilt whenever the engine's files change, CARBALL_ENGINE_NATIVE.) The CMake files are read as CMake reads them (RV-899): commands in any
//! case, a space before the parenthesis, arguments over several lines, `#` comments, `set` variables.

use std::collections::{HashMap, HashSet};
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

/// A Rust text with its `/* */` comments cut (nested ones too; one inside a string kept)
fn without_block_comments(text: &str) -> String {
    let (mut out, mut depth, mut quoted) = (String::new(), 0, false);
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let (c, next) = (chars[i], chars.get(i + 1).copied());
        if depth == 0 && c == '"' && (i == 0 || chars[i - 1] != '\\') {
            quoted = !quoted;
        }
        if !quoted && c == '/' && next == Some('*') {
            depth += 1;
            i += 2;
            continue;
        }
        if depth > 0 && c == '*' && next == Some('/') {
            depth -= 1;
            i += 2;
            continue;
        }
        if depth == 0 {
            out.push(c);
        }
        i += 1;
    }
    out
}

/// The rerun list's paths in a build script's text, relative to the engine directory (a commented-out entry isn't one:
/// cargo doesn't watch it)
fn rerun_list(build: &str) -> Vec<PathBuf> {
    let code: String = without_block_comments(build).lines().map(|l| format!("{}\n", without_comment(l))).collect();
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

/// An argument with its variables put in: a lone list variable gives each of its values, a glob's list none (its files
/// read where it's made); one in a longer argument its single value
fn expand(vars: &HashMap<String, Vec<String>>, globbed: &HashSet<String>, arg: &str) -> Vec<String> {
    if let Some(var) = arg.strip_prefix("${").and_then(|a| a.strip_suffix('}')).filter(|v| !v.contains("${")) {
        if let Some(values) = vars.get(var) {
            return values.clone();
        }
        if globbed.contains(var) {
            return Vec::new();
        }
    }
    let mut out = arg.to_string();
    for (k, v) in vars {
        if v.len() == 1 {
            out = out.replace(&format!("${{{k}}}"), &v[0]);
        }
    }
    vec![out]
}

/// What one CMakeLists.txt (in `dir`, relative to the engine directory) builds from: the directories its libraries'
/// sources, globs and include directories name, the files it include()s and the directories it add_subdirectory's
fn inputs_of(dir: &Path, text: &str) -> (Vec<PathBuf>, Vec<PathBuf>, Vec<PathBuf>) {
    let (mut dirs, mut files, mut subdirs) = (Vec::new(), Vec::new(), Vec::new());
    // (each variable's values: `set`'s, `list(APPEND)`'s; the source directory's own names "."; a file(GLOB) or
    // aux_source_directory list: its files read where it's made, RV-910)
    let mut vars: HashMap<String, Vec<String>> =
        ["CMAKE_CURRENT_SOURCE_DIR", "PROJECT_SOURCE_DIR", "CMAKE_CURRENT_LIST_DIR"]
            .into_iter()
            .map(|k| (k.to_string(), vec![".".to_string()]))
            .collect();
    let mut globbed: HashSet<String> = HashSet::new();
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
        // (the arguments before the paths: file's mode and variable, a library's or a target's name)
        let skip = match name.as_str() {
            "set" => {
                if let Some((var, rest)) = args.split_first() {
                    let end = rest.iter().position(|a| a == "CACHE" || a == "PARENT_SCOPE").unwrap_or(rest.len());
                    let values = rest[..end].iter().flat_map(|a| expand(&vars, &globbed, a)).collect();
                    vars.insert(var.clone(), values);
                }
                continue;
            }
            "list" => {
                if let [mode, var, items @ ..] = args.as_slice()
                    && mode == "APPEND"
                {
                    let added: Vec<String> = items.iter().flat_map(|a| expand(&vars, &globbed, a)).collect();
                    vars.entry(var.clone()).or_default().extend(added);
                }
                continue;
            }
            "add_subdirectory" => {
                subdirs.push(dir.join(&expand(&vars, &globbed, &args[0])[0]));
                continue;
            }
            "file" => {
                if let Some(var) = args.get(1) {
                    globbed.insert(var.clone());
                }
                2
            }
            "aux_source_directory" => {
                if let Some(var) = args.get(1) {
                    globbed.insert(var.clone());
                }
                dirs.push(dir.join(expand(&vars, &globbed, &args[0])[0].trim_start_matches("./")));
                continue;
            }
            "configure_file" => {
                files.push(dir.join(expand(&vars, &globbed, &args[0])[0].trim_start_matches("./")));
                continue;
            }
            "add_library" | "target_sources" | "target_include_directories" => 1,
            "include_directories" | "include" => 0,
            _ => continue,
        };
        for arg in args.iter().skip(skip) {
            if keywords.contains(&arg.as_str()) || arg.starts_with("$<") {
                continue;
            }
            for path in expand(&vars, &globbed, arg) {
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
                let named = dir.join(path.trim_start_matches("./"));
                // (a source or a glob, by its last part: its directory; an include directory as named)
                let leaf = named.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
                let named = if leaf.contains('.') || leaf.contains('*') {
                    named.parent().map(Path::to_path_buf)
                } else {
                    Some(named)
                };
                if let Some(d) = named.filter(|d| !d.as_os_str().is_empty()) {
                    dirs.push(d);
                }
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
    // (RV-910: a block comment in the build script; list variables, a cached one, an appended one, a source
    // directory's list, a configured file)
    let build =
        "for dir in [\n    \"../engine/a\",\n    /* \"../engine/b\",\n    /* nested */ */ \"../engine/c\",\n] {";
    assert_eq!(rerun_list(build), [PathBuf::from("a"), PathBuf::from("c")]);
    let text = r#"
        set(LIST "x/a.cpp" y/b.cpp)
        set(INC "${CMAKE_CURRENT_SOURCE_DIR}/inc2" CACHE PATH "the includes")
        list(APPEND LIST z/c.cpp)
        add_library(three ${LIST})
        include_directories(${INC})
        aux_source_directory(aux AUX_SRC)
        add_library(four ${AUX_SRC})
        configure_file(conf/version.h.in version.h)
    "#;
    let (dirs, files, _) = inputs_of(Path::new("e"), text);
    assert_eq!(names(&dirs), ["e/x", "e/y", "e/z", "e/inc2", "e/aux"]);
    assert_eq!(names(&files), ["e/conf/version.h.in"]);
}

#[test]
#[should_panic(expected = "can't resolve")]
fn the_guard_refuses_a_path_it_cant_resolve() {
    inputs_of(Path::new(""), "add_library(x STATIC ${UNKNOWN}/a.cpp)");
}

/// The Dockerfile's last stage, what a build with no --target makes, is a release image, never an e2e one (RV-1042); the
/// release server's cargo build takes no features, the e2e one's `e2e` alone (RV-1045), and the Go builds' tags likewise
/// (RV-1058); the e2e markers' lists agree (RV-1057)
#[test]
fn the_dockerfile_ends_on_a_release_stage_and_only_the_e2e_build_has_its_feature() {
    let dockerfile = read(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../Dockerfile"));
    let stages: Vec<&str> = dockerfile.lines().filter(|l| l.starts_with("FROM ")).collect();
    let last = stages.last().unwrap();
    assert!(!last.contains("-e2e"), "the last stage {last:?}");
    let joined = dockerfile.replace("\\\n", " ");
    let mut stage = "";
    let mut builds = Vec::new();
    for line in joined.lines() {
        if let Some(name) = line.strip_prefix("FROM ").and_then(|l| l.split(" AS ").nth(1)) {
            stage = name.trim();
        } else if line.starts_with("RUN ") && line.contains("cargo build") {
            builds.push((stage, line.contains("--features e2e"), line.contains("--features")));
        }
    }
    assert_eq!(
        builds,
        [("server", false, false), ("server-e2e", true, true)],
        "the cargo builds: (stage, e2e, any features)"
    );
    // (the Go builds the same: the e2e tag in the api-e2e build's alone, RV-1058)
    let mut stage = "";
    let mut go = Vec::new();
    for line in joined.lines() {
        if let Some(name) = line.strip_prefix("FROM ").and_then(|l| l.split(" AS ").nth(1)) {
            stage = name.trim();
        } else if line.starts_with("RUN ") && line.contains(" go build ") {
            go.push((stage, line.contains("-tags e2e"), line.contains("-tags")));
        }
    }
    assert_eq!(
        go,
        [("api-build", false, false), ("api-e2e-build", true, true)],
        "the go builds: (stage, e2e, any tags)"
    );
    // (the e2e markers written out in three places, never a build argument one could empty: the release checks' list
    // the game's and the API's together, each e2e image checking its own, RV-1057)
    let lists: Vec<Vec<&str>> = joined
        .lines()
        .filter_map(|l| l.split("for m in ").nth(1).and_then(|rest| rest.split("; do").next()))
        .map(|list| list.split_whitespace().collect())
        .collect();
    assert_eq!(lists.len(), 3, "the release checks' marker list and the two e2e images': {lists:?}");
    let (game, api) = (&lists[1], &lists[2]);
    assert!(!game.is_empty() && !api.is_empty() && lists[0] == [game.as_slice(), api.as_slice()].concat(), "{lists:?}");
}

/// The image build's cargo builds of the server's crate each clean it first (RV-927): its cache-mounted target dir would
/// otherwise let cargo's fingerprints decide, and the files' times are no guide there (the context's are the commit's; an
/// engine library from the layer cache keeps an old one), so a revert could ship the build before it
#[test]
fn the_image_builds_clean_the_servers_crate_before_each_build() {
    let dockerfile = read(&Path::new(env!("CARGO_MANIFEST_DIR")).join("../Dockerfile"));
    let joined = dockerfile.replace("\\\n", " ");
    let builds: Vec<&str> = joined
        .lines()
        .filter(|l| l.starts_with("RUN ") && (l.contains("cargo build") || l.contains("build_host.sh host")))
        .collect();
    assert_eq!(builds.len(), 3, "the server's, its e2e build's and the local host's: {builds:?}");
    for run in builds {
        let clean = run.find("cargo clean --release -p carball-server");
        let build = run.find("cargo build").or_else(|| run.find("build_host.sh host"));
        assert!(clean.is_some() && clean < build, "a build without its clean first: {run}");
    }
}
