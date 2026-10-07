// A dystopian cyberpunk megacity at night: the arena on a rooftop deck with neon rails, high above streets lost in
// violet smog; skyscrapers all round with lit windows and neon trims, neon signs, holographic billboards (one is an eye,
// watching), flying cars in lanes over the streets, an elevated train through the canyon, searchlights sweeping the
// clouds, and rain. Neon rim light (magenta one side, cyan the other) keeps the cars and ball readable. Generated and
// seeded like the other themes; about a dozen draw calls.
import { AmbientLight, Color, DirectionalLight, Fog, Group, HemisphereLight, Vector3 } from "three";
import {
  DECK,
  billboardsOnTowers,
  buildBeacons,
  buildBillboards,
  buildDeck,
  buildDeckNeon,
  buildRain,
  buildSearchlights,
  buildSigns,
  buildStreets,
  buildTowers,
  buildTrain,
  buildTraffic,
  layoutTowers,
  streetLines,
} from "./cityscape";
import { Sky } from "./sky";
import type { Theme } from "./theme";
import type { Placement } from "./shapes";

const SEED = 20261008;

export function cityTheme(): Theme {
  const smog = new Color(0x2d1a4f);
  const root = new Group();
  const magenta = new DirectionalLight(0xff3fd2, 1.2);
  magenta.position.set(-8000, 5000, 3000);
  const cyan = new DirectionalLight(0x2ee6ff, 1.2);
  cyan.position.set(8000, 4000, -4000);
  root.add(new HemisphereLight(0x6b5cff, 0x0a0812, 0.8), new AmbientLight(0x5a5a80, 0.45), magenta, cyan);

  const sky = new Sky({
    zenith: new Color(0x07061a),
    horizon: smog,
    sunDirection: new Vector3(0, -1, 0),
    sunStrength: 0,
    radius: 30000,
    clouds: { color: new Color(0x3a2560), cover: 0.8 }, // low smog, lit from below by the city
  });
  const towers = layoutTowers(SEED);
  // The train runs along the street just beyond the deck's left side, below the deck
  const trackX = (streetLines().filter((x) => x < -DECK.halfX - 300).at(-1) ?? -6500);
  const trackY = -900;
  const towerMesh = buildTowers(towers);
  const beacons = buildBeacons(towers);
  const cornerBillboards = [-1, 1].flatMap((sx) =>
    [-1, 1].map(
      (sz): Placement => ({
        position: [sx * (DECK.halfX - 250), 3050, sz * (DECK.halfZ - 250)],
        rotation: [0, Math.atan2(-sx, -sz), 0], // facing the field
        scale: [1600, 890, 1],
      }),
    ),
  );
  const billboards = buildBillboards([...cornerBillboards, ...billboardsOnTowers(towers, SEED + 3, 9)]);
  const traffic = buildTraffic(SEED + 4);
  const train = buildTrain(trackX, trackY);
  const searchlights = buildSearchlights(towers, SEED + 5);
  const rain = buildRain(SEED + 6, 1700, 16000);
  root.add(
    sky.mesh,
    buildStreets(),
    buildDeck(trackX, trackY),
    buildDeckNeon(),
    towerMesh.mesh,
    beacons.mesh,
    buildSigns(towers, SEED + 2),
    billboards.mesh,
    traffic.mesh,
    train.mesh,
    searchlights.mesh,
    rain.lines,
  );

  return {
    background: smog,
    fog: new Fog(smog, 4000, 30000),
    style: {
      floor: new Color(0x1c1f38),
      floorStripe: new Color(0x22264a),
      markings: new Color(0x5ff6ff), // neon lines on the dark deck
      walls: {
        neutral: new Color(0x3ff0ff),
        blue: new Color(0x2a7fff),
        orange: new Color(0xff8a1f),
        lines: 0.32, // (a neon cage)
        ceilingLines: 0.06,
      },
    },
    root,
    update(seconds) {
      sky.update(seconds);
      for (const clock of [towerMesh.time, beacons.time, billboards.time, traffic.time, train.time, rain.time]) {
        clock.value = seconds;
      }
      searchlights.update(seconds);
    },
  };
}
