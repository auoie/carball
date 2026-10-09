use std::path::PathBuf;

use rl_server::{engine, game_loop, net};

struct Args {
    port: u16,
    info_port: u16,
    meshes: PathBuf,
    team_size: u8,
    /// Browser tests: each round, the ball is knocked into a goal this long after "go"
    test_goal_after: Option<f32>,
}

fn parse_args() -> anyhow::Result<Args> {
    let mut args = Args {
        port: 4433,
        info_port: 4434,
        meshes: PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../out/arena/collision_meshes")),
        team_size: rl_server::game::TEAM_SIZE,
        test_goal_after: None,
    };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        let mut value = || it.next().ok_or_else(|| anyhow::anyhow!("{arg} needs a value"));
        match arg.as_str() {
            "--port" => args.port = value()?.parse()?,
            "--info-port" => args.info_port = value()?.parse()?,
            "--meshes" => args.meshes = value()?.into(),
            "--team-size" => args.team_size = value()?.parse()?,
            "--test-goal-after" => args.test_goal_after = Some(value()?.parse()?),
            _ => anyhow::bail!(
                "usage: rl-server [--port 4433] [--info-port 4434] [--meshes DIR] [--team-size 3] [--test-goal-after SECONDS]"
            ),
        }
    }
    Ok(args)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = parse_args()?;
    engine::init(&args.meshes)?;
    let (identity, cert_hash) = net::dev_identity()?;
    let server = net::endpoint(identity, args.port)?;

    let (to_game, messages) = tokio::sync::mpsc::unbounded_channel();
    let (team_size, test_goal_after) = (args.team_size, args.test_goal_after);
    std::thread::Builder::new().name("game".into()).spawn(move || game_loop::run(messages, team_size, test_goal_after))?;
    tokio::spawn(net::serve_info(args.info_port, args.port, cert_hash));
    println!("rl-server: game on UDP port {} (WebTransport), dev info on http://localhost:{}/info", args.port, args.info_port);
    let query = if args.info_port == 4434 { "server".to_string() } else { format!("server=localhost:{}", args.info_port) };
    println!("To play: run the web client (cd client && npm run dev) and open http://localhost:5173/?{query}");
    net::accept_loop(server, to_game).await;
    Ok(())
}
