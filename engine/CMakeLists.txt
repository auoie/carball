cmake_minimum_required(VERSION 3.13)

project(RLEngine C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Deterministic maths (musl's sinf/cosf/... compiled into every build, see detmath/detmath.h)
file(GLOB DETMATH_SOURCES "${CMAKE_CURRENT_SOURCE_DIR}/detmath/src/*.c")
add_library(detmath STATIC ${DETMATH_SOURCES})
set_target_properties(detmath PROPERTIES C_STANDARD 99)
target_compile_options(detmath PRIVATE -ffp-contract=off -fno-fast-math -Wno-unused -Wno-maybe-uninitialized)

# Patched RocketSim (engine/rocketsim, changes marked "RL PATCH")
add_subdirectory(rocketsim)
target_link_libraries(RocketSim PUBLIC detmath)

# Same float results on the native server and the WebAssembly clients: never fuse multiply-adds,
# and all transcendental functions come from detmath
target_compile_options(RocketSim PRIVATE -ffp-contract=off -fno-fast-math)
# ...and Bullet's SSE/NEON vector code is off (PUBLIC: every user of the headers must agree on it)
target_compile_definitions(RocketSim PUBLIC BT_DISABLE_SIMD)

# Network state codec (net/): the native server writes it, the WebAssembly client reads it
add_library(rlnet STATIC net/NetState.cpp)
target_include_directories(rlnet PUBLIC net rocketsim/src)
target_compile_options(rlnet PRIVATE -ffp-contract=off -fno-fast-math)
target_link_libraries(rlnet PUBLIC RocketSim)

# C interface for the native game server (Rust): capi/rlengine.h; the match stats (stats/), server only
if (NOT EMSCRIPTEN)
	add_library(rlstats STATIC stats/StatFactory.cpp stats/PodiumTitles.cpp)
	target_include_directories(rlstats PUBLIC stats rocketsim/src)
	target_compile_options(rlstats PRIVATE -ffp-contract=off -fno-fast-math)
	target_link_libraries(rlstats PUBLIC RocketSim)

	add_library(rlengine_capi STATIC capi/rlengine.cpp)
	target_include_directories(rlengine_capi PUBLIC capi)
	target_compile_options(rlengine_capi PRIVATE -ffp-contract=off -fno-fast-math)
	target_link_libraries(rlengine_capi PUBLIC rlnet rlstats)
endif()

set(ARENA_MESH_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../out/arena/collision_meshes")

if (EMSCRIPTEN)
	# Optimize at link time too (wasm-opt, JS glue); CMake's Release flags only cover compiling
	set(CMAKE_EXE_LINKER_FLAGS_RELEASE "-O3")
endif()

function(engine_program name source)
	add_executable(${name} ${source})
	target_include_directories(${name} PRIVATE rocketsim/src)
	target_compile_options(${name} PRIVATE -ffp-contract=off)
	target_link_libraries(${name} PRIVATE RocketSim rlnet)
	if (EMSCRIPTEN)
		# Node programs: the arena meshes are embedded in the module's virtual file system
		target_compile_definitions(${name} PRIVATE ARENA_MESH_DIR="/collision_meshes")
		target_link_options(${name} PRIVATE
			"SHELL:--embed-file ${ARENA_MESH_DIR}@/collision_meshes"
			-sENVIRONMENT=node -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=5MB -sEXIT_RUNTIME=1)
	else()
		target_compile_definitions(${name} PRIVATE ARENA_MESH_DIR="${ARENA_MESH_DIR}")
	endif()
endfunction()

engine_program(rl_patch_tests tests/rl_patch_tests.cpp)
engine_program(arena_smoketest tests/arena_smoketest.cpp)
engine_program(determinism tests/determinism.cpp)
engine_program(rollback tests/rollback.cpp)
engine_program(netstate tests/netstate.cpp)
if (NOT EMSCRIPTEN)
	engine_program(stats_tests tests/stats_tests.cpp) # the match stats (stats/)
	target_link_libraries(stats_tests PRIVATE rlstats)
	engine_program(replay_validate tools/replay_validate.cpp) # physics vs replays (notes/validation.md)
	engine_program(stats_validate tools/stats_validate.cpp) # the match stats vs replays' player counters
	target_link_libraries(stats_validate PRIVATE rlstats)
	engine_program(live_validate tools/live_validate.cpp) # physics vs recordings of the live game (tools/physlog)
endif()

enable_testing()
add_test(NAME rl_patch_tests COMMAND rl_patch_tests)
if (NOT EMSCRIPTEN)
	add_test(NAME stats_tests COMMAND stats_tests)
endif()
if (EMSCRIPTEN)
	# (the wasm programs read the meshes embedded at /collision_meshes, not the host's directory: RV-94)
	add_test(NAME arena_smoketest COMMAND arena_smoketest /collision_meshes)
else()
	add_test(NAME arena_smoketest COMMAND arena_smoketest ${ARENA_MESH_DIR})
endif()

if (EMSCRIPTEN)
	# The engine module: rlengine.mjs + rlengine.wasm (+ rlengine.d.ts), see wasm/bindings.cpp.
	# rlengine runs in browsers and Node (tests); rlengine_web is the browser-only build the client bundles.
	foreach(variant rlengine rlengine_web)
		add_executable(${variant} wasm/bindings.cpp)
		target_include_directories(${variant} PRIVATE rocketsim/src)
		target_compile_options(${variant} PRIVATE -ffp-contract=off)
		target_link_libraries(${variant} PRIVATE RocketSim rlnet)
		set_target_properties(${variant} PROPERTIES SUFFIX ".mjs")
		if (variant STREQUAL "rlengine")
			set(environment "web,worker,node")
		else()
			set(environment "web,worker")
		endif()
		# (-sDYNAMIC_EXECUTION=0: embind's bindings without eval or new Function, so the page's Content-Security-Policy
		# needs no 'unsafe-eval': RV-371)
		target_link_options(${variant} PRIVATE
			-lembind -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createEngine -sDYNAMIC_EXECUTION=0
			-sENVIRONMENT=${environment} -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=5MB
			"SHELL:--emit-tsd ${variant}.d.mts")
	endforeach()
endif()
