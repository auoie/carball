//! The patched engine (C++), through its C interface (`engine/capi/rlengine.h`).

use std::ffi::{CString, c_char, c_int};
use std::path::Path;
use std::ptr::NonNull;

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
    fn rl_set_car_preferences(arena: *mut RLArena, car_id: u32, dodge: f32, steer: f32, air: f32);
    fn rl_step(arena: *mut RLArena, ticks: c_int);
    fn rl_reset_kickoff(arena: *mut RLArena, seed: c_int);
    fn rl_start_match(arena: *mut RLArena, seed: c_int, team_size: c_int);
    fn rl_next_kickoff(arena: *mut RLArena);
    fn rl_redo_kickoff(arena: *mut RLArena);
    fn rl_last_ball_touch_tick(arena: *mut RLArena) -> i64;
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
    fn rl_take_events(arena: *mut RLArena, out: *mut i32, max_ints: usize) -> usize;
    fn rl_write_net_state(arena: *mut RLArena, ball: c_int, car_ids: *const u32, num_cars: usize, pads: c_int, out: *mut u8, capacity: usize) -> usize;
    fn rl_save_state(arena: *mut RLArena, out: *mut u8, capacity: usize) -> usize;
    fn rl_load_state(arena: *mut RLArena, data: *const u8, size: usize) -> c_int;
    fn rl_apply_net_state(arena: *mut RLArena, data: *const u8, size: usize) -> c_int;
    fn rl_car_ids(arena: *mut RLArena, out: *mut u32, max_ids: usize) -> usize;
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
}
