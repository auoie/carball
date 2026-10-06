cmake_minimum_required(VERSION 3.10)

project(RLEngine CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Patched RocketSim (engine/rocketsim, changes marked "RL PATCH")
add_subdirectory(rocketsim)

set(ARENA_MESH_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../out/arena/collision_meshes")

add_executable(rl_patch_tests tests/rl_patch_tests.cpp)
target_include_directories(rl_patch_tests PRIVATE rocketsim/src)
target_compile_definitions(rl_patch_tests PRIVATE ARENA_MESH_DIR="${ARENA_MESH_DIR}")
target_link_libraries(rl_patch_tests PRIVATE RocketSim)

add_executable(arena_smoketest tests/arena_smoketest.cpp)
target_include_directories(arena_smoketest PRIVATE rocketsim/src)
target_link_libraries(arena_smoketest PRIVATE RocketSim)

enable_testing()
add_test(NAME rl_patch_tests COMMAND rl_patch_tests)
add_test(NAME arena_smoketest COMMAND arena_smoketest ${ARENA_MESH_DIR})
