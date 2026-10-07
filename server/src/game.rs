//! The match: one arena, its players, the 120 Hz tick, and what each player is sent (`protocol/README.md`,
//! `notes/netcode.md`). No networking here: messages go out through each player's channel, so this is testable.

use std::collections::BTreeMap;

use tokio::sync::mpsc::UnboundedSender;

use crate::engine::{Arena, Event};
use crate::input_buffer::InputBuffer;
use crate::protocol::{self, Control, Datagram, GameEvent, InputFrame, Update};

pub const TICK_RATE: u32 = 120;
/// Updates go out every other tick (60 Hz)
const UPDATE_EVERY_TICKS: u64 = 2;
/// Cars away from the ball and the boost pads: every 8 ticks (15 Hz, `Car_TA.NetUpdateFrequency`)
const SLOW_UPDATE_EVERY_TICKS: u64 = 8;
/// Cars this close to the ball go in every update (`NetworkConfig_TA.ForcePacketSignificantDistance`)
const NEAR_BALL_DISTANCE: f32 = 1000.0;
/// Datagram budget for an update (QUIC datagrams are limited by the path MTU, ~1200 bytes)
pub const MAX_DATAGRAM: usize = 1100;
const UPDATE_HEADER: usize = 25;
/// After a goal, the next kickoff (seconds; `GameEvent_Soccar_TA.PostGoalTime`, without the goal replay)
const GOAL_RESET_SECONDS: f32 = 3.0;
/// After a kickoff reset, the cars get no input for this long (replays: the first car moves 3.99-4.05 s after the
/// reset; the "3-2-1" countdown plus a second)
const KICKOFF_COUNTDOWN_SECONDS: f32 = 4.0;

pub type PlayerId = u64;

#[derive(Clone, Debug, PartialEq)]
pub enum Outgoing {
    Control(Vec<u8>),
    Datagram(Vec<u8>),
}

/// What a joining player asked for (their `Hello`)
#[derive(Clone, Copy, Debug)]
pub struct JoinRequest {
    pub team: u8,
    pub body: u8,
    pub dodge_deadzone: f32,
    pub steering_sensitivity: f32,
    pub air_control_sensitivity: f32,
}

struct Player {
    car_id: u32,
    team: u8,
    input: InputBuffer,
    out: UnboundedSender<Outgoing>,
    /// Newest input packet timestamp and when it arrived (for the ping echo)
    echo: Option<(u32, f64)>,
}

pub struct Game {
    arena: Arena,
    players: BTreeMap<PlayerId, Player>,
    kickoff_seed: i32,
    reset_at_tick: Option<u64>,
    pub score: [u32; 2],
}

impl Default for Game {
    fn default() -> Self {
        Self::new()
    }
}

impl Game {
    pub fn new() -> Self {
        Self { arena: Arena::new(), players: BTreeMap::new(), kickoff_seed: 1, reset_at_tick: None, score: [0, 0] }
    }

    pub fn player_count(&self) -> usize {
        self.players.len()
    }

    pub fn tick_count(&self) -> u64 {
        self.arena.tick_count()
    }

    pub fn car_id(&self, player: PlayerId) -> Option<u32> {
        self.players.get(&player).map(|p| p.car_id)
    }

    pub fn car_position(&mut self, player: PlayerId) -> Option<[f32; 3]> {
        let car = self.car_id(player)?;
        self.arena.car_position(car)
    }

    pub fn join(&mut self, id: PlayerId, request: JoinRequest, out: UnboundedSender<Outgoing>) {
        let team = match request.team {
            0 | 1 => request.team,
            _ => {
                let blue = self.players.values().filter(|p| p.team == 0).count();
                u8::from(blue > self.players.len() - blue)
            }
        };
        let car_id = self.arena.add_car(team, request.body);
        self.arena.set_car_preferences(car_id, request.dodge_deadzone, request.steering_sensitivity, request.air_control_sensitivity);
        if self.players.is_empty() {
            self.next_kickoff();
        }
        let player = Player { car_id, team, input: InputBuffer::default(), out, echo: None };
        let snapshot = self.arena.save_state();
        let welcome = Control::Welcome { version: protocol::VERSION, car_id, tick_rate: TICK_RATE as u8, frame: 0, snapshot: snapshot.clone() };
        let _ = player.out.send(Outgoing::Control(welcome.encode()));
        self.players.insert(id, player);
        self.send_world_to_others(id, &snapshot);
    }

    pub fn leave(&mut self, id: PlayerId) {
        if let Some(player) = self.players.remove(&id) {
            let stats = player.input.stats;
            eprintln!(
                "player {id} left: {} input frames repeated (buffer empty), {} skipped to catch up",
                stats.under_buffer_frames, stats.over_buffer_frames
            );
            self.arena.remove_car(player.car_id);
            let snapshot = self.arena.save_state();
            self.send_world_to_others(id, &snapshot);
        }
    }

    /// The set of cars changed: everyone else reloads the world
    fn send_world_to_others(&self, except: PlayerId, snapshot: &[u8]) {
        for (&id, p) in &self.players {
            if id != except {
                let world = Control::World { frame: p.input.ack_frame(), snapshot: snapshot.to_vec() };
                let _ = p.out.send(Outgoing::Control(world.encode()));
            }
        }
    }

    pub fn receive_inputs(&mut self, id: PlayerId, timestamp: u32, first_frame: u32, frames: &[InputFrame], now: f64) {
        if let Some(p) = self.players.get_mut(&id)
            && p.input.receive(timestamp, first_frame, frames, now)
        {
            p.echo = Some((timestamp, now));
        }
    }

    fn next_kickoff(&mut self) {
        self.arena.reset_kickoff(self.kickoff_seed);
        self.arena.set_kickoff_countdown((KICKOFF_COUNTDOWN_SECONDS * TICK_RATE as f32) as u32);
        self.kickoff_seed += 1;
        self.reset_at_tick = None;
    }

    fn broadcast(&self, message: &Control) {
        let bytes = message.encode();
        for p in self.players.values() {
            let _ = p.out.send(Outgoing::Control(bytes.clone()));
        }
    }

    /// One physics tick. `now`: server time in seconds.
    pub fn tick(&mut self, now: f64) {
        if self.players.is_empty() {
            return;
        }
        let odd_tick = self.arena.tick_count() % 2 == 1;
        for p in self.players.values_mut() {
            let controls = p.input.tick(now, odd_tick);
            self.arena.set_controls(p.car_id, &controls);
        }
        self.arena.step(1);
        let tick = self.arena.tick_count();

        for event in self.arena.take_events() {
            match event {
                Event::Goal { team } => {
                    self.score[usize::from(team.min(1))] += 1;
                    self.broadcast(&Control::Event { server_tick: tick as u32, event: GameEvent::Goal { team } });
                    self.reset_at_tick = Some(tick + (GOAL_RESET_SECONDS * TICK_RATE as f32) as u64);
                }
                Event::Demo { attacker, victim } => {
                    self.broadcast(&Control::Event { server_tick: tick as u32, event: GameEvent::Demo { attacker, victim } });
                }
                Event::Bump { .. } => {}
            }
        }
        if self.reset_at_tick.is_some_and(|t| tick >= t) {
            self.next_kickoff();
        }

        if tick.is_multiple_of(UPDATE_EVERY_TICKS) {
            self.send_updates(now);
        }
    }

    /// The network-state parts of this update, each within the datagram budget
    fn update_parts(&mut self) -> Vec<Vec<u8>> {
        let tick = self.arena.tick_count();
        let slow = tick.is_multiple_of(SLOW_UPDATE_EVERY_TICKS);
        let ball = self.arena.ball_position();
        let mut cars = Vec::new();
        for car in self.arena.car_ids() {
            let near = self.arena.car_position(car).is_some_and(|p| {
                let d = [p[0] - ball[0], p[1] - ball[1], p[2] - ball[2]];
                d[0] * d[0] + d[1] * d[1] + d[2] * d[2] <= NEAR_BALL_DISTANCE * NEAR_BALL_DISTANCE
            });
            if near || slow {
                cars.push(car);
            }
        }

        // Greedy split: the ball and pads go in the first part
        let budget = MAX_DATAGRAM - UPDATE_HEADER;
        let mut parts = Vec::new();
        let (mut with_ball, mut with_pads) = (true, slow);
        let mut current: Vec<u32> = Vec::new();
        for car in cars {
            current.push(car);
            if self.arena.write_net_state(with_ball, &current, with_pads).len() > budget && current.len() > 1 {
                current.pop();
                parts.push(self.arena.write_net_state(with_ball, &current, with_pads));
                (with_ball, with_pads) = (false, false);
                current = vec![car];
            }
        }
        parts.push(self.arena.write_net_state(with_ball, &current, with_pads));
        parts
    }

    fn send_updates(&mut self, now: f64) {
        let parts = self.update_parts();
        let server_tick = self.arena.tick_count() as u32;
        for p in self.players.values() {
            let (echo_timestamp, echo_delay) = match p.echo {
                Some((timestamp, at)) => (timestamp, ((now - at) * 1000.0).clamp(0.0, f64::from(u16::MAX)) as u16),
                None => (0, 0),
            };
            for (i, state) in parts.iter().enumerate() {
                let update = Update {
                    server_tick,
                    ack_frame: p.input.ack_frame(),
                    received_frame: p.input.last_received_frame,
                    echo_timestamp,
                    echo_delay,
                    buffer_target: p.input.jitter.buffer_size.min(255) as u8,
                    buffer_size: p.input.len().min(255) as u8,
                    part: i as u8,
                    parts: parts.len() as u8,
                    state: state.clone(),
                };
                let _ = p.out.send(Outgoing::Datagram(Datagram::Update(update).encode()));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::tests::init_engine;
    use tokio::sync::mpsc::{UnboundedReceiver, unbounded_channel};

    const REQUEST: JoinRequest =
        JoinRequest { team: 255, body: 0, dodge_deadzone: 0.5, steering_sensitivity: 1.0, air_control_sensitivity: 1.0 };

    fn drain(rx: &mut UnboundedReceiver<Outgoing>) -> Vec<Outgoing> {
        let mut out = Vec::new();
        while let Ok(m) = rx.try_recv() {
            out.push(m);
        }
        out
    }

    fn throttle_frames(n: usize) -> Vec<InputFrame> {
        vec![InputFrame { throttle: 127, ..InputFrame::default() }; n]
    }

    #[test]
    fn players_join_drive_and_receive_updates() {
        init_engine();
        let mut game = Game::new();
        let (tx1, mut rx1) = unbounded_channel();
        let (tx2, mut rx2) = unbounded_channel();
        game.join(1, REQUEST, tx1);
        game.join(2, REQUEST, tx2);

        // Player 1: Welcome then World (player 2 joined); player 2: Welcome
        let first = drain(&mut rx1);
        let Outgoing::Control(bytes) = &first[0] else { panic!() };
        let Control::Welcome { car_id, snapshot, .. } = Control::decode(&bytes[2..]).unwrap() else { panic!() };
        assert!(matches!(drain(&mut rx2)[0], Outgoing::Control(_)));

        // A client-side arena: the welcome snapshot, then the world snapshot sent when player 2 joined
        let mut client = Arena::new();
        assert!(client.load_state(&snapshot));
        let Control::World { snapshot: world, .. } = Control::decode(match &first[1] { Outgoing::Control(b) => &b[2..], _ => panic!() }).unwrap() else { panic!() };
        assert!(client.load_state(&world));

        // Player 1 sends 2 frames per 60 Hz packet (throttle 1), player 2 nothing; the 4 s kickoff countdown, then
        // 2 seconds of driving
        let start = game.car_position(1).unwrap();
        let mut frame = 1u32;
        let mut last_update = None;
        let mut max_size = 0;
        let countdown = game.arena.kickoff_countdown();
        assert_eq!(countdown, 480);
        for tick in 0..countdown + 240 {
            if tick == countdown {
                let p = game.car_position(1).unwrap();
                assert!((p[0] - start[0]).hypot(p[1] - start[1]) < 1.0, "the car moved during the countdown");
                assert_eq!(client.kickoff_countdown(), 0, "the countdown reached the client through the updates");
            }
            let now = f64::from(tick) / 120.0;
            if tick % 2 == 0 {
                game.receive_inputs(1, tick, frame, &throttle_frames(2), now);
                frame += 2;
            }
            game.tick(now);
            for m in drain(&mut rx1) {
                if let Outgoing::Datagram(d) = m {
                    max_size = max_size.max(d.len());
                    if let Datagram::Update(u) = Datagram::decode(&d).unwrap() {
                        assert!(client.apply_net_state(&u.state), "update did not apply");
                        last_update = Some(u);
                    }
                }
            }
            drain(&mut rx2);
        }
        let end = game.car_position(1).unwrap();
        assert!((end[0] - start[0]).hypot(end[1] - start[1]) > 1000.0, "the car drove");
        assert!(max_size <= MAX_DATAGRAM, "datagram of {max_size} bytes");
        let u = last_update.unwrap();
        assert!(u.ack_frame > frame - 40 && u.ack_frame < frame, "ack {}", u.ack_frame); // 1 frame per tick sent, ~all consumed
        assert_eq!(u.received_frame, frame - 1);
        // The client's view of the server's car (updated at least every 8 ticks) is within a few ticks of driving
        let server_pos = game.arena.car_position(car_id).unwrap();
        let client_pos = client.car_position(car_id).unwrap();
        assert!((server_pos[0] - client_pos[0]).hypot(server_pos[1] - client_pos[1]) < 200.0);
    }

    #[test]
    fn a_kickoff_starts_the_countdown() {
        init_engine();
        let mut game = Game::new();
        let (tx, _rx) = unbounded_channel();
        game.join(1, REQUEST, tx);
        assert_eq!(game.arena.kickoff_countdown(), 480);
    }

    #[test]
    fn goals_reset_to_a_kickoff_and_leaving_updates_the_others() {
        init_engine();
        let mut game = Game::new();
        let (tx1, mut rx1) = unbounded_channel();
        let (tx2, rx2) = unbounded_channel();
        game.join(1, REQUEST, tx1);
        game.join(2, REQUEST, tx2);
        drain(&mut rx1);
        game.leave(2);
        let world = drain(&mut rx1);
        assert!(world.iter().any(|m| matches!(m, Outgoing::Control(b) if b[2] == 0x82)));
        assert_eq!(game.player_count(), 1);
        drop(rx2);
    }
}
