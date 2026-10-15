use std::path::PathBuf;

use rl_server::game::MatchType;
use rl_server::match_host::Playlist;
use rl_server::{engine, game_loop, net};

struct Args {
    port: u16,
    info_port: u16,
    meshes: PathBuf,
    team_size: u8,
    /// Who may vote to forfeit and when, and whether a team left without players forfeits
    match_type: MatchType,
    /// The clock time before forfeit votes (s; default: the match type's, 60 casual, 90 ranked and private)
    forfeit_vote_wait: Option<f32>,
    /// Browser tests: each round, the ball is knocked into a goal this long after "go"
    test_goal_after: Option<f32>,
    /// The queue's matches (1v1, 2v2, 3v3: searches and claims only), not one open match
    queue: bool,
}

fn parse_args(mut it: impl Iterator<Item = String>) -> anyhow::Result<Args> {
    let mut args = Args {
        port: 4433,
        info_port: 4434,
        meshes: PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../out/arena/collision_meshes")),
        team_size: rl_server::game::TEAM_SIZE,
        match_type: MatchType::Casual,
        forfeit_vote_wait: None,
        test_goal_after: None,
        queue: false,
    };
    while let Some(arg) = it.next() {
        let mut value = || it.next().ok_or_else(|| anyhow::anyhow!("{arg} needs a value"));
        match arg.as_str() {
            "--port" => args.port = value()?.parse()?,
            "--info-port" => args.info_port = value()?.parse()?,
            "--meshes" => args.meshes = value()?.into(),
            "--team-size" => {
                // (two teams of it within the match's most players: RV-329)
                args.team_size = value()?.parse()?;
                anyhow::ensure!((1..=(rl_server::game::MAX_PLAYERS / 2) as u8).contains(&args.team_size), "--team-size: 1 to {}", rl_server::game::MAX_PLAYERS / 2);
            }
            "--match-type" => {
                args.match_type = match value()?.as_str() {
                    "casual" => MatchType::Casual,
                    "ranked" => MatchType::Ranked,
                    "private" => MatchType::Private,
                    other => anyhow::bail!("--match-type {other}: casual, ranked or private"),
                }
            }
            "--forfeit-vote-wait" => args.forfeit_vote_wait = Some(value()?.parse()?),
            "--test-goal-after" => args.test_goal_after = Some(value()?.parse()?),
            "--mode" => {
                args.queue = match value()?.as_str() {
                    "direct" => false,
                    "queue" => true,
                    other => anyhow::bail!("--mode {other}: direct or queue"),
                }
            }
            _ => anyhow::bail!(
                "usage: rl-server [--mode direct|queue] [--port 4433] [--info-port 4434] [--meshes DIR] [--team-size 3] [--match-type casual|ranked|private] [--forfeit-vote-wait SECONDS] [--test-goal-after SECONDS]"
            ),
        }
    }
    Ok(args)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = parse_args(std::env::args().skip(1))?;
    engine::init(&args.meshes)?;
    let (identity, cert_hash) = net::dev_identity()?;
    let server = net::endpoint(identity, args.port)?;

    // (bounded: a flood of messages waits in its session instead of growing the game's queue, RV-248)
    let (to_game, messages) = tokio::sync::mpsc::channel(game_loop::TO_GAME_QUEUE);
    let playlist = |team_size| Playlist { team_size, match_type: args.match_type, forfeit_vote_wait: args.forfeit_vote_wait };
    // (direct: one open match of --team-size; queue: the 1v1, 2v2 and 3v3 playlists)
    let mode = if args.queue { game_loop::Mode::Queue([1, 2, 3].map(playlist).to_vec()) } else { game_loop::Mode::Direct(playlist(args.team_size)) };
    let test_goal_after = args.test_goal_after;
    std::thread::Builder::new().name("game".into()).spawn(move || game_loop::run(messages, mode, test_goal_after))?;
    tokio::spawn(net::serve_info(args.info_port, args.port, cert_hash));
    let mode = if args.queue { "the queue's matches" } else { "one open match" };
    println!("rl-server: {mode}, game on UDP port {} (WebTransport), dev info on http://localhost:{}/info", args.port, args.info_port);
    let query = if args.info_port == 4434 { "server".to_string() } else { format!("server=localhost:{}", args.info_port) };
    println!("To play: run the web client (cd client && npm run dev) and open http://localhost:5173/?{query}");
    net::accept_loop(server, to_game).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> anyhow::Result<Args> {
        parse_args(args.iter().map(|a| (*a).to_string()))
    }

    #[test]
    fn a_team_size_outside_the_match_is_refused_and_the_mode_named() {
        // (two teams within the match's most players: RV-329, RV-344)
        for bad in ["0", "9", "255", "-1", "x"] {
            assert!(parse(&["--team-size", bad]).is_err(), "--team-size {bad}");
        }
        for good in 1..=8 {
            assert_eq!(parse(&["--team-size", &good.to_string()]).unwrap().team_size, good);
        }
        assert!(parse(&["--mode", "queue"]).unwrap().queue);
        assert!(!parse(&["--mode", "direct"]).unwrap().queue);
        assert!(!parse(&[]).unwrap().queue, "direct by default");
        assert!(parse(&["--mode", "ranked"]).is_err());
        assert!(parse(&["--team-size"]).is_err(), "a value needed");
    }
}
