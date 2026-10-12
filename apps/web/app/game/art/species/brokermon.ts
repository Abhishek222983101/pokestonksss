import { ellipseMask } from '../pixel';
import { K, W, hex, makeRamp, mix, lighten, flameShape, type MonCtx, type Color } from '../monkit';

/** Original BrokerMon painters (P8). Pure shape language, no logos. 32x32 grid, outline applied after. */

type G = MonCtx['g'];

function ring(g: G, cx: number, cy: number, rx: number, ry: number, c: Color, th = 0.8) {
  const o = ellipseMask(cx, cy, rx, ry), i = ellipseMask(cx, cy, rx - th, ry - th);
  for (let y = Math.floor(cy - ry) - 1; y <= Math.ceil(cy + ry) + 1; y++)
    for (let x = Math.floor(cx - rx) - 1; x <= Math.ceil(cx + rx) + 1; x++)
      if (o(x, y) && !i(x, y)) g.set(x, y, c);
}

function arcRing(g: G, cx: number, cy: number, rx: number, ry: number, c: Color, keep: (x: number, y: number) => boolean) {
  const o = ellipseMask(cx, cy, rx, ry), i = ellipseMask(cx, cy, rx - 0.9, ry - 0.9);
  for (let y = Math.floor(cy - ry) - 1; y <= Math.ceil(cy + ry) + 1; y++)
    for (let x = Math.floor(cx - rx) - 1; x <= Math.ceil(cx + rx) + 1; x++)
      if (o(x, y) && !i(x, y) && keep(x, y) && g.get(x, y) !== 0) g.set(x, y, c);
}

function eye2(g: G, x: number, y: number, iris: Color, glint: Color = W) {
  // 2 wide x 3 tall eye with glint
  g.set(x, y, glint); g.set(x + 1, y, K);
  g.set(x, y + 1, iris); g.set(x + 1, y + 1, K);
  g.set(x, y + 2, K); g.set(x + 1, y + 2, K);
}

function crescent(g: G, cx: number, cy: number, r: number, c: Color) {
  const a = ellipseMask(cx, cy, r, r), b = ellipseMask(cx + r * 0.55, cy - r * 0.15, r * 0.85, r * 0.85);
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
      if (a(x, y) && !b(x, y)) g.set(x, y, c);
}

/** SOL / Voltfox: kitsune with a lightning-bolt tail, green glow eyes, purple coat. */
export function voltfox(c: MonCtx) {
  const { p, g, A, B, front } = c;
  const cream = makeRamp(mix(A.hi, hex('#fff8f0'), 0.65));
  const glow = B.hi;
  // bolt tail (behind in front view, in front-right in back view)
  const bolt = [[20, 28], [23.4, 19], [19.6, 19.4], [26.2, 3.4], [27.4, 12.4], [31, 12], [24, 28.6]] as const;
  if (front) p.facet(bolt, B, 0.5);
  // ears
  for (const s of [-1, 1] as const) {
    p.facet([[16 + s * 3, 8], [16 + s * 8.6, 0.8], [16 + s * 8.4, 9.6]], A, 0.6);
    if (front) p.flat([[16 + s * 4.6, 7.6], [16 + s * 7.4, 3.6], [16 + s * 7.4, 8.4]], B.mid);
  }
  // legs + torso
  p.blob(12, 28.6, 3.2, 2.1, A); p.blob(20, 28.6, 3.2, 2.1, A);
  p.blob(16, 22.4, 6, 6.2, A);
  if (front) {
    p.blob(16, 23.6, 3.4, 4.4, cream, { edge: false, clean: true });
    g.set(15, 26, B.mid); g.set(16, 26, B.mid);
  } else {
    // glowing back stripes
    for (let i = 0; i < 3; i++) { g.hline(13, 19 + i * 3, 6, B.mid); g.hline(14, 20 + i * 3, 4, B.hi); }
  }
  // head
  p.blob(16, 13, 7.6, 6.2, A, { pow: 2.4 });
  // cheek tufts
  for (const s of [-1, 1] as const) p.facet([[16 + s * 6.4, 13], [16 + s * 12, 13.6], [16 + s * 7.4, 17.6]], A, 0.6);
  if (front) {
    p.blob(16, 16, 4, 2.8, cream, { edge: false, clean: true });
    eye2(g, 10, 11, glow); eye2(g, 20, 11, glow);
    g.set(9, 12, B.mid); g.set(22, 12, B.mid);
    g.set(15, 15, K); g.set(16, 15, K);
    g.set(14, 17, K); g.set(17, 17, K); g.set(15, 18, K); g.set(16, 18, K);
    // forehead bolt mark
    g.set(16, 8, B.hi); g.set(15, 9, B.mid); g.set(16, 10, B.hi);
  } else {
    g.hline(12, 9, 8, B.mid);
    p.facet(bolt, B, 0.5);
  }
}

/** BTC / Ironhorn: armoured bull with heavy plates and a golden coin medallion. */
export function ironhorn(c: MonCtx) {
  const { p, g, front } = c;
  const steel = makeRamp('#7f8aa0');
  const plate = makeRamp('#a3adbf');
  const horn = makeRamp('#f1e4c2');
  const dark = steel.deep;
  // horns
  for (const s of [-1, 1] as const) {
    p.poly([[16 + s * 5.6, 9], [16 + s * 12.4, 7.4], [16 + s * 13.4, 1.4], [16 + s * 10.6, 5.6], [16 + s * 6.4, 5.6]], horn, { edge: 'auto' });
  }
  // legs + body
  p.blob(9.6, 27.6, 3.6, 3, steel); p.blob(22.4, 27.6, 3.6, 3, steel);
  p.blob(16, 20.6, 10.4, 7.6, steel, { pow: 2.4 });
  // armour band across shoulders
  p.facet([[7, 15.4], [25, 15.4], [26.4, 19.4], [5.6, 19.4]], plate, 0.55);
  g.hline(8, 17, 16, plate.hi);
  for (const x of [9, 13, 18, 22]) g.set(x, 18, dark);
  // head
  p.blob(16, 11.4, 7.4, 6, steel, { pow: 2.4 });
  if (front) {
    p.facet([[11, 6.4], [21, 6.4], [19.4, 11.4], [12.6, 11.4]], plate, 0.5); // brow plate
    p.blob(16, 15.4, 4.6, 3.4, plate);
    g.set(13, 15, dark); g.set(14, 15, dark); g.set(18, 15, dark); g.set(19, 15, dark);
    // eyes under brow
    g.rect(11, 11, 3, 2, W); g.rect(18, 11, 3, 2, W);
    g.rect(12, 11, 2, 2, K); g.rect(18, 11, 2, 2, K);
    g.set(12, 11, W); g.set(19, 11, W);
    g.hline(11, 10, 3, dark); g.hline(18, 10, 3, dark);
    // golden medallion on chest
    const gold = makeRamp('#ffc233');
    p.blob(16, 23.6, 4.8, 4.8, gold);
    ring(g, 16, 23.6, 3.8, 3.8, gold.hi, 0.9);
    const glyph = ['KKK.', 'K..K', 'KKK.', 'K..K', 'KKK.'];
    p.stamp(glyph, 14, 21, { K: gold.deep });
    g.set(15, 20, gold.deep); g.set(17, 20, gold.deep); g.set(15, 26, gold.deep); g.set(17, 26, gold.deep);
  } else {
    p.facet([[10, 6.4], [22, 6.4], [21, 12], [11, 12]], plate, 0.5);
    for (let i = 0; i < 3; i++) g.hline(12, 8 + i * 2, 8, i === 1 ? dark : plate.hi);
    // rump plates + medallion on back
    p.facet([[9, 21], [23, 21], [22, 27], [10, 27]], plate, 0.5);
    const gold = makeRamp('#ffc233');
    p.blob(16, 24, 3.4, 3.4, gold);
    ring(g, 16, 24, 2.6, 2.6, gold.hi, 0.9);
    g.vline(16, 22, 5, gold.deep);
    // tail tuft
    p.limb(24, 22, 28, 27, 1, 2, steel);
  }
}

/** ETH / Prismoth: crystal moth, diamond wings split into prismatic facets. */
export function prismoth(c: MonCtx) {
  const { p, g, A, B, front } = c;
  const hues = ['#627eea', '#8f6bf0', '#4cc3f0', '#e47dd8', '#7be0c0'].map((h) => makeRamp(h));
  const fills = front ? [0, 1, 2, 3] : [1, 0, 3, 2];
  for (const s of [-1, 1] as const) {
    const X = (d: number) => 16 + s * d;
    // upper diamond wing, 3 facets meeting at a centre
    const ctr: [number, number] = [X(8), 12];
    const top: [number, number] = [X(10), 2], out: [number, number] = [X(15.4), 11], bot: [number, number] = [X(8.4), 21], inn: [number, number] = [X(2.6), 14];
    p.facet([top, out, ctr], hues[fills[0]], 0.5);
    p.facet([out, bot, ctr], hues[fills[1]], 0.5);
    p.facet([bot, inn, ctr], hues[fills[2]], 0.5);
    p.facet([inn, top, ctr], hues[fills[3]], 0.5);
    // lower diamond wing
    const c2: [number, number] = [X(7), 24];
    p.facet([[X(2.6), 20], [X(11), 20.6], c2], hues[4], 0.5);
    p.facet([[X(11), 20.6], [X(8), 29.6], c2], hues[fills[1]], 0.5);
    p.facet([[X(8), 29.6], [X(2.6), 26], c2], hues[fills[0]], 0.5);
    p.facet([[X(2.6), 26], [X(2.6), 20], c2], hues[fills[3]], 0.5);
    g.set(Math.round(ctr[0]) - (s > 0 ? 0 : 1), 12, W);
  }
  // body
  p.blob(16, 20.6, 3.4, 7, A);
  for (let i = 0; i < 3; i++) g.hline(14, 19 + i * 3, 4, B.mid);
  // head
  p.blob(16, 10.4, 4.4, 3.8, A);
  // antennae
  for (const s of [-1, 1] as const) {
    p.limb(16 + s * 2, 7.6, 16 + s * 5, 2, 0.5, 0.5, B, { edge: false });
    g.set(16 + s * 5 - (s < 0 ? 1 : 0), 1, B.hi);
  }
  if (front) {
    g.rect(13, 9, 2, 3, K); g.rect(17, 9, 2, 3, K);
    g.set(13, 9, W); g.set(17, 9, W);
    g.set(14, 10, B.hi); g.set(18, 10, B.hi);
    g.set(15, 13, K); g.set(16, 13, K);
    // crystal forehead gem
    p.flat([[16, 6.6], [17.6, 8.2], [16, 9.6], [14.4, 8.2]], B.hi, B.mid);
  } else {
    g.hline(14, 12, 4, A.sh);
    p.flat([[16, 13.6], [17.6, 15.2], [16, 16.6], [14.4, 15.2]], B.hi, B.mid);
  }
}

/** SUI / Surgeling: blue sea-serpent coiled on a wave with a curling water-drop crest. */
export function surgeling(c: MonCtx) {
  const { p, g, A, B, front } = c;
  const foam = makeRamp(mix(B.mid, hex('#bfe4ff'), 0.4));
  const belly = makeRamp(mix(A.hi, hex('#e8f6ff'), 0.6));
  // coiled body: ring of capsules, thinner than the head so the head reads as a head
  const pts: Array<[number, number]> = [[16, 16], [8.4, 19.6], [6.6, 25], [12, 28.4], [20.6, 28.2], [25.4, 24.4], [24.6, 19], [27, 13.4]];
  for (let i = 0; i < pts.length - 1; i++) {
    const r0 = i === 0 ? 3.6 : 3.2 - i * 0.14, r1 = 3.2 - (i + 1) * 0.14;
    p.limb(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], r0, r1, A);
  }
  // belly plates on the coil
  if (front) { for (const [x, y] of [[8, 22], [8.6, 26.4], [14, 28.6], [20, 28.6], [24.6, 24]] as const) { g.set(x, y, belly.hi); g.set(x + 1, y, belly.mid); } }
  else { for (const [x, y] of [[8, 22], [9, 27], [15, 28], [21, 28], [25, 23]] as const) { g.set(x, y, A.hi); g.set(x + 1, y + 1, A.sh); } }
  // tail fin
  p.facet([[27, 14], [23.4, 6.6], [30.4, 8.4]], B, 0.5);
  // foam on the water line
  for (const x of [3, 14, 18, 28]) { g.set(x, 29, foam.hi); g.set(x + 1, 29, foam.hi); }
  // head
  p.blob(16, 11, 6.8, 5.6, A, { pow: 2.4 });
  for (const s of [-1, 1] as const) p.facet([[16 + s * 6, 9], [16 + s * 11.4, 8], [16 + s * 8, 13.4]], B, 0.5);
  // curling water-drop crest
  p.blob(16, 5.6, 2.6, 2.6, foam);
  p.poly([[13.6, 6], [16, 1], [18.4, 6]], foam, { edge: 'auto' });
  p.limb(18.4, 6.4, 22, 4, 1.2, 0.8, foam);
  g.set(22, 3, foam.hi);
  if (front) {
    p.blob(16, 13.6, 3.8, 2.4, belly, { edge: false, clean: true });
    eye2(g, 10, 9, B.hi); eye2(g, 20, 9, B.hi);
    g.set(13, 14, K); g.set(14, 15, K); g.set(15, 15, K); g.set(16, 15, K); g.set(17, 15, K); g.set(18, 14, K);
  } else {
    for (let i = 0; i < 3; i++) g.hline(14, 9 + i * 2, 4, B.mid);
  }
}

/** ZEC / Veilwisp: hooded ghost wisp with a cloak, glowing eyes and dark-gold trim. */
export function veilwisp(c: MonCtx) {
  const { p, g, A, front } = c;
  const cloak = makeRamp('#3a3248');
  const void_ = hex('#0e0a16');
  // side wisps (flames)
  const fl = (x: number, y: number, h: number, sw: number) => flameShape(p, x, y, 5, h, sw, [A.mid, A.hi, hex('#fff2b8')], A.deep);
  fl(5, 20, 8, 1.2); fl(27, 17, 9, -1.4);
  // cloak body tapering to a ragged hem
  p.poly([[8.4, 14], [23.6, 14], [27, 25], [25, 29.6], [21.4, 27], [18.6, 30.4], [16, 27.4], [13.4, 30.4], [10.6, 27], [7, 29.6], [5, 25]], cloak, { edge: 'auto' });
  // gold hem
  for (const [x, y] of [[7, 28], [10, 26], [13, 28], [16, 26], [19, 28], [22, 26], [25, 28]]) g.set(x, y, A.mid);
  // hood
  p.blob(16, 11.6, 8.4, 8.2, cloak, { pow: 2.2 });
  p.poly([[13, 5], [16, 0.8], [19, 5]], cloak, { edge: 'auto' }); // peaked hood tip
  if (front) {
    // face void
    p.disc(16, 12.4, 5.8, 5, void_, cloak.deep);
    // glowing eyes
    g.rect(11, 11, 3, 3, hex('#fff2b8')); g.rect(18, 11, 3, 3, hex('#fff2b8'));
    g.set(12, 12, A.mid); g.set(19, 12, A.mid); g.set(12, 13, A.mid); g.set(19, 13, A.mid);
    g.set(11, 11, W);
    // gold hood trim
    ring(g, 16, 12.4, 6.4, 5.6, A.mid, 0.9);
    // clasp
    p.disc(16, 17.8, 1.7, 1.7, A.hi, A.deep);
    // arm flaps
    p.blob(8, 21, 2.4, 3.6, cloak); p.blob(24, 21, 2.4, 3.6, cloak);
  } else {
    // back of the hood with a sigil
    for (let i = 0; i < 4; i++) g.hline(14 - (i > 1 ? 1 : 0) + (i === 3 ? 0 : 0), 8 + i * 2, 4 + (i > 1 ? 2 : 0), cloak.sh);
    p.flat([[16, 10], [18, 12.4], [16, 14.8], [14, 12.4]], A.mid, A.deep);
    g.set(16, 12, A.hi);
    g.vline(16, 16, 10, cloak.sh);
    g.vline(15, 16, 8, cloak.hi);
  }
}

/** BNB / Gildcrest: golden crested bird with a coin-shaped crest, yellow and black. */
export function gildcrest(c: MonCtx) {
  const { p, g, A, front } = c;
  const beak = makeRamp('#f08a24');
  const black = makeRamp('#3a3a44');
  // tail feathers behind
  if (!front) { for (const [dx, h] of [[-4, 6], [0, 8], [4, 6]] as const) p.facet([[16 + dx - 1.6, 22], [16 + dx + 1.6, 22], [16 + dx * 1.4, 22 + h]], black, 0.5); }
  // feet
  p.blob(12.6, 29.2, 2.6, 1.4, beak); p.blob(19.4, 29.2, 2.6, 1.4, beak);
  // body
  p.blob(16, 22, 8, 7, A);
  if (front) p.blob(16, 23.6, 4.8, 4.8, makeRamp(lighten(A.mid, 0.4)), { edge: false, clean: true });
  // wings
  for (const s of [-1, 1] as const) {
    p.poly([[16 + s * 7.4, 16.6], [16 + s * 11.6, 20.6], [16 + s * 8.8, 27], [16 + s * 6, 26]], black, { edge: 'auto' });
    if (!front) p.poly([[16 + s * 6.8, 16.4], [16 + s * 3, 17], [16 + s * 2, 27], [16 + s * 7, 26]], black, { edge: 'auto' });
  }
  // head
  p.blob(16, 11.6, 7, 6.4, A, { pow: 2.4 });
  // crest feathers + coin
  for (const s of [-1, 1] as const) p.facet([[16 + s * 3, 6.6], [16 + s * 7.4, 3.6], [16 + s * 6.6, 8]], A, 0.55);
  const coin = makeRamp(lighten(A.mid, 0.12));
  p.blob(16, 4.2, 4.2, 3.8, coin);
  ring(g, 16, 4.2, 3.2, 2.8, coin.sh, 0.9);
  if (front) { g.vline(16, 3, 3, coin.hi); g.set(15, 4, coin.deep); g.set(17, 4, coin.deep); }
  else { g.vline(16, 2, 5, coin.sh); }
  if (front) {
    // eyes with black mask
    p.flat([[8, 10], [24, 10], [22, 14.4], [10, 14.4]], black.mid, black.deep);
    eye2(g, 10, 10, hex('#ffd24a')); eye2(g, 20, 10, hex('#ffd24a'));
    g.set(10, 10, W); g.set(20, 10, W);
    // beak
    p.flat([[14, 14], [18, 14], [16, 18.6]], beak.mid, beak.deep);
    g.set(15, 14, beak.hi);
  } else {
    p.flat([[10, 10], [22, 10], [20, 14], [12, 14]], black.mid, black.deep);
  }
}

/** DOGE / Moonpup: small moon pup with a crescent mark and a big grin, tan and gold. */
export function moonpup(c: MonCtx) {
  const { p, g, A, B, front } = c;
  const cream = makeRamp('#fff0cf');
  const moon = hex('#fff6b8');
  // tail curling up behind with moon tip
  p.limb(21, 25, 27, 21, 2, 1.8, A);
  p.limb(27, 21, 26, 14.6, 1.8, 1.6, A);
  crescent(g, 25.4, 12.6, 2.6, moon);
  // legs + torso
  p.blob(11.6, 28.8, 3.2, 2, A); p.blob(20.4, 28.8, 3.2, 2, A);
  p.blob(16, 23, 6.8, 6, A);
  if (front) p.blob(16, 24.4, 3.8, 4, cream, { edge: false, clean: true });
  else { crescent(g, 16, 22.6, 3.4, moon); }
  // floppy ears
  for (const s of [-1, 1] as const) {
    p.blob(16 + s * 9, 11.4, 3, 5.4, B, { rot: s * 0.25 });
  }
  // head
  p.blob(16, 12.6, 8, 6.6, A, { pow: 2.4 });
  if (front) {
    p.blob(16, 16.6, 5.4, 3.6, cream, { edge: false, clean: true });
    // forehead crescent
    crescent(g, 16, 7.4, 2.4, moon);
    eye2(g, 10, 10, hex('#6a4a1a')); eye2(g, 20, 10, hex('#6a4a1a'));
    g.set(10, 10, W); g.set(20, 10, W);
    g.set(15, 14, K); g.set(16, 14, K);
    // big grin with tongue
    g.hline(11, 16, 10, K);
    g.set(10, 15, K); g.set(21, 15, K);
    g.hline(12, 17, 8, hex('#7a2030'));
    g.hline(13, 18, 6, hex('#e8566a'));
    g.hline(12, 17, 8, hex('#7a2030'));
    g.hline(13, 19, 6, K);
    g.hline(12, 17, 2, W); g.hline(18, 17, 2, W);
  } else {
    crescent(g, 16, 8, 2.6, moon);
    g.hline(12, 12, 8, A.sh);
  }
}

/** XRP / Ripplet: rippling steel-blue otter-eel with concentric ripple patterns. */
export function ripplet(c: MonCtx) {
  const { p, g, B, front } = c;
  const A = makeRamp('#7b93ad');
  const belly = makeRamp(mix(A.hi, hex('#e0f0ff'), 0.55));
  // ripple pool under the body
  ring(g, 16, 28, 13, 3, B.mid, 0.9);
  ring(g, 16, 28, 8.4, 1.9, B.hi, 0.9);
  // eel tail looping up the right side, ending in a ripple
  p.limb(19, 26, 26, 24, 3, 2.4, A);
  p.limb(26, 24, 27, 17, 2.4, 1.8, A);
  p.limb(27, 17, 24, 12.6, 1.8, 1.2, A);
  ring(g, 24, 11, 3.2, 2.4, B.hi, 0.9);
  // body
  p.blob(16, 21.4, 7, 7.6, A);
  if (front) {
    p.blob(16, 22.4, 4.2, 5.4, belly, { edge: false, clean: true });
    ring(g, 16, 23.4, 2.2, 2.6, B.mid, 0.9); ring(g, 16, 23.4, 3.6, 4.2, B.mid, 0.9);
    arcRing(g, 16, 23.4, 3.6, 4.2, belly.mid, () => false);
  } else {
    for (const [r, k] of [[2.2, 1], [4, 2], [5.8, 3]] as const) ring(g, 16, 22, r * 1.1, r, k === 2 ? B.hi : B.mid, 0.9);
  }
  // little arms
  if (front) { p.blob(8.6, 22, 2, 3, A); p.blob(23.4, 22, 2, 3, A); }
  // head: sleek rounded
  p.blob(16, 12, 7.4, 6.4, A, { pow: 2.4 });
  // small round ears
  for (const s of [-1, 1] as const) p.blob(16 + s * 6, 5.8, 1.9, 1.9, A);
  if (front) {
    p.blob(16, 15.4, 4.6, 3, belly, { edge: false, clean: true });
    eye2(g, 10, 10, B.hi); eye2(g, 20, 10, B.hi);
    g.set(15, 14, K); g.set(16, 14, K); g.set(15, 15, K); g.set(16, 15, K);
    g.set(14, 17, K); g.set(17, 17, K); g.hline(15, 18, 2, K);
    // whiskers
    for (const s of [-1, 1] as const) { g.hline(s < 0 ? 5 : 24, 15, 3, belly.hi); g.hline(s < 0 ? 5 : 24, 17, 3, belly.hi); }
    // forehead ripple
    ring(g, 16, 7.6, 2.4, 1.4, B.hi, 0.8);
  } else {
    ring(g, 16, 10.4, 3, 2, B.hi, 0.8); ring(g, 16, 10.4, 5.4, 3.6, B.mid, 0.8);
  }
}
