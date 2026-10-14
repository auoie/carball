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
	float dodge_forward; /* the dodge's forward input, made a byte on its own (q(-pitch)), if has_dodge_forward */
	uint8_t has_dodge_forward;
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
/* The jump button released and pressed again within this tick's input frames (the server consumed two: NET-2): the
 * car sees the release (a jump in progress ends once past its minimum time) and a fresh press, though its controls hold
 * jump across the ticks. Call after rl_set_controls, before rl_step */
void rl_car_repress_jump(RLArena* arena, uint32_t car_id);
void rl_set_car_preferences(RLArena* arena, uint32_t car_id, float dodge_deadzone, float steering_sensitivity,
	float air_control_sensitivity);

void rl_step(RLArena* arena, int ticks);
void rl_reset_kickoff(RLArena* arena, int seed);
/* A match: its kickoff spot order shuffled once from `seed`; each rl_next_kickoff steps it (the game's kickoffs,
 * uneven teams included). team_size: the match's team size (the playlist's, e.g. 3; it grows to the larger team) */
void rl_start_match(RLArena* arena, int seed, int team_size);
void rl_next_kickoff(RLArena* arena);
/* The current kickoff again (a car joined during its countdown: it takes the next free spot) */
void rl_redo_kickoff(RLArena* arena);
/* The latest car touch on the ball, as rl_tick_count after that tick, or -1 (a kickoff reset clears the cars'
 * touches) */
int64_t rl_last_ball_touch_tick(RLArena* arena);
/* The car's latest touch on the ball (as rl_last_ball_touch_tick), or -1 (none since the kickoff, or no such car) */
int64_t rl_car_last_ball_touch_tick(RLArena* arena, uint32_t car_id);
/* The ball is on the ground: its world contact (any static manifold's points, persisted ones too: a rolling ball's)
 * with the points' merged normal z > 0.96 (EndRoundComponent_TA.GroundToleranceZ), or the ball asleep (the end of a
 * round at 0:00) */
int rl_ball_on_ground(RLArena* arena);
/* Ball to the centre, at rest (after a goal) */
void rl_reset_ball(RLArena* arena);
/* The ball at `pos` with velocity `vel` (uu, uu/s), not spinning (a placement: its spawn counter steps) */
void rl_set_ball(RLArena* arena, const float pos[3], const float vel[3]);
/* Kickoff countdown: while non-zero, cars get no input; counts down one per tick (part of the state) */
void rl_set_kickoff_countdown(RLArena* arena, uint32_t ticks);
/* While set, demolished cars aren't respawned (after a goal, until the kickoff; part of the state) */
void rl_set_respawns_held(RLArena* arena, int held);
uint32_t rl_kickoff_countdown(const RLArena* arena);
uint64_t rl_tick_count(const RLArena* arena);
int rl_is_ball_scored(RLArena* arena);
void rl_ball_position(RLArena* arena, float out[3]);
int rl_car_position(RLArena* arena, uint32_t car_id, float out[3]);
/* 1 if the car is demolished (waiting to respawn), 0 if not or unknown */
int rl_car_demoed(RLArena* arena, uint32_t car_id);
/* Demolishes the car (it respawns as after any demolition) */
void rl_car_demolish(RLArena* arena, uint32_t car_id);

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

/* Match stats (engine/stats/StatFactory.h: the game's StatFactory_TA, server side; notes/match-stats.md).
 * state: 0 inactive, 1 the round (from "go" until a goal or the end; a goal moves it to 2 itself), 2 after a goal
 * (demolitions and the fives only) */
void rl_stats_set_state(RLArena* arena, int state);
void rl_stats_set_overtime(RLArena* arena, int overtime);
/* A new match: every car's counters back to 0 */
void rl_stats_reset(RLArena* arena);
/* Awards since the last call, as [event, car, victim, count] quads (RLStats::StatEvent ids; victim 0: none). Returns the
 * number of ints written (a multiple of 4). */
size_t rl_take_stat_awards(RLArena* arena, int32_t* out, size_t max_ints);
/* The car's match counters (RLStats::Counter order), at most max. Returns how many there are (0: none yet) */
size_t rl_car_stats(RLArena* arena, uint32_t car_id, int32_t* out, size_t max);
/* The match's end (EndGame: StatFactory_TA.OnMatchEnded's tracking events) and its podium titles
 * (PrePodiumSpotlight.UpdateSpotlight, only with a winner). `members`: the teams' current members, blue's in join order
 * then orange's. out[6i..6i+5] for members[i]: primary title, points, count, then the secondary's (title -1: none; the
 * ids are RLStats::STAT_TITLES's, notes/match-stats.md §5.4a) */
void rl_match_ended(RLArena* arena, int have_winner, const uint32_t* members, size_t count, int32_t* out);
/* An event's points (StatEvent_TA.Points; 0 for an unknown id) */
int rl_stat_event_points(int event);

/* The match's end (FreezePawns): while frozen nothing simulates, the tick count still steps (a mode, not state) */
void rl_set_frozen(RLArena* arena, int frozen);
/* A car (re)spawned at (x, y) facing yaw (radians) with this boost, as a respawn places it (SpawnCar: its own height,
 * its forward offset); a demolished car comes back. The podium's cars (InitPodiumCars) */
void rl_car_place(RLArena* arena, uint32_t car_id, float x, float y, float yaw, float boost);
/* Boost never used up and 100 at spawns (the podium's cars: EnablePodiumMode), or the game's rates */
void rl_set_unlimited_boost(RLArena* arena, int on);
/* The ball hidden: exploded (no physics, no collision) until the next kickoff (the podium's HideBalls) */
void rl_ball_hide(RLArena* arena);

#ifdef __cplusplus
}
#endif

#endif
