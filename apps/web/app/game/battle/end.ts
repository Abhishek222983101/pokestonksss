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
  onContinue: () => void;
}

/** Result card: outcome, rating change and rank. No claim step: the rating is the reward. */
export class EndOverlay {
  private objs: Phaser.GameObjects.GameObject[] = [];
  private status!: Phaser.GameObjects.Text;
  private keys: Array<[string, () => void]> = [];

  constructor(private scene: Phaser.Scene, private o: EndOptions) {
    const { won } = o;
    const dim = scene.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.72).setDepth(100).setAlpha(0);
    scene.tweens.add({ targets: dim, alpha: 0.72, duration: 300 });
    const panel = scene.add.graphics().setDepth(101);
    drawFrame(panel, W / 2 - 330, 110, 660, 410, { fill: C.navy, border: won ? C.gold : C.grayDark, borderW: 5, inner: C.white });
    const title = txt(scene, W / 2, 172, won ? 'YOU WIN!' : 'LIQUIDATED', won ? 38 : 34, won ? '#ffd23c' : '#f85858', { stroke: '#181818', strokeThickness: 8 }).setOrigin(0.5).setDepth(102);
    scene.tweens.add({ targets: title, scale: { from: 0.2, to: 1 }, duration: 320, ease: 'Back.easeOut' });
    if (won) scene.tweens.add({ targets: title, scale: 1.06, duration: 520, yoyo: true, repeat: -1, delay: 320, ease: 'Sine.easeInOut' });

    const sub = o.forfeit
      ? (won ? 'The opponent forfeited.' : 'You closed your position early.')
      : (won ? `${o.foeLabel} ran out of margin.` : 'Your margin hit zero.');
    const s1 = txt(scene, W / 2, 230, sub, 12, '#ffffff').setOrigin(0.5).setDepth(102);
    const s2 = txt(scene, W / 2, 258, `${o.turns} turn${o.turns === 1 ? '' : 's'} vs ${o.foeLabel}`, 10, '#a8b8f8').setOrigin(0.5).setDepth(102);
    this.objs.push(dim, panel, title, s1, s2);

    // rating card
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

    this.status = txt(scene, W / 2, 428, 'Practice match. Your rating is saved on this device.', 9, '#a8b8f8').setOrigin(0.5, 0).setDepth(102);
    this.objs.push(this.status);

    this.button('CONTINUE', W / 2 - 110, 452, 220, () => o.onContinue());

    audio.bgm(won ? 'victory' : 'defeat');
    audio.sfx(won ? 'win' : 'lose');
  }

  /** P7 hook: shows the "Saved to Solana" proof line once the rating is committed. */
  setSaved(text: string) { this.status.setText(text).setColor('#58d858'); }

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
