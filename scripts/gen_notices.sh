#!/usr/bin/env bash
# The notices of the Rust in the local host's module made again, as the image build makes them and checks them (the
# Dockerfile's rust-notices stage): client/public/THIRD_PARTY_NOTICES-rust.txt, its crates' (cargo-about, pinned, from
# server/Cargo.lock, server/about.toml and server/about.hbs), and THIRD_PARTY_NOTICES-rust-std.html, the standard
# library's (the Rust image's toolchain's own). After a change to the crates, to those two files or to the Rust image.
# From the working tree's files that are committed or would be (as scripts/build_images.sh --worktree). Needs docker with
# buildx (BuildKit) and git.
#   scripts/gen_notices.sh
set -euo pipefail
R=$(cd "$(dirname "$0")/.." && pwd -P)
FILES=(THIRD_PARTY_NOTICES-rust.txt THIRD_PARTY_NOTICES-rust-std.html)
# (the stage's files as a tar on stdout, unpacked into client/public: nothing else there touched)
(cd "$R" && git ls-files -z --cached --others --exclude-standard --deduplicate -- Dockerfile server | tar --null --ignore-failed-read --mode=go-w -T - -cf -) \
	| docker buildx build --target rust-notices-files --output type=tar,dest=- - \
	| tar -x -C "$R/client/public" "${FILES[@]}"
git -C "$R" status --short -- "${FILES[@]/#/client/public/}"
