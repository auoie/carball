//! The patched engine (C++), through its C interface (`engine/capi/rlengine.h`).

use std::ffi::{CStr, CString, c_int};
use std::path::Path;
use std::ptr::NonNull;

use crate::protocol::PodiumTitle;

// (the engine's C interface, its functions, types and constants: bindgen's from `engine/capi/rlengine.h`, committed,
// scripts/gen_bindings.sh)
#[path = "engine_ffi.rs"]
mod ffi;
use ffi::*;

/// What the replication watches to force a car into the next update (`RLCarNetInfo`)
pub type CarNetInfo = ffi::RLCarNetInfo;

/// Car controls as the engine takes them (`RLControls`; `dodge_forward`: the dodge's forward input, as its own byte, the
/// game's q(-pitch), C-2, if `has_dodge_forward`)
pub type Controls = ffi::RLControls;

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
/// Loads the arena meshes, once per process: the engine's init isn't safe to run twice or on two threads at once (its
/// tables are written outside a lock, RV-356); a later call gets the first one's result
pub fn init(collision_mesh_dir: &Path) -> anyhow::Result<()> {
    static DONE: std::sync::OnceLock<Result<(), String>> = std::sync::OnceLock::new();
    DONE.get_or_init(|| {
        if !collision_mesh_dir.is_dir() {
            return Err(format!("no collision meshes at {}", collision_mesh_dir.display()));
        }
        let dir = CString::new(collision_mesh_dir.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
        // SAFETY: a valid C string; the engine copies what it needs
        // (another folder, an older mesh format, a truncated file: refused at startup, why said, not the first match's
        // abort, RV-421, RV-434)
        if unsafe { rl_init(dir.as_ptr()) } == 0 {
            // SAFETY: the engine's error string, valid until the next init (there is none: once per process)
            Err(unsafe { CStr::from_ptr(rl_init_error()) }.to_string_lossy().into_owned())
        } else {
            Ok(())
        }
    })
    .clone()
    .map_err(|e| anyhow::anyhow!(e))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Event {
    Goal { team: u8 },
    Bump { attacker: u32, victim: u32 },
    Demo { attacker: u32, victim: u32 },
}

/// One match's physics world (soccar).
pub struct Arena(NonNull<CarballArena>);

// SAFETY: an arena has no thread affinity; it is only ever used by one thread at a time (it is not Sync)
unsafe impl Send for Arena {}

impl Arena {
    pub fn new() -> Self {
        // SAFETY: plain constructor
        Self(NonNull::new(unsafe { rl_arena_create() }).expect("arena allocation failed"))
    }

    fn ptr(&self) -> *mut CarballArena {
        self.0.as_ptr()
    }

    /// team 0 blue / 1 orange; body 0 standard … 5 tall (the hitbox presets: notes/hitboxes.md). Returns the car ID.
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

    pub fn set_car_preferences(
        &mut self,
        car_id: u32,
        dodge_deadzone: f32,
        steering_sensitivity: f32,
        air_control_sensitivity: f32,
    ) {
        // SAFETY: valid arena
        unsafe {
            rl_set_car_preferences(self.ptr(), car_id, dodge_deadzone, steering_sensitivity, air_control_sensitivity)
        }
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

    pub fn car_velocity(&mut self, car_id: u32) -> Option<[f32; 3]> {
        let mut out = [0.0; 3];
        // SAFETY: valid arena, 3 floats of space
        (unsafe { rl_car_velocity(self.ptr(), car_id, out.as_mut_ptr()) } != 0).then_some(out)
    }

    /// The car is demolished (waiting to respawn)
    pub fn car_demoed(&mut self, car_id: u32) -> bool {
        // SAFETY: valid arena
        unsafe { rl_car_demoed(self.ptr(), car_id) != 0 }
    }

    /// The axes the car's jump press of the next tick came with (the dodge's direction), when its controls are another
    /// frame's (G10)
    pub fn set_press_axes(&mut self, car_id: u32, dodge_forward: f32, yaw: f32, roll: f32) {
        // SAFETY: valid arena
        unsafe { rl_set_press_axes(self.ptr(), car_id, dodge_forward, yaw, roll) }
    }

    /// The vehicles' order in the physics step (the game's action array: the podium's winners in the MVP order); cars
    /// left out follow in ID order
    pub fn set_vehicle_order(&mut self, car_ids: &[u32]) {
        // SAFETY: valid arena; car_ids is a valid slice
        unsafe { rl_set_vehicle_order(self.ptr(), car_ids.as_ptr(), car_ids.len()) }
    }

    pub fn vehicle_order(&mut self) -> Vec<u32> {
        // SAFETY: valid arena; out has `max` ids of space (or is null with 0)
        let n = unsafe { rl_vehicle_order(self.ptr(), std::ptr::null_mut(), 0) };
        let mut out = vec![0u32; n];
        // SAFETY: as above, `n` ids of space
        unsafe { rl_vehicle_order(self.ptr(), out.as_mut_ptr(), n) };
        out
    }

    /// What the replication watches to force the car into the next update
    pub fn car_net_info(&mut self, car_id: u32) -> Option<CarNetInfo> {
        let mut out = CarNetInfo::default();
        // SAFETY: valid arena, out is a valid RLCarNetInfo
        (unsafe { rl_car_net_info(self.ptr(), car_id, &raw mut out) } != 0).then_some(out)
    }

    /// The boost pads' active flags, bit i pad i
    pub fn pads_active(&mut self) -> u64 {
        // SAFETY: valid arena
        unsafe { rl_pads_active(self.ptr()) }
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
        unsafe {
            rl_match_ended(self.ptr(), c_int::from(have_winner), members.as_ptr(), members.len(), out.as_mut_ptr())
        };
        out.as_chunks::<6>()
            .0
            .iter()
            .map(|c| {
                let title = |t: i32, count: i32| {
                    (0..255)
                        .contains(&t)
                        .then(|| PodiumTitle { title: t as u8, count: count.clamp(0, i32::from(u16::MAX)) as u16 })
                };
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
            .filter_map(|&[kind, a, b]| match u32::try_from(kind) {
                Ok(RL_EVENT_GOAL) => Some(Event::Goal { team: a as u8 }),
                Ok(RL_EVENT_BUMP) => Some(Event::Bump { attacker: a as u32, victim: b as u32 }),
                Ok(RL_EVENT_DEMO) => Some(Event::Demo { attacker: a as u32, victim: b as u32 }),
                _ => None,
            })
            .collect()
    }

    /// The network state of the ball (if `ball`), the given cars and the boost pads (if `pads`).
    pub fn write_net_state(&mut self, ball: bool, car_ids: &[u32], pads: bool) -> Vec<u8> {
        let call = |out: *mut u8, capacity: usize| {
            // SAFETY: valid arena; car_ids is a valid slice; out has `capacity` bytes (or is null with 0)
            unsafe {
                rl_write_net_state(
                    self.ptr(),
                    c_int::from(ball),
                    car_ids.as_ptr(),
                    car_ids.len(),
                    c_int::from(pads),
                    out,
                    capacity,
                )
            }
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
        INIT.call_once(|| {
            init(Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../out/arena/collision_meshes"))).unwrap()
        });
    }

    #[test]
    fn the_engine_is_set_up_once_whoever_asks_again() {
        // (RV-356, RX13's S14: RocketSim's init isn't safe to run twice or from two threads; a second call, with any
        // directory, is the first's result)
        init_engine();
        let again: Vec<_> = (0..8).map(|_| std::thread::spawn(|| init(Path::new("/no/such/meshes")).is_ok())).collect();
        assert!(again.into_iter().all(|t| t.join().unwrap()));
    }

    #[test]
    fn the_engine_clamps_car_preferences_itself() {
        // (RV-331, RV-344: a NaN steering sensitivity steered full left; the engine gives a value that isn't a number its
        // default and keeps the rest within the settings' limits, whoever calls it)
        init_engine();
        let drive = |dodge: f32, sensitivity: f32, steer: f32| {
            let mut arena = Arena::new();
            let car = arena.add_car(0, 0);
            arena.reset_kickoff(1);
            arena.set_kickoff_countdown(0);
            arena.set_car_preferences(car, dodge, sensitivity, sensitivity);
            arena.set_controls(car, &Controls { throttle: 1.0, steer, ..Controls::default() });
            arena.step(90);
            (arena.car_position(car).unwrap(), arena.car_velocity(car).unwrap())
        };
        let straight = drive(0.5, 1.0, 0.0);
        for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY, -3.0] {
            assert_eq!(drive(0.5, bad, 0.0), straight, "sensitivity {bad}: the default or the limit, driving straight");
            assert_eq!(drive(bad, 1.0, 0.0), straight, "deadzone {bad}");
        }
        assert_eq!(drive(0.5, 100.0, 0.1), drive(0.5, 10.0, 0.1), "above the limit: the limit");
        assert_ne!(drive(0.5, 10.0, 0.1), drive(0.5, 1.0, 0.1), "(the sensitivity does steer)");
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
        // (the compact form, engine/net/NetState.h: its version, the ball, a car and the pads, about the game's size)
        assert!(state[0] == 10 && (60..200).contains(&state.len()), "{} B", state.len());
        assert!(arena.save_state().len() > 1000);
    }

    #[test]
    fn the_ball_is_on_the_ground_rolling_but_not_in_the_air_nor_against_a_wall() {
        // (EndRoundComponent: the ball's world contact, persisted points too, its normal z > 0.96)
        init_engine();
        let mut arena = Arena::new();
        let mut on_ground = |pos: [f32; 3], vel: [f32; 3]| {
            arena.set_ball(pos, vel);
            (0..20)
                .map(|_| {
                    arena.step(1);
                    arena.ball_on_ground()
                })
                .collect::<Vec<bool>>()
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
    fn the_countdown_holds_cars_at_their_x_and_y_and_lets_go_at_go() {
        // (RV-299: Car_TA's SetConstrained2D while not driving: two cars overlapping in the countdown stay put, apart
        // they'd push each other off; at go they drive)
        init_engine();
        let across = |a: [f32; 3], b: [f32; 3]| ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt();
        let pushed = |countdown: u32| -> f32 {
            let mut arena = Arena::new();
            let a = arena.add_car(0, 0);
            let b = arena.add_car(1, 0);
            arena.place_car(a, 0.0, 0.0, 0.0, 33.0);
            arena.place_car(b, 0.0, 70.0, 0.0, 33.0);
            arena.set_kickoff_countdown(countdown);
            // (from where it was placed: the lock's pin)
            let start = arena.car_position(a).unwrap();
            arena.step(60);
            across(arena.car_position(a).unwrap(), start)
        };
        assert!(pushed(240) < 1.0, "held: {} uu", pushed(240));
        assert!(pushed(0) > 5.0, "free: {} uu", pushed(0));
        // (at go: it drives)
        let mut arena = Arena::new();
        let car = arena.add_car(0, 0);
        arena.place_car(car, 0.0, 0.0, 0.0, 33.0);
        arena.set_kickoff_countdown(30);
        arena.step(40);
        let start = arena.car_position(car).unwrap();
        let throttle = Controls { throttle: 1.0, ..Controls::default() };
        for _ in 0..60 {
            arena.set_controls(car, &throttle);
            arena.step(1);
        }
        assert!(across(arena.car_position(car).unwrap(), start) > 50.0);
    }

    #[test]
    fn a_car_placed_or_respawned_while_held_is_held_where_it_is_now() {
        // (RV-295: a placement takes the lock again where the car is, not back at its old pin; a demolished car has
        // none, and holds where it respawns)
        init_engine();
        let across = |a: [f32; 3], b: [f32; 3]| ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt();
        let mut arena = Arena::new();
        let car = arena.add_car(0, 0);
        arena.place_car(car, 0.0, 0.0, 0.0, 33.0);
        arena.set_kickoff_countdown(900);
        arena.step(10);
        arena.place_car(car, 1500.0, -1000.0, 0.0, 33.0);
        arena.step(2);
        let placed = arena.car_position(car).unwrap();
        arena.step(60);
        assert!(across(arena.car_position(car).unwrap(), placed) < 1.0, "pulled back from its new spot");
        assert!(across(placed, [0.0, 0.0, 0.0]) > 1000.0);
        // (on the podium too)
        arena.set_kickoff_countdown(0);
        arena.set_podium(true);
        arena.step(5);
        arena.place_car(car, -800.0, 2000.0, 0.0, 100.0);
        arena.step(2);
        let podium = arena.car_position(car).unwrap();
        arena.step(60);
        assert!(across(arena.car_position(car).unwrap(), podium) < 1.0, "pulled back from its podium spot");
        // (demolished: no lock while it is, held where it respawns)
        arena.set_podium(false);
        arena.set_kickoff_countdown(900);
        arena.step(2);
        arena.demolish_car(car);
        for _ in 0..600 {
            arena.step(1);
            if !arena.car_demoed(car) {
                break;
            }
        }
        assert!(!arena.car_demoed(car));
        arena.step(2);
        let respawned = arena.car_position(car).unwrap();
        arena.step(60);
        assert!(across(arena.car_position(car).unwrap(), respawned) < 1.0, "pulled away from where it respawned");
    }

    #[test]
    fn a_snapshot_or_an_update_after_a_held_car_is_placed_holds_it_at_its_new_spot_on_the_client() {
        // (RV-303: a snapshot taken before the next tick carries the new spot as its pin, not the old one; RV-304: a
        // client that only gets updates takes the server's pin from them; on the podium too)
        init_engine();
        let across = |a: [f32; 3], b: [f32; 3]| ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt();
        for podium in [false, true] {
            let mut server = Arena::new();
            let car = server.add_car(0, 0);
            server.place_car(car, 0.0, 0.0, 0.0, 33.0);
            if podium {
                server.set_podium(true);
            } else {
                server.set_kickoff_countdown(900);
            }
            server.step(10);
            let mut updated = Arena::new();
            updated.add_car(0, 0);
            assert!(updated.load_state(&server.save_state()));
            updated.set_podium(podium);
            // Placed while held; a snapshot at once (RV-303), and an update after the tick (RV-304)
            server.place_car(car, 1500.0, -1000.0, 0.0, 33.0);
            let mut restored = Arena::new();
            restored.add_car(0, 0);
            assert!(restored.load_state(&server.save_state()));
            restored.set_podium(podium);
            server.step(1);
            assert!(updated.apply_net_state(&server.write_net_state(true, &[car], true)));
            let spot = server.car_position(car).unwrap();
            for arena in [&mut server, &mut restored, &mut updated] {
                arena.step(40);
            }
            let what = if podium { "podium" } else { "countdown" };
            assert!(
                across(server.car_position(car).unwrap(), spot) < 1.0,
                "{what}: the server's car left its new spot"
            );
            assert!(
                across(restored.car_position(car).unwrap(), spot) < 1.0,
                "{what}: the snapshot's car pulled back to its old pin"
            );
            assert!(
                across(updated.car_position(car).unwrap(), spot) < 1.0,
                "{what}: the updated client's car pulled back to its old pin"
            );
        }
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
        assert!(
            podium > 20.0 && podium < normal - 20.0,
            "a held jump: {podium} uu on the podium, {normal} uu otherwise"
        );
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
