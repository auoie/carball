// The stat events' icons: our own vector drawings after the shapes notes/scoreboard.md SB-16 describes (the game's art
// isn't shipped). White glyphs on a 128-unit canvas with dark detail lines; the HUD adds the halo (CSS drop-shadow:
// orange in the popup and the feed, SB-15).
import type { StatIcon } from "../game/matchStats";

const DARK = "#1a1a1a";

/** A ball (white, a dark pentagon and seams) centred at (x, y) */
function ball(x: number, y: number, r: number): string {
  const p = Array.from({ length: 5 }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    return `${(x + Math.cos(a) * r * 0.36).toFixed(1)},${(y + Math.sin(a) * r * 0.36).toFixed(1)}`;
  });
  const seams = Array.from({ length: 5 }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const [x1, y1] = [x + Math.cos(a) * r * 0.36, y + Math.sin(a) * r * 0.36];
    const [x2, y2] = [x + Math.cos(a) * r * 0.95, y + Math.sin(a) * r * 0.95];
    return `M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }).join("");
  return `<circle cx="${String(x)}" cy="${String(y)}" r="${String(r)}" fill="#fff" stroke="${DARK}" stroke-width="3"/><polygon points="${p.join(" ")}" fill="${DARK}"/><path d="${seams}" stroke="${DARK}" stroke-width="2.5" fill="none"/>`;
}

/** A star with `points` tips between radii r1 and r2 (uneven: the radii vary by `wobble`) */
function star(x: number, y: number, points: number, r1: number, r2: number, wobble: readonly number[] = []): string {
  const v: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const r = i % 2 === 0 ? r1 * (wobble[(i / 2) % Math.max(1, wobble.length)] ?? 1) : r2;
    v.push(`${(x + Math.cos(a) * r).toFixed(1)},${(y + Math.sin(a) * r).toFixed(1)}`);
  }
  return v.join(" ");
}

const ICONS: Record<StatIcon, string> = {
  // A ball in a jagged, uneven starburst (longest spikes to the left and lower right)
  goal: `<polygon points="${star(64, 64, 13, 60, 36, [0.9, 0.8, 0.95, 0.75, 1.05, 1, 0.85, 1.05, 0.8, 0.9, 1.06, 0.85, 0.95])}" fill="#fff"/>${ball(64, 64, 28)}`,
  // Two raised open hands: an outlined one behind and up-right, a solid one in front
  assist: `<g transform="translate(18 -10)"><path d="M48 112V62c0-5 7-5 7 0V38c0-6 8-6 8 0v22V30c0-6 8-6 8 0v30V36c0-6 8-6 8 0v34l6-10c3-6 11-3 8 3L82 98c-4 9-10 14-20 14z" fill="none" stroke="#fff" stroke-width="5"/></g><path d="M30 122V72c0-5 7-5 7 0V48c0-6 8-6 8 0v22V40c0-6 8-6 8 0v30V46c0-6 8-6 8 0v34l6-10c3-6 11-3 8 3L64 108c-4 9-10 14-20 14z" fill="#fff" stroke="${DARK}" stroke-width="2"/>`,
  // A ball with a flat halo ring above it
  save: `<ellipse cx="64" cy="26" rx="34" ry="10" fill="none" stroke="#fff" stroke-width="8"/>${ball(64, 80, 34)}`,
  // A ball flying up-right, a tilted halo above it, streaks trailing to the lower left
  epicSave: `<path d="M14 118L44 88M10 100L36 78M28 122L50 98M6 82L28 66" stroke="#fff" stroke-width="7" stroke-linecap="round"/><ellipse cx="82" cy="24" rx="28" ry="8" transform="rotate(-18 82 24)" fill="none" stroke="#fff" stroke-width="7"/>${ball(78, 62, 28)}`,
  // A comet: the ball at the lower right, wavy flame tongues trailing to the upper left
  shot: `<path d="M86 66C60 50 40 34 12 10c18 22 30 34 40 50C40 50 26 44 8 40c22 12 36 22 48 36C46 74 36 74 22 76c20 4 36 10 52 22z" fill="#fff" stroke="${DARK}" stroke-width="2"/>${ball(86, 88, 30)}`,
  // A round bomb: a solid sphere, a cap at the upper right, a curled fuse ending in a spark
  demolish: `<circle cx="56" cy="76" r="42" fill="#fff" stroke="${DARK}" stroke-width="3"/><rect x="78" y="28" width="22" height="18" rx="3" transform="rotate(40 89 37)" fill="#fff" stroke="${DARK}" stroke-width="3"/><path d="M96 28c4-10 12-12 16-6" fill="none" stroke="#fff" stroke-width="5"/><polygon points="${star(114, 16, 8, 12, 5)}" fill="#fff"/><path d="M34 62c4-10 12-16 22-18" stroke="${DARK}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  // A laurel wreath around a large five-point star
  mvp: `<path d="M36 112C10 96 6 56 26 24M92 112c26-16 30-56 10-88" fill="none" stroke="#fff" stroke-width="6"/>${[0, 1, 2, 3, 4]
    .map((i) => {
      const t = 0.15 + i * 0.17;
      const y = 104 - t * 90;
      const dx = 22 - Math.sin(t * Math.PI) * 14;
      return `<ellipse cx="${(dx + 2).toFixed(1)}" cy="${y.toFixed(1)}" rx="9" ry="4" transform="rotate(-50 ${(dx + 2).toFixed(1)} ${y.toFixed(1)})" fill="#fff"/><ellipse cx="${(126 - dx).toFixed(1)}" cy="${y.toFixed(1)}" rx="9" ry="4" transform="rotate(50 ${(126 - dx).toFixed(1)} ${y.toFixed(1)})" fill="#fff"/>`;
    })
    .join(
      "",
    )}<path d="M48 114h32" stroke="#fff" stroke-width="6"/><polygon points="${star(64, 64, 5, 34, 14)}" fill="#fff" stroke="${DARK}" stroke-width="2"/>`,
  // A trophy: a round cup with a star cut out, side handles, a short stem and a stepped base
  win: `<path d="M36 14h56v26c0 22-12 36-28 36S36 62 36 40z" fill="#fff" stroke="${DARK}" stroke-width="2"/><path d="M36 22H18c0 18 8 28 22 30M92 22h18c0 18-8 28-22 30" fill="none" stroke="#fff" stroke-width="6"/><path d="M58 76h12v18H58z" fill="#fff"/><path d="M42 94h44v10H42zM34 104h60v12H34z" fill="#fff" stroke="${DARK}" stroke-width="2"/><polygon points="${star(64, 40, 5, 14, 6)}" fill="${DARK}"/>`,
  generic: `<polygon points="${star(64, 64, 5, 52, 22)}" fill="#fff" stroke="${DARK}" stroke-width="2"/>`,
};

/** The icon as an SVG element's markup (sized by its container) */
export function statIconSvg(icon: StatIcon): string {
  return `<svg viewBox="0 0 128 128" aria-hidden="true">${ICONS[icon]}</svg>`;
}
