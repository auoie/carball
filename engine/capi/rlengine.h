/* C interface to the engine for the native game server (and anything else that is not C++).
 * One arena = one match. Not thread-safe per arena; separate arenas can run on separate threads. */
#ifndef RLENGINE_H
#define RLENGINE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct RLArena RLArena;

typedef struct RLControls {
	float throttle, steer, pitch, yaw, roll; /* -1..1 */
	uint8_t jump, boost, handbrake;
	uint8_t air_pitch_safety; /* keyboard air pitch safety holds back nose-down pitch (engine patch 22) */
} RLControls;

enum { RL_EVENT_GOAL = 0, RL_EVENT_BUMP = 1, RL_EVENT_DEMO = 2 };

/* Loads the arena collision meshes (a directory with soccar/*.cmf). Call once. Returns 0 on failure. */
int rl_init(const char* collision_mesh_dir);

RLArena* rl_arena_create(void);
void rl_arena_destroy(RLArena* arena);

/* team 0 blue / 1 orange; body 0 Octane, 1 Dominus, 2 Plank, 3 Breakout, 4 Hybrid, 5 Merc. Returns the car ID (> 0). */
uint32_t rl_add_car(RLArena* arena, int team, int body);
int rl_remove_car(RLArena* arena, uint32_t car_id);
void rl_set_controls(RLArena* arena, uint32_t car_id, const RLControls* controls);
void rl_set_car_preferences(RLArena* arena, uint32_t car_id, float dodge_deadzone, float steering_sensitivity,
	float air_control_sensitivity);

void rl_step(RLArena* arena, int ticks);
void rl_reset_kickoff(RLArena* arena, int seed);
/* Ball to the centre, at rest (after a goal) */
void rl_reset_ball(RLArena* arena);
uint64_t rl_tick_count(const RLArena* arena);
int rl_is_ball_scored(RLArena* arena);
void rl_ball_position(RLArena* arena, float out[3]);
int rl_car_position(RLArena* arena, uint32_t car_id, float out[3]);

/* Events since the last call, as [type, a, b] triples: goal (team), bump / demo (attacker, victim).
 * Returns the number of ints written (a multiple of 3). */
size_t rl_take_events(RLArena* arena, int32_t* out, size_t max_ints);

/* Network state (engine/net/NetState.h) for the ball (if ball), the listed cars and the pads (if pads).
 * Returns its size; writes it only if that fits in capacity. */
size_t rl_write_net_state(RLArena* arena, int ball, const uint32_t* car_ids, size_t num_cars, int pads, uint8_t* out,
	size_t capacity);

/* Full snapshot (exact restore); same contract as rl_write_net_state */
size_t rl_save_state(RLArena* arena, uint8_t* out, size_t capacity);

/* Loads a snapshot exactly (in place when it has the same cars, else rebuilds the arena). Returns 0 if malformed. */
int rl_load_state(RLArena* arena, const uint8_t* data, size_t size);

/* Applies a network state written by rl_write_net_state (a client's view). Returns 0 if malformed or unknown cars. */
int rl_apply_net_state(RLArena* arena, const uint8_t* data, size_t size);

/* Car IDs, ascending. Returns the number of cars (writes at most max_ids). */
size_t rl_car_ids(RLArena* arena, uint32_t* out, size_t max_ids);

#ifdef __cplusplus
}
#endif

#endif
