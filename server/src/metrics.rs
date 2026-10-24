//! The benchmark's counters (notes/benchmarks.md): the game loop's passes and ticks, the matches and players, the
//! datagrams each way, each thread's CPU and the resident memory, served as Prometheus text at `GET /metrics` on the
//! development info server alone (`--dev-info on`; a public server serves none unless asked, its counting off too).
//! Counted only once `install`ed: without it every count is a load of an empty cell.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use prometheus_client::collector::Collector;
use prometheus_client::encoding::{DescriptorEncoder, EncodeMetric};
use prometheus_client::metrics::counter::{ConstCounter, Counter};
use prometheus_client::metrics::gauge::{ConstGauge, Gauge};
use prometheus_client::metrics::histogram::Histogram;
use prometheus_client::registry::Registry;

/// The passes' busy time's buckets (s): 0.05 ms to 50 ms, finest around a tick's budget (1/120 s)
const PASS_BUCKETS: [f64; 20] = [
    0.000_05, 0.000_1, 0.000_2, 0.000_3, 0.000_5, 0.000_75, 0.001, 0.001_5, 0.002, 0.003, 0.004, 0.005, 0.006, 0.007,
    0.008_333, 0.01, 0.015, 0.02, 0.03, 0.05,
];

pub struct Metrics {
    registry: Registry,
    /// The game loop's passes that ran a match tick: each one's busy time (the sessions' messages, the ticks, the reports)
    pass: Histogram,
    /// The longest such pass since the last scrape (ns; each scrape takes it)
    pass_max: Arc<AtomicU64>,
    ticks: Counter,
    /// Match ticks run a period or more late (a match caught up in a pass: it fell a whole tick behind), and the ticks a
    /// match skipped when it fell too far behind to catch up
    slipped: Counter,
    matches: Gauge,
    players: Gauge,
    datagrams_in: Counter,
    datagrams_out: Counter,
    bytes_in: Counter,
    bytes_out: Counter,
}

static METRICS: OnceLock<Metrics> = OnceLock::new();

/// The counters, if they're on
pub fn get() -> Option<&'static Metrics> {
    METRICS.get()
}

/// The counters turned on (the development info server's: `main`), from now on
pub fn install() -> &'static Metrics {
    METRICS.get_or_init(Metrics::new)
}

impl Metrics {
    fn new() -> Self {
        let mut registry = Registry::default();
        let pass = Histogram::new(PASS_BUCKETS);
        registry.register(
            "carball_game_pass_seconds",
            "The game loop's passes that ran a match tick: their busy time (messages, ticks, reports)",
            pass.clone(),
        );
        let ticks = Counter::default();
        registry.register("carball_ticks", "Match ticks run", ticks.clone());
        let slipped = Counter::default();
        registry.register(
            "carball_ticks_slipped",
            "Match ticks run a period or more late (caught up in a pass) or skipped",
            slipped.clone(),
        );
        let matches = Gauge::default();
        registry.register("carball_matches", "Matches hosted", matches.clone());
        let players = Gauge::default();
        registry.register("carball_players", "Players in the matches", players.clone());
        let datagrams_in = Counter::default();
        registry.register("carball_datagrams_received", "Datagrams received", datagrams_in.clone());
        let datagrams_out = Counter::default();
        registry.register("carball_datagrams_sent", "Datagrams handed to the connections", datagrams_out.clone());
        let bytes_in = Counter::default();
        registry.register("carball_datagram_bytes_received", "Datagrams' bytes received", bytes_in.clone());
        let bytes_out = Counter::default();
        registry.register(
            "carball_datagram_bytes_sent",
            "Datagrams' bytes handed to the connections",
            bytes_out.clone(),
        );
        let pass_max = Arc::new(AtomicU64::new(0));
        registry.register_collector(Box::new(PassMax(pass_max.clone())));
        registry.register_collector(Box::new(Process));
        Self {
            registry,
            pass,
            pass_max,
            ticks,
            slipped,
            matches,
            players,
            datagrams_in,
            datagrams_out,
            bytes_in,
            bytes_out,
        }
    }

    /// A game loop pass that ran `ticks` match ticks (`slipped` of them late or skipped) in `busy`, with `matches` and
    /// `players` hosted after it
    pub fn pass(&self, busy: Duration, ticks: u32, slipped: u32, matches: usize, players: usize) {
        if ticks > 0 {
            self.pass.observe(busy.as_secs_f64());
            self.pass_max.fetch_max(u64::try_from(busy.as_nanos()).unwrap_or(u64::MAX), Ordering::Relaxed);
        }
        self.ticks.inc_by(u64::from(ticks));
        self.slipped.inc_by(u64::from(slipped));
        self.matches.set(i64::try_from(matches).unwrap_or(i64::MAX));
        self.players.set(i64::try_from(players).unwrap_or(i64::MAX));
    }

    pub fn received(&self, bytes: usize) {
        self.datagrams_in.inc();
        self.bytes_in.inc_by(bytes as u64);
    }

    pub fn sent(&self, bytes: usize) {
        self.datagrams_out.inc();
        self.bytes_out.inc_by(bytes as u64);
    }

    /// The counters as Prometheus text; the longest pass since the last scrape taken
    pub fn encode(&self) -> String {
        let mut text = String::new();
        // (writing to a String can't fail)
        let _ = prometheus_client::encoding::text::encode(&mut text, &self.registry);
        text
    }
}

/// The longest pass since the last scrape, taken by each scrape (ns)
#[derive(Debug)]
struct PassMax(Arc<AtomicU64>);

impl Collector for PassMax {
    fn encode(&self, mut encoder: DescriptorEncoder) -> Result<(), std::fmt::Error> {
        let gauge = ConstGauge::new(self.0.swap(0, Ordering::Relaxed) as f64 / 1e9);
        let metric = encoder.encode_descriptor(
            "carball_game_pass_max_seconds",
            "The longest pass that ran a match tick since the last scrape",
            None,
            gauge.metric_type(),
        )?;
        gauge.encode(metric)
    }
}

/// Each thread's CPU (the game thread's, the log's, the rest: the network's runtime) and the resident memory, read from
/// /proc at each scrape (Linux; none elsewhere)
#[derive(Debug)]
struct Process;

impl Collector for Process {
    fn encode(&self, mut encoder: DescriptorEncoder) -> Result<(), std::fmt::Error> {
        let cpu = thread_cpu();
        let descriptor = ConstCounter::new(0.0f64).metric_type();
        let mut family = encoder.encode_descriptor(
            "carball_thread_cpu_seconds",
            "CPU time by thread: the game thread's, the log's, and the network's (every other)",
            None,
            descriptor,
        )?;
        for (thread, seconds) in [("game", cpu.game), ("log", cpu.log), ("network", cpu.network)] {
            ConstCounter::new(seconds).encode(family.encode_family(&[("thread", thread)])?)?;
        }
        if let Some(bytes) = resident_bytes() {
            let gauge = ConstGauge::new(i64::try_from(bytes).unwrap_or(i64::MAX));
            let metric = encoder.encode_descriptor(
                "carball_resident_memory_bytes",
                "Resident memory",
                None,
                gauge.metric_type(),
            )?;
            gauge.encode(metric)?;
        }
        Ok(())
    }
}

/// CPU time by thread (s)
#[derive(Debug, Default, PartialEq)]
pub struct ThreadCpu {
    pub game: f64,
    pub log: f64,
    pub network: f64,
}

/// This process's threads' CPU time, by their names: "game", "log", the rest (each thread's /proc schedstat: its run
/// time in ns, else its stat's user and system time in the kernel's 100 Hz ticks)
pub fn thread_cpu() -> ThreadCpu {
    let mut cpu = ThreadCpu::default();
    let Ok(tasks) = std::fs::read_dir("/proc/self/task") else { return cpu };
    for task in tasks.flatten() {
        let dir = task.path();
        let name = std::fs::read_to_string(dir.join("comm")).unwrap_or_default();
        let seconds = std::fs::read_to_string(dir.join("schedstat"))
            .ok()
            .and_then(|s| s.split_whitespace().next()?.parse::<f64>().ok())
            .map(|ns| ns / 1e9)
            .or_else(|| stat_seconds(&std::fs::read_to_string(dir.join("stat")).ok()?))
            .unwrap_or(0.0);
        match name.trim_end() {
            "game" => cpu.game += seconds,
            "log" => cpu.log += seconds,
            _ => cpu.network += seconds,
        }
    }
    cpu
}

/// A /proc stat line's user and system time (its 14th and 15th fields, after the name's parenthesis), s at the kernel's
/// fixed 100 ticks a second (USER_HZ)
fn stat_seconds(stat: &str) -> Option<f64> {
    let mut fields = stat.get(stat.rfind(')')? + 2..)?.split_whitespace().skip(11);
    let user: f64 = fields.next()?.parse().ok()?;
    let system: f64 = fields.next()?.parse().ok()?;
    Some((user + system) / 100.0)
}

/// The resident memory (/proc/self/status's VmRSS), bytes
pub fn resident_bytes() -> Option<u64> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    let line = status.lines().find(|l| l.starts_with("VmRSS:"))?;
    let kb: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kb * 1024)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stat_lines_cpu_time_is_its_user_and_system_ticks() {
        // (a name with a space and a parenthesis: the fields counted after its last one)
        let stat = "1234 (tokio (w) 1) S 1 2 3 4 5 6 7 8 9 10 250 50 11 12 13";
        assert_eq!(stat_seconds(stat), Some(3.0));
        assert_eq!(stat_seconds("garbage"), None);
    }

    #[test]
    fn this_threads_cpu_and_the_memory_are_read() {
        // (the test's thread is neither "game" nor "log": the rest's. It spins until that has grown 10 ms, 5 s at most:
        // the other tests share the cores, so a fixed spin's CPU time isn't known)
        // (at least one spin: the other tests' threads, the rest's too, can pass 10 ms before it, RV-1087)
        let before = thread_cpu();
        let start = std::time::Instant::now();
        let mut x = 0u64;
        let after = loop {
            for _ in 0..100_000 {
                x = x.wrapping_add(std::hint::black_box(1));
            }
            let after = thread_cpu();
            if after.network - before.network >= 0.01 || start.elapsed() >= Duration::from_secs(5) {
                break after;
            }
        };
        assert!(x > 0);
        assert!(after.network - before.network >= 0.01, "{before:?} -> {after:?}");
        assert!(after.game >= before.game && after.log >= before.log, "{before:?} -> {after:?}");
        assert!(resident_bytes().is_some_and(|b| b > 1 << 20));
    }

    #[test]
    fn the_counters_are_served_as_prometheus_text() {
        let m = Metrics::new();
        m.pass(Duration::from_micros(700), 3, 1, 2, 12);
        m.pass(Duration::from_micros(200), 0, 0, 2, 12);
        m.pass(Duration::from_millis(9), 1, 0, 2, 12);
        m.received(40);
        m.sent(300);
        m.sent(200);
        let text = m.encode();
        for line in [
            "carball_ticks_total 4",
            "carball_ticks_slipped_total 1",
            "carball_matches 2",
            "carball_players 12",
            "carball_datagrams_received_total 1",
            "carball_datagram_bytes_sent_total 500",
            // (the idle pass not observed: two passes, one at 0.7 ms, one at 9 ms)
            "carball_game_pass_seconds_count 2",
            "carball_game_pass_seconds_bucket{le=\"0.00075\"} 1",
            "carball_game_pass_seconds_bucket{le=\"0.01\"} 2",
            "carball_game_pass_max_seconds 0.009",
        ] {
            assert!(text.lines().any(|l| l == line), "{line:?} not in\n{text}");
        }
        assert!(text.contains("carball_thread_cpu_seconds_total{thread=\"game\"}"), "{text}");
        assert!(text.contains("carball_resident_memory_bytes "), "{text}");
        assert!(text.ends_with("# EOF\n"), "{text}");
        // (the longest pass taken by the scrape)
        let again = m.encode();
        let max = again.lines().find_map(|l| l.strip_prefix("carball_game_pass_max_seconds "));
        assert_eq!(max.and_then(|v| v.parse::<f64>().ok()), Some(0.0), "{again}");
    }
}
