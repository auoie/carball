//! The patched engine (C++), through its C interface (`engine/capi/rlengine.h`).

use std::ffi::{CString, c_char, c_int};
use std::path::Path;
use std::ptr::NonNull;

use crate::protocol::PodiumTitle;

#[repr(C)]
struct RLArena {
    _private: [u8; 0],
}

/// Car controls as the engine takes them.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Controls {
    pub throttle: f32,
    pub steer: f32,
    pub pitch: f32,
    pub yaw: f32,
    pub roll: f32,
    pub jump: u8,
    pub boost: u8,
    pub handbrake: u8,
    pub air_pitch_safety: u8,
    /// The dodge's forward input, as its own byte (the game's q(-pitch), C-2), if `has_dodge_forward`
    pub dodge_forward: f32,
    pub has_dodge_forward: u8,
}

unsafe extern "C" {
    fn rl_init(collision_mesh_dir: *const c_char) -> c_int;
    fn rl_arena_create() -> *mut RLArena;
    fn rl_arena_destroy(arena: *mut RLArena);
    fn rl_add_car(arena: *mut RLArena, team: c_int, body: c_int) -> u32;
    fn rl_remove_car(arena: *mut RLArena, car_id: u32) -> c_int;
    fn rl_set_controls(arena: *mut RLArena, car_id: u32, controls: *const Controls);
    fn rl_car_repress_jump(arena: *mut RLArena, car_id: u32);
    fn rl_set_car_preferences(arena: *mut RLArena, car_id: u32, dodge: f32, steer: f32, air: f32);
    fn rl_step(arena: *mut RLArena, ticks: c_int);
    fn rl_reset_kickoff(arena: *mut RLArena, seed: c_int);
    fn rl_start_match(arena: *mut RLArena, seed: c_int, team_size: c_int);
    fn rl_next_kickoff(arena: *mut RLArena);
    fn rl_redo_kickoff(arena: *mut RLArena);
    fn rl_last_ball_touch_tick(arena: *mut RLArena) -> i64;
    fn rl_car_last_ball_touch_tick(arena: *mut RLArena, car_id: u32) -> i64;
    fn rl_ball_on_ground(arena: *mut RLArena) -> c_int;
    fn rl_reset_ball(arena: *mut RLArena);
    fn rl_set_ball(arena: *mut RLArena, pos: *const f32, vel: *const f32);
    fn rl_set_kickoff_countdown(arena: *mut RLArena, ticks: u32);
    fn rl_set_respawns_held(arena: *mut RLArena, held: c_int);
    fn rl_kickoff_countdown(arena: *const RLArena) -> u32;
    fn rl_tick_count(arena: *const RLArena) -> u64;
    fn rl_is_ball_scored(arena: *mut RLArena) -> c_int;
    fn rl_ball_position(arena: *mut RLArena, out: *mut f32);
    fn rl_car_position(arena: *mut RLArena, car_id: u32, out: *mut f32) -> c_int;
    fn rl_car_demoed(arena: *mut RLArena, car_id: u32) -> c_int;
    fn rl_car_demolish(arena: *mut RLArena, car_id: u32);
    fn rl_take_events(arena: *mut RLArena, out: *mut i32, max_ints: usize) -> usize;
    fn rl_write_net_state(arena: *mut RLArena, ball: c_int, car_ids: *const u32, num_cars: usize, pads: c_int, out: *mut u8, capacity: usize) -> usize;
    fn rl_save_state(arena: *mut RLArena, out: *mut u8, capacity: usize) -> usize;
    fn rl_load_state(arena: *mut RLArena, data: *const u8, size: usize) -> c_int;
    fn rl_apply_net_state(arena: *mut RLArena, data: *const u8, size: usize) -> c_int;
    fn rl_car_ids(arena: *mut RLArena, out: *mut u32, max_ids: usize) -> usize;
    fn rl_stats_set_state(arena: *mut RLArena, state: c_int);
    fn rl_stats_set_overtime(arena: *mut RLArena, overtime: c_int);
    fn rl_stats_reset(arena: *mut RLArena);
    fn rl_take_stat_awards(arena: *mut RLArena, out: *mut i32, max_ints: usize) -> usize;
    fn rl_car_stats(arena: *mut RLArena, car_id: u32, out: *mut i32, max: usize) -> usize;
    fn rl_stat_event_points(event: c_int) -> c_int;
    fn rl_set_frozen(arena: *mut RLArena, frozen: c_int);
    fn rl_car_place(arena: *mut RLArena, car_id: u32, x: f32, y: f32, yaw: f32, boost: f32);
    fn rl_set_unlimited_boost(arena: *mut RLArena, on: c_int);
    fn rl_set_podium(arena: *mut RLArena, on: c_int);
    fn rl_ball_hide(arena: *mut RLArena);
    fn rl_match_ended(arena: *mut RLArena, have_winner: c_int, members: *const u32, count: usize, out: *mut i32);
}

/// A player's match counters (`engine/stats/StatFactory.h` `Counter`): MatchScore, Goals, Assists, Saves, Shots,
/// Demolishes, EpicSaves, Centers, Clears, AerialHits, BicycleHits, JuggleHits, FirstTouches, PoolShots, LowFives,
/// HighFives, TimesDemolished, CrossbarHits, OwnGoals, BallTouches
pub const STAT_COUNTERS: usize = 20;
pub type StatCounters = [i32; STAT_COUNTERS];

/// The match stats' state (`rl_stats_set_state`): the round counts everything, after a goal only demolitions and fives
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StatsState {
    Inactive = 0,
    Round = 1,
    AfterGoal = 2,
}

/// A stat award (`GiveScore`): the event (`protocol::stat`) to a car, with a demolition's victim (0: none)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Award {
    pub event: u8,
    pub car: u32,
    pub victim: u32,
}

/// An event's points (`StatEvent_TA.Points`)
pub fn stat_event_points(event: u8) -> i32 {
    // SAFETY: a pure lookup
    unsafe { rl_stat_event_points(c_int::from(event)) }
}

/// Loads the arena collision meshes. Call once before creating arenas.
pub fn init(collision_mesh_dir: &Path) -> anyhow::Result<()> {
    anyhow::ensure!(collision_mesh_dir.is_dir(), "no collision meshes at {}", collision_mesh_dir.display());
    let dir = CString::new(collision_mesh_dir.to_string_lossy().as_bytes())?;
    // SAFETY: a valid C string; the engine copies what it needs
    anyhow::ensure!(unsafe { rl_init(dir.as_ptr()) } != 0, "engine init failed");
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Event {
    Goal { team: u8 },
    Bump { attacker: u32, victim: u32 },
    Demo { attacker: u32, victim: u32 },
}

/// One match's physics world (soccar).
pub struct Arena(NonNull<RLArena>);

// SAFETY: an arena has no thread affinity; it is only ever used by one thread at a time (it is not Sync)
unsafe impl Send for Arena {}

impl Arena {
    pub fn new() -> Self {
        // SAFETY: plain constructor
        Self(NonNull::new(unsafe { rl_arena_create() }).expect("arena allocation failed"))
    }

    fn ptr(&self) -> *mut RLArena {
        self.0.as_ptr()
    }

    /// team 0 blue / 1 orange; body 0 Octane … 5 Merc. Returns the car ID.
    pub fn add_car(&mut self, team: u8, body: u8) -> u32 {
        // SAFETY: valid arena
        unsafe { rl_add_car(self.ptr(), c_int::from(team), c_int::from(body)) }
    }

    pub fn remove_car(&mut self, car_id: u32) -> bool {
        // SAFETY: valid arena
        unsafe { rl_remove_car(self.ptr(), car_id) != 0 }
    }

    pub fn set_controls(&mut self, car_id: u32, controls: &Controls) {
        // SAFETY: valid arena; the engine copies the controls
        unsafe { rl_set_controls(self.ptr(), car_id, controls) }
    }

    /// The jump released and pressed again within this tick's frames: a fresh press though jump is held (NET-2). After
    /// `set_controls`, before `step`
    pub fn repress_jump(&mut self, car_id: u32) {
        // SAFETY: valid arena; an unknown car is ignored
        unsafe { rl_car_repress_jump(self.ptr(), car_id) }
    }

    pub fn set_car_preferences(&mut self, car_id: u32, dodge_deadzone: f32, steering_sensitivity: f32, air_control_sensitivity: f32) {
        // SAFETY: valid arena
        unsafe { rl_set_car_preferences(self.ptr(), car_id, dodge_deadzone, steering_sensitivity, air_control_sensitivity) }
    }

    pub fn step(&mut self, ticks: i32) {
        // SAFETY: valid arena
        unsafe { rl_step(self.ptr(), ticks) }
    }

    pub fn reset_kickoff(&mut self, seed: i32) {
        // SAFETY: valid arena
        unsafe { rl_reset_kickoff(self.ptr(), seed) }
    }

    /// A new match: its kickoff spot order, shuffled once from `seed` (the game's `RandomizeSpawnPoints`);
    /// `team_size`: the playlist's (the uneven-teams kickoff adjustment's window)
    pub fn start_match(&mut self, seed: i32, team_size: u8) {
        // SAFETY: valid arena
        unsafe { rl_start_match(self.ptr(), seed, c_int::from(team_size)) }
    }

    /// The match's next kickoff (its spot order stepped; uneven teams as the game's)
    pub fn next_kickoff(&mut self) {
        // SAFETY: valid arena
        unsafe { rl_next_kickoff(self.ptr()) }
    }

    /// The current kickoff again: a car that joined during its countdown takes the next free spot
    pub fn redo_kickoff(&mut self) {
        // SAFETY: valid arena
        unsafe { rl_redo_kickoff(self.ptr()) }
    }

    /// The tick of the latest car touch on the ball (a kickoff clears them)
    pub fn last_ball_touch_tick(&mut self) -> Option<u64> {
        // SAFETY: valid arena
        let tick = unsafe { rl_last_ball_touch_tick(self.ptr()) };
        u64::try_from(tick).ok()
    }

    /// The car's latest touch on the ball (as `last_ball_touch_tick`), if any since the kickoff
    pub fn car_last_ball_touch_tick(&mut self, car_id: u32) -> Option<u64> {
        // SAFETY: valid arena (an unknown car gives -1)
        let tick = unsafe { rl_car_last_ball_touch_tick(self.ptr(), car_id) };
        u64::try_from(tick).ok()
    }

    /// The ball rests on the ground (a world contact facing up, or asleep): ends a round at 0:00
    pub fn ball_on_ground(&mut self) -> bool {
        // SAFETY: valid arena
        unsafe { rl_ball_on_ground(self.ptr()) != 0 }
    }

    /// Kickoff countdown in ticks: cars get no input while it runs (part of the simulated state)
    pub fn set_kickoff_countdown(&mut self, ticks: u32) {
        // SAFETY: valid arena
        unsafe { rl_set_kickoff_countdown(self.ptr(), ticks) }
    }

    /// While set, demolished cars aren't respawned (after a goal, until the kickoff; part of the simulated state)
    pub fn set_respawns_held(&mut self, held: bool) {
        // SAFETY: valid arena
        unsafe { rl_set_respawns_held(self.ptr(), c_int::from(held)) }
    }

    pub fn kickoff_countdown(&self) -> u32 {
        // SAFETY: valid arena
        unsafe { rl_kickoff_countdown(self.ptr()) }
    }

    /// The ball at `pos` moving at `vel` (uu, uu/s)
    pub fn set_ball(&mut self, pos: [f32; 3], vel: [f32; 3]) {
        // SAFETY: valid arena; both arrays hold 3 floats
        unsafe { rl_set_ball(self.ptr(), pos.as_ptr(), vel.as_ptr()) }
    }

    pub fn reset_ball(&mut self) {
        // SAFETY: valid arena
        unsafe { rl_reset_ball(self.ptr()) }
    }

    pub fn tick_count(&self) -> u64 {
        // SAFETY: valid arena
        unsafe { rl_tick_count(self.ptr()) }
    }

    pub fn is_ball_scored(&mut self) -> bool {
        // SAFETY: valid arena
        unsafe { rl_is_ball_scored(self.ptr()) != 0 }
    }

    pub fn ball_position(&mut self) -> [f32; 3] {
        let mut out = [0.0; 3];
        // SAFETY: valid arena, 3 floats of space
        unsafe { rl_ball_position(self.ptr(), out.as_mut_ptr()) };
        out
    }

    pub fn car_position(&mut self, car_id: u32) -> Option<[f32; 3]> {
        let mut out = [0.0; 3];
        // SAFETY: valid arena, 3 floats of space
        (unsafe { rl_car_position(self.ptr(), car_id, out.as_mut_ptr()) } != 0).then_some(out)
    }

    /// The car is demolished (waiting to respawn)
    pub fn car_demoed(&mut self, car_id: u32) -> bool {
        // SAFETY: valid arena
        unsafe { rl_car_demoed(self.ptr(), car_id) != 0 }
    }

    /// Demolishes the car (it respawns as after any demolition)
    pub fn demolish_car(&mut self, car_id: u32) {
        // SAFETY: valid arena
        unsafe { rl_car_demolish(self.ptr(), car_id) }
    }

    pub fn set_stats_state(&mut self, state: StatsState) {
        // SAFETY: valid arena
        unsafe { rl_stats_set_state(self.ptr(), state as c_int) }
    }

    pub fn set_stats_overtime(&mut self, overtime: bool) {
        // SAFETY: valid arena
        unsafe { rl_stats_set_overtime(self.ptr(), c_int::from(overtime)) }
    }

    /// The match's end (`FreezePawns`): nothing simulates while frozen; the tick count still steps
    pub fn set_frozen(&mut self, frozen: bool) {
        // SAFETY: valid arena
        unsafe { rl_set_frozen(self.ptr(), c_int::from(frozen)) }
    }

    /// The car spawned at (x, y) facing `yaw` (radians) with `boost`, as a respawn places it (a demolished car comes
    /// back): the podium's cars
    pub fn place_car(&mut self, car_id: u32, x: f32, y: f32, yaw: f32, boost: f32) {
        // SAFETY: valid arena; an unknown car is ignored
        unsafe { rl_car_place(self.ptr(), car_id, x, y, yaw, boost) }
    }

    /// Boost never used up, 100 at spawns (the podium's cars), or the game's rates
    pub fn set_unlimited_boost(&mut self, on: bool) {
        // SAFETY: valid arena
        unsafe { rl_set_unlimited_boost(self.ptr(), c_int::from(on)) }
    }

    /// Podium mode (EnablePodiumMode): every car held at its X/Y, Z and rotation free, its jumps short (PD1)
    pub fn set_podium(&mut self, on: bool) {
        // SAFETY: valid arena
        unsafe { rl_set_podium(self.ptr(), c_int::from(on)) }
    }

    /// The ball hidden (exploded: no physics, no collision) until the next kickoff
    pub fn hide_ball(&mut self) {
        // SAFETY: valid arena
        unsafe { rl_ball_hide(self.ptr()) }
    }

    /// A new match: every car's counters back to 0
    pub fn reset_stats(&mut self) {
        // SAFETY: valid arena
        unsafe { rl_stats_reset(self.ptr()) }
    }

    /// The match's end (`StatFactory.OnMatchEnded`) and, with a winner, its podium titles (`UpdateSpotlight`):
    /// `members`, the teams' current members (blue's in join order, then orange's), each gets its primary and secondary
    pub fn match_ended(&mut self, have_winner: bool, members: &[u32]) -> Vec<[Option<PodiumTitle>; 2]> {
        let mut out = vec![0i32; members.len() * 6];
        // SAFETY: valid arena; `out` has 6 ints per member
        unsafe { rl_match_ended(self.ptr(), c_int::from(have_winner), members.as_ptr(), members.len(), out.as_mut_ptr()) };
        out.as_chunks::<6>()
            .0
            .iter()
            .map(|c| {
                let title = |t: i32, count: i32| (0..255).contains(&t).then(|| PodiumTitle { title: t as u8, count: count.clamp(0, i32::from(u16::MAX)) as u16 });
                [title(c[0], c[2]), title(c[3], c[5])]
            })
            .collect()
    }

    /// The stat awards since the last call, in order
    pub fn take_stat_awards(&mut self) -> Vec<Award> {
        let mut ints = vec![0i32; 4 * 256];
        // SAFETY: valid arena and buffer
        let n = unsafe { rl_take_stat_awards(self.ptr(), ints.as_mut_ptr(), ints.len()) };
        ints[..n]
            .as_chunks::<4>()
            .0
            .iter()
            .map(|&[event, car, victim, _count]| Award { event: event as u8, car: car as u32, victim: victim as u32 })
            .collect()
    }

    /// The car's match counters (all 0 before its first award)
    pub fn car_stats(&mut self, car_id: u32) -> StatCounters {
        let mut out = [0i32; STAT_COUNTERS];
        // SAFETY: valid arena and buffer
        unsafe { rl_car_stats(self.ptr(), car_id, out.as_mut_ptr(), out.len()) };
        out
    }

    pub fn take_events(&mut self) -> Vec<Event> {
        let mut ints = [0i32; 96];
        // SAFETY: valid arena and buffer
        let n = unsafe { rl_take_events(self.ptr(), ints.as_mut_ptr(), ints.len()) };
        ints[..n]
            .as_chunks::<3>()
            .0
            .iter()
            .filter_map(|&[kind, a, b]| match kind {
                0 => Some(Event::Goal { team: a as u8 }),
                1 => Some(Event::Bump { attacker: a as u32, victim: b as u32 }),
                2 => Some(Event::Demo { attacker: a as u32, victim: b as u32 }),
                _ => None,
            })
            .collect()
    }

    /// The network state of the ball (if `ball`), the given cars and the boost pads (if `pads`).
    pub fn write_net_state(&mut self, ball: bool, car_ids: &[u32], pads: bool) -> Vec<u8> {
        let call = |out: *mut u8, capacity: usize| {
            // SAFETY: valid arena; car_ids is a valid slice; out has `capacity` bytes (or is null with 0)
            unsafe { rl_write_net_state(self.ptr(), c_int::from(ball), car_ids.as_ptr(), car_ids.len(), c_int::from(pads), out, capacity) }
        };
        read_sized(call)
    }

    /// The full snapshot (exact restore).
    pub fn save_state(&mut self) -> Vec<u8> {
        // SAFETY: valid arena; out has `capacity` bytes (or is null with 0)
        read_sized(|out, capacity| unsafe { rl_save_state(self.ptr(), out, capacity) })
    }

    /// Loads a snapshot exactly (only pass snapshots written by `save_state`).
    pub fn load_state(&mut self, snapshot: &[u8]) -> bool {
        // SAFETY: valid arena and slice
        unsafe { rl_load_state(self.ptr(), snapshot.as_ptr(), snapshot.len()) != 0 }
    }

    /// Applies a network state (what a client does with the server's updates).
    pub fn apply_net_state(&mut self, state: &[u8]) -> bool {
        // SAFETY: valid arena and slice
        unsafe { rl_apply_net_state(self.ptr(), state.as_ptr(), state.len()) != 0 }
    }

    pub fn car_ids(&mut self) -> Vec<u32> {
        let mut ids = vec![0u32; 16];
        // SAFETY: valid arena; `ids` has room for its length
        let n = unsafe { rl_car_ids(self.ptr(), ids.as_mut_ptr(), ids.len()) };
        if n > ids.len() {
            ids.resize(n, 0);
            // SAFETY: as above, now large enough
            unsafe { rl_car_ids(self.ptr(), ids.as_mut_ptr(), ids.len()) };
        }
        ids.truncate(n);
        ids
    }
}

/// Calls a "size, then fill" C function: once to learn the size, once to fill the buffer.
fn read_sized(call: impl Fn(*mut u8, usize) -> usize) -> Vec<u8> {
    let size = call(std::ptr::null_mut(), 0);
    let mut buffer = vec![0u8; size];
    let written = call(buffer.as_mut_ptr(), buffer.len());
    debug_assert_eq!(written, size);
    buffer
}

impl Default for Arena {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for Arena {
    fn drop(&mut self) {
        // SAFETY: created by rl_arena_create, destroyed once
        unsafe { rl_arena_destroy(self.ptr()) }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::sync::Once;

    static INIT: Once = Once::new();

    pub fn init_engine() {
        INIT.call_once(|| init(Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../out/arena/collision_meshes"))).unwrap());
    }

    #[test]
    fn drives_and_writes_state() {
        init_engine();
        let mut arena = Arena::new();
        let car = arena.add_car(0, 0);
        arena.reset_kickoff(3);
        let start = arena.car_position(car).unwrap();
        let controls = Controls { throttle: 1.0, ..Controls::default() };
        for _ in 0..120 {
            arena.set_controls(car, &controls);
            arena.step(1);
        }
        let end = arena.car_position(car).unwrap();
        let moved = ((end[0] - start[0]).powi(2) + (end[1] - start[1]).powi(2)).sqrt();
        assert!(moved > 400.0, "moved {moved}");
        assert_eq!(arena.tick_count(), 120);
        let state = arena.write_net_state(true, &[car], true);
        assert!(state.len() > 100 && state[0] == 8); // the network state format version
        assert!(arena.save_state().len() > 1000);
    }

    #[test]
    fn the_ball_is_on_the_ground_rolling_but_not_in_the_air_nor_against_a_wall() {
        // (EndRoundComponent: the ball's world contact, persisted points too, its normal z > 0.96)
        init_engine();
        let mut arena = Arena::new();
        let mut on_ground = |pos: [f32; 3], vel: [f32; 3]| {
            arena.set_ball(pos, vel);
            (0..20).map(|_| {
                arena.step(1);
                arena.ball_on_ground()
            }).collect::<Vec<bool>>()
        };
        assert!(on_ground([0.0, -2000.0, 93.15], [0.0, 600.0, 0.0]).iter().skip(2).all(|&g| g), "rolling on the floor");
        assert!(on_ground([0.0, 0.0, 800.0], [0.0, 0.0, 0.0]).iter().all(|&g| !g), "falling from 800");
        // (pressed against the side wall, in the air)
        assert!(on_ground([4096.0 - 93.0, 0.0, 800.0], [500.0, 0.0, 0.0]).iter().all(|&g| !g), "against the side wall");
    }

    #[test]
    fn the_ball_is_not_on_the_ground_while_it_climbs_the_floor_to_wall_curve() {
        // (RV-291: rolled up the side wall's curve, its contact's merged normal z falls from 0.95 to 0.77: not the floor,
        // where a looser bound than GroundToleranceZ 0.96 would say it is)
        init_engine();
        let mut arena = Arena::new();
        arena.set_ball([3000.0, 0.0, 93.15], [1200.0, 0.0, 0.0]);
        let mut on_curve = 0;
        for _ in 0..120 {
            arena.step(1);
            let p = arena.ball_position();
            if p[0] > 3900.0 && p[2] > 105.0 && p[2] < 200.0 {
                on_curve += 1;
                assert!(!arena.ball_on_ground(), "on the curve at {p:?}");
            }
        }
        assert!(on_curve >= 5, "{on_curve} ticks on the curve");
    }

    #[test]
    fn podium_cars_hold_their_x_and_y_while_they_drive_and_boost() {
        // (PD1: Car_TA's SetConstrained2D on the podium, a 6-DOF constraint: X and Y held, Z and rotation free)
        init_engine();
        let mut arena = Arena::new();
        let car = arena.add_car(0, 0);
        arena.reset_kickoff(3);
        arena.place_car(car, 0.0, 0.0, 0.0, 100.0);
        arena.step(30);
        let start = arena.car_position(car).unwrap();
        arena.set_podium(true);
        let controls = Controls { throttle: 1.0, boost: 1, ..Controls::default() };
        let across = |p: [f32; 3]| ((p[0] - start[0]).powi(2) + (p[1] - start[1]).powi(2)).sqrt();
        for _ in 0..240 {
            arena.set_controls(car, &controls);
            arena.step(1);
            let p = arena.car_position(car).unwrap();
            assert!(across(p) < 1.0, "moved {} uu across", across(p));
        }
        // (let go: it drives off)
        arena.set_podium(false);
        for _ in 0..60 {
            arena.set_controls(car, &controls);
            arena.step(1);
        }
        assert!(across(arena.car_position(car).unwrap()) > 100.0);
    }

    #[test]
    fn podium_jumps_stop_pushing_at_podium_jump_force_time() {
        // (PD1: PodiumJumpForceTime 0.085 s, against JumpForceTime 0.2: a held jump goes much less high)
        init_engine();
        let top = |podium: bool| -> f32 {
            let mut arena = Arena::new();
            let car = arena.add_car(0, 0);
            arena.reset_kickoff(3);
            arena.place_car(car, 0.0, 0.0, 0.0, 100.0);
            arena.step(60);
            arena.set_podium(podium);
            let floor = arena.car_position(car).unwrap()[2];
            let jump = Controls { jump: 1, ..Controls::default() };
            let mut top = floor;
            for _ in 0..120 {
                arena.set_controls(car, &jump);
                arena.step(1);
                top = top.max(arena.car_position(car).unwrap()[2]);
            }
            top - floor
        };
        let (normal, podium) = (top(false), top(true));
        assert!(podium > 20.0 && podium < normal - 20.0, "a held jump: {podium} uu on the podium, {normal} uu otherwise");
    }

    #[test]
    fn a_repressed_jump_is_a_fresh_press() {
        // Jump held from the ground through the jump and on in the air: no second jump; the same with a release and a
        // press inside one tick (NET-2): the double jump fires though the button never reads up
        init_engine();
        let height = |repress: bool| -> f32 {
            let mut arena = Arena::new();
            let car = arena.add_car(0, 0);
            arena.reset_kickoff(3);
            let held = Controls { jump: 1, ..Controls::default() };
            for tick in 0..90 {
                arena.set_controls(car, &held);
                if repress && tick == 40 {
                    arena.repress_jump(car);
                }
                arena.step(1);
            }
            arena.car_position(car).unwrap()[2]
        };
        let (held, repressed) = (height(false), height(true));
        assert!(repressed > held + 50.0, "held {held}, repressed {repressed}");
    }

    #[test]
    fn a_repress_early_in_a_ground_jump_ends_it_at_its_minimum_time() {
        // A tap's release then a press (J, 0 | J held): the release ends the jump at its minimum time, a hop as high as
        // a one-tick tap's, not the full jump of jump held (RV-219: the repress's jumpReleased)
        init_engine();
        let apex = |seq: &dyn Fn(u32) -> (u8, bool)| -> f32 {
            let mut arena = Arena::new();
            let car = arena.add_car(0, 0);
            arena.reset_kickoff(3);
            arena.step(30);
            let mut top: f32 = 0.0;
            for tick in 0..120 {
                let (jump, repress) = seq(tick);
                arena.set_controls(car, &Controls { jump, ..Controls::default() });
                if repress {
                    arena.repress_jump(car);
                }
                arena.step(1);
                top = top.max(arena.car_position(car).unwrap()[2]);
            }
            top
        };
        let held = apex(&|_| (1, false));
        let tap = apex(&|tick| (u8::from(tick == 0), false));
        let repressed = apex(&|tick| (1, tick == 1));
        assert_eq!(repressed, tap, "held {held}");
        assert!(held > tap + 100.0, "held {held}, tap {tap}");
    }
}
