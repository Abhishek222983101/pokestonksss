import * as Phaser from 'phaser';
import { audio } from '../audio';
import { rankOf } from '../../../lib/rank';
import { C, H, W, drawFrame, txt } from './ui';

export interface EndOptions {
  won: boolean;
  turns: number;
  forfeit: boolean;
  foeLabel: string;
  ratingBefore: number;
  ratingAfter: number;
  /** Creature XP / level change from this win (chain battles). Levels are display levels (1-based). */
  /** Private ER duel: no rating, show the sealed-duel result card instead. */
  privateDuel?: boolean;
  progress?: { name: string; fromName: string; levelBefore: number; levelAfter: number; xpGain: number; evolved: boolean; pctBefore: number; pctAfter: number; maxed: boolean };
  onContinue: () => void;
}

/** Result card: outcome, rating change and rank. No claim step: the rating is the reward. */
export class EndOverlay {
  private objs: Phaser.GameObjects.GameObject[] = [];
  private status!: Phaser.GameObjects.Text;
  private badge!: Phaser.GameObjects.Text;
  private keys: Array<[string, () => void]> = [];

  constructor(private scene: Phaser.Scene, private o: EndOptions) {
    const { won } = o;
    const dim = scene.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.72).setDepth(100).setAlpha(0);
    scene.tweens.add({ targets: dim, alpha: 0.72, duration: 300 });
    const panel = scene.add.graphics().setDepth(101);
    drawFrame(panel, W / 2 - 330, 90, 660, 530, { fill: C.navy, border: won ? C.gold : C.grayDark, borderW: 5, inner: C.white });
    const title = txt(scene, W / 2, 172, won ? 'YOU WIN!' : 'LIQUIDATED', won ? 38 : 34, won ? '#ffd23c' : '#f85858', { stroke: '#181818', strokeThickness: 8 }).setOrigin(0.5).setDepth(102);
    scene.tweens.add({ targets: title, scale: { from: 0.2, to: 1 }, duration: 320, ease: 'Back.easeOut' });
    if (won) scene.tweens.add({ targets: title, scale: 1.06, duration: 520, yoyo: true, repeat: -1, delay: 320, ease: 'Sine.easeInOut' });

    const sub = o.forfeit
      ? (won ? 'The opponent forfeited.' : 'You closed your position early.')
      : (won ? `${o.foeLabel} ran out of margin.` : 'Your margin hit zero.');
    const s1 = txt(scene, W / 2, 230, sub, 12, '#ffffff').setOrigin(0.5).setDepth(102);
    const s2 = txt(scene, W / 2, 258, `${o.turns} turn${o.turns === 1 ? '' : 's'} vs ${o.foeLabel}`, 10, '#a8b8f8').setOrigin(0.5).setDepth(102);
    this.objs.push(dim, panel, title, s1, s2);

    if (o.privateDuel) {
      const card = scene.add.graphics().setDepth(102);
      drawFrame(card, W / 2 - 270, 292, 540, 120, { fill: C.navyDark, border: C.slate, borderW: 3 });
      const l1 = txt(scene, W / 2, 316, 'PRIVATE ER DUEL', 11, '#a8b8f8').setOrigin(0.5).setDepth(103);
      const l2 = txt(scene, W / 2, 350, 'Both picks stayed sealed in the TEE', 11, '#f8f8d0').setOrigin(0.5).setDepth(103);
      const l3 = txt(scene, W / 2, 378, 'until each turn resolved', 11, '#f8f8d0').setOrigin(0.5).setDepth(103);
      this.objs.push(card, l1, l2, l3);
    } else {
    const delta = o.ratingAfter - o.ratingBefore;
    const card = scene.add.graphics().setDepth(102);
    drawFrame(card, W / 2 - 270, 292, 540, 120, { fill: C.navyDark, border: C.slate, borderW: 3 });
    const lbl = txt(scene, W / 2, 312, 'RATING', 9, '#a8b8f8').setOrigin(0.5).setDepth(103);
    const before = txt(scene, W / 2 - 110, 350, String(o.ratingBefore), 22, '#c8c8d8').setOrigin(0.5).setDepth(103);
    const arrow = txt(scene, W / 2, 350, '▶', 16, '#d8a830').setOrigin(0.5).setDepth(103);
    const after = txt(scene, W / 2 + 110, 350, String(o.ratingBefore), 28, '#f8d858', { stroke: '#181818', strokeThickness: 5 }).setOrigin(0.5).setDepth(103);
    const dTxt = txt(scene, W / 2 + 200, 350, '', 12, delta >= 0 ? '#58d858' : '#f85858').setOrigin(0, 0.5).setDepth(103).setAlpha(0);
    const rank = txt(scene, W / 2, 388, rankOf(o.ratingAfter).toUpperCase(), 11, '#f8f8d0').setOrigin(0.5).setDepth(103);
    this.objs.push(card, lbl, before, arrow, after, dTxt, rank);
    const count = { v: o.ratingBefore };
    scene.tweens.add({
      targets: count, v: o.ratingAfter, delay: 520, duration: 800, ease: 'Sine.easeOut',
      onUpdate: () => after.setText(String(Math.round(count.v))),
      onComplete: () => { after.setText(String(o.ratingAfter)); dTxt.setText(`${delta >= 0 ? '+' : ''}${delta}`).setAlpha(1); audio.sfx(delta >= 0 ? 'levelup' : 'menu_back'); },
    });

    }

    // creature progress: xp bar, level up, evolution
    const pr = o.progress;
    if (pr && !o.privateDuel) {
      const y = 424;
      const head = txt(scene, W / 2, y, `${pr.name.toUpperCase()}  LV ${pr.levelAfter}   +${pr.xpGain} XP`, 11, '#f8f8d0').setOrigin(0.5).setDepth(103);
      const barBg = scene.add.graphics().setDepth(102);
      barBg.fillStyle(C.ink, 1); barBg.fillRoundedRect(W / 2 - 200, y + 18, 400, 16, 5);
      barBg.fillStyle(0x3a3f66, 1); barBg.fillRoundedRect(W / 2 - 198, y + 20, 396, 12, 4);
      const fill = scene.add.graphics().setDepth(103);
      const draw = (pct: number) => { fill.clear(); fill.fillStyle(0xf8d030, 1); fill.fillRect(W / 2 - 198, y + 20, Math.round(396 * Math.max(0, Math.min(1, pct))), 12); fill.fillStyle(0xffffff, 0.35); fill.fillRect(W / 2 - 198, y + 20, Math.round(396 * Math.max(0, Math.min(1, pct))), 3); };
      const leveled = pr.levelAfter > pr.levelBefore;
      const bar = { v: leveled ? 0 : pr.pctBefore };
      draw(leveled ? 0 : pr.pctBefore);
      scene.tweens.add({ targets: bar, v: pr.pctAfter, delay: 900, duration: 700, ease: 'Sine.easeOut', onUpdate: () => draw(bar.v) });
      this.objs.push(head, barBg, fill);
      if (leveled || pr.evolved) {
        const msg = pr.evolved ? `EVOLVED!  ${pr.fromName.toUpperCase()}  >  ${pr.name.toUpperCase()}` : `LEVEL UP!  LV ${pr.levelBefore} > LV ${pr.levelAfter}`;
        const up = txt(scene, W / 2, y + 44, msg, 13, pr.evolved ? '#ffd23c' : '#58d858', { stroke: '#181818', strokeThickness: 5 }).setOrigin(0.5).setDepth(104).setAlpha(0);
        scene.tweens.add({ targets: up, alpha: 1, scale: { from: 0.4, to: 1 }, delay: 1400, duration: 380, ease: 'Back.easeOut', onStart: () => audio.sfx('levelup') });
        scene.tweens.add({ targets: up, scale: 1.05, duration: 500, yoyo: true, repeat: -1, delay: 1800, ease: 'Sine.easeInOut' });
        this.objs.push(up);
      }
    }
    this.badge = txt(scene, W / 2, 492, '', 10, '#ffd23c', { stroke: '#181818', strokeThickness: 3 }).setOrigin(0.5, 0).setDepth(104);
    this.status = txt(scene, W / 2, 534, 'Practice match. Your rating is saved on this device.', 9, '#a8b8f8').setOrigin(0.5, 0).setDepth(102);
    this.objs.push(this.badge, this.status);

    this.button('CONTINUE', W / 2 - 110, 556, 220, () => o.onContinue());

    audio.bgm(won ? 'victory' : 'defeat');
    audio.sfx(won ? 'win' : 'lose');
  }

  /** Shown right after a win while the trophy mint is in flight. */
  setClaiming() { this.badge.setText('CLAIMING YOUR TROPHY TOKEN...').setColor('#a8b8f8'); }

  /** Badge tokens minted to the player's wallet because of this battle. */
  setBadges(names: string[]) {
    if (!names.length) { this.badge.setText(''); return; }
    const trophies = names.filter((n) => n.endsWith('Trophy'));
    const rest = names.filter((n) => !n.endsWith('Trophy'));
    const parts: string[] = [];
    if (trophies.length) parts.push(`CAPTURED ${trophies.map((n) => n.replace(' Trophy', '')).join(', ')}`);
    if (rest.length) parts.push(`BADGE ${rest.join(', ')}`);
    this.badge.setText(`${parts.join('\n').toUpperCase()}`).setLineSpacing(4).setFontSize(10).setColor('#ffd23c');
    this.scene.tweens.add({ targets: this.badge, scale: { from: 0.6, to: 1 }, duration: 320, ease: 'Back.easeOut' });
    audio.sfx('levelup');
  }

  /** P7 hook: shows the "Saved to Solana" proof line once the rating is committed. */
  setSaved(text: string, color = '#58d858') { this.status.setText(text).setColor(color); }

  private button(label: string, x: number, y: number, w: number, cb: () => void) {
    const h = 56;
    const g = this.scene.add.graphics().setDepth(102);
    const draw = (hover: boolean) => { g.clear(); drawFrame(g, x, y, w, h, { fill: hover ? C.gray : C.grayDark, border: C.white, borderW: 3 }); };
    draw(false);
    const t = txt(this.scene, x + w / 2, y + h / 2, label, 13, '#ffffff').setOrigin(0.5).setDepth(103);
    const z = this.scene.add.zone(x + w / 2, y + h / 2, w, h).setDepth(104).setInteractive({ useHandCursor: true });
    z.on('pointerover', () => draw(true)); z.on('pointerout', () => draw(false));
    z.on('pointerdown', () => { audio.sfx('menu_select'); cb(); });
    this.objs.push(g, t, z);
    const k = () => { audio.sfx('menu_select'); cb(); };
    for (const key of ['ENTER', 'SPACE', 'Z']) { this.scene.input.keyboard?.on(`keydown-${key}`, k); this.keys.push([key, k]); }
  }

  destroy() {
    for (const [k, fn] of this.keys) this.scene.input.keyboard?.off(`keydown-${k}`, fn);
    this.keys = [];
    this.objs.forEach((o) => o.destroy());
    this.objs = [];
  }
}
