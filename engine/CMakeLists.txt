cmake_minimum_required(VERSION 3.10)

project(RLEngine CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Patched RocketSim (engine/rocketsim, changes marked "RL PATCH")
add_subdirectory(rocketsim)

# Same float results everywhere: never fuse multiply-adds (client and server must agree)
target_compile_options(RocketSim PRIVATE -ffp-contract=off)

set(ARENA_MESH_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../out/arena/collision_meshes")

if (EMSCRIPTEN)
	# Optimize at link time too (wasm-opt, JS glue); CMake's Release flags only cover compiling
	set(CMAKE_EXE_LINKER_FLAGS_RELEASE "-O3")
endif()

function(engine_program name source)
	add_executable(${name} ${source})
	target_include_directories(${name} PRIVATE rocketsim/src)
	target_compile_options(${name} PRIVATE -ffp-contract=off)
	target_link_libraries(${name} PRIVATE RocketSim)
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

enable_testing()
add_test(NAME rl_patch_tests COMMAND rl_patch_tests)
add_test(NAME arena_smoketest COMMAND arena_smoketest ${ARENA_MESH_DIR})

if (EMSCRIPTEN)
	# The browser/Node module: rlengine.mjs + rlengine.wasm (see wasm/bindings.cpp)
	add_executable(rlengine wasm/bindings.cpp)
	target_include_directories(rlengine PRIVATE rocketsim/src)
	target_compile_options(rlengine PRIVATE -ffp-contract=off)
	target_link_libraries(rlengine PRIVATE RocketSim)
	set_target_properties(rlengine PROPERTIES SUFFIX ".mjs")
	target_link_options(rlengine PRIVATE
		-lembind -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createEngine
		-sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=5MB)
endif()
