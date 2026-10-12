import * as Phaser from 'phaser';
import type { BattleSnapshot, BattleSource } from '../../../lib/battleSource';
import { brokerByNum } from '../../../lib/brokermon';
import { getRoute } from '../../../lib/routes';
import { evolvedName, stageStars } from '../../../lib/evolution';
import { BADGES, LEVEL_XP, MAX_LEVEL, evolutionStage } from '@pokestonksss/sdk';
import { rules, typeName, type Side, type Slot } from '../../../lib/rules';
import { EventBus } from '../events';
import { audio } from '../audio';
import { CommandMenu, MoveMenu } from '../battle/menu';
import { DialogBox } from '../battle/dialog';
import { MonPlate } from '../battle/plates';
import { EndOverlay } from '../battle/end';
import { playTurn } from '../battle/turns';
import type { Combatant } from '../battle/types';
import { C, H, W, delay, drawFrame, isTouch, tweenP, txt } from '../battle/ui';

export interface BattleInit {
  source: BattleSource;
  routeId: string;
  kind: 'wild' | 'trainer';
  trainerName?: string;
}

type Mode = 'boot' | 'intro' | 'idle' | 'command' | 'moves' | 'locked' | 'playing' | 'ended';

const POS = {
  foe: { x: 704, y: 168, size: 176, plateX: 24, plateY: 28, plateW: 392, plateH: 96, platY: 246 },
  ally: { x: 250, y: 372, size: 232, plateX: 548, plateY: 366, plateW: 392, plateH: 112, platY: 462 },
} as const;

const ME: Side = 0;
const FOE: Side = 1;

/**
 * Live 1v1 battle. This scene never decides an outcome: it sends the player's pick to the BattleSource and
 * plays whatever resolved turns the source publishes. It is a small state machine driven by snapshots, so the
 * same scene works against LocalBattleSource (offline) and the chain-backed source (P7).
 */
/** Share of the current level already earned (0..1) for an XP total. */
function xpPct(xp: number): number {
  let l = 0;
  while (l < LEVEL_XP.length - 1 && xp >= LEVEL_XP[l + 1]) l++;
  return l >= LEVEL_XP.length - 1 ? 1 : (xp - LEVEL_XP[l]) / (LEVEL_XP[l + 1] - LEVEL_XP[l]);
}

export class BattleScene extends Phaser.Scene {
  private src!: BattleSource;
  private init0!: BattleInit;
  private mode: Mode = 'boot';
  private cmb!: Record<Side, Combatant>;
  private dialog!: DialogBox;
  private command?: CommandMenu;
  private moveMenu?: MoveMenu;
  private overlay?: EndOverlay;
  private info: Phaser.GameObjects.GameObject[] = [];
  private timerG!: Phaser.GameObjects.Graphics;
  private timerLabel!: Phaser.GameObjects.Text;
  private foeStatus!: Phaser.GameObjects.Text;
  private idle: Partial<Record<Side, Phaser.Tweens.Tween>> = {};
  private deadline = 0;
  private played = 0;
  private playing = false;
  private endShown = false;
  private moodShown = false;
  private closing = false;

  constructor() { super('Battle'); }

  init(data: BattleInit) {
    this.init0 = data;
    this.src = data.source;
    this.mode = 'boot';
    this.command = undefined; this.moveMenu = undefined; this.overlay = undefined;
    this.info = []; this.idle = {};
    this.deadline = 0; this.played = 0;
    this.playing = false; this.endShown = false; this.moodShown = false; this.closing = false;
  }

  // ─────────────────────────────── build ───────────────────────────────────

  create() {
    audio.bgm('battle');
    this.cameras.main.fadeIn(380, 0, 0, 0);
    const snap = this.src.getSnapshot();

    this.buildBackdrop();
    this.cmb = {
      0: this.buildCombatant(ME, true, snap),
      1: this.buildCombatant(FOE, false, snap),
    };

    this.dialog = new DialogBox(this);
    this.buildTimer();
    this.buildCommandMenu();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    void this.runIntro();
  }

  private buildBackdrop() {
    const theme = getRoute(this.init0.routeId)?.theme ?? 'sol';
    const key = `bg_battle_${theme}`;
    if (this.textures.exists(key)) {
      this.add.image(W / 2, H / 2, key).setDisplaySize(W, H).setDepth(0);
    } else {
      const g = this.add.graphics().setDepth(0);
      g.fillGradientStyle(0x7ec8f4, 0x7ec8f4, 0xd8f0ff, 0xd8f0ff, 1).fillRect(0, 0, W, 300);
      g.fillStyle(0x8fd77a, 1).fillRect(0, 300, W, 340);
    }
    // Slow clouds for depth.
    for (let i = 0; i < 4; i++) {
      const c = this.add.ellipse(Phaser.Math.Between(60, 900), Phaser.Math.Between(30, 200), Phaser.Math.Between(90, 170), Phaser.Math.Between(22, 40), 0xffffff, 0.55).setDepth(1);
      this.tweens.add({ targets: c, x: c.x + 60, duration: 9000 + i * 2500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    for (const [k, p] of [['foe', POS.foe], ['ally', POS.ally]] as const) {
      const tex = [`platform_${k}_${theme}`, `platform_${k}`].find((t) => this.textures.exists(t));
      if (tex) this.add.image(p.x, p.platY, tex).setDepth(2);
      else this.add.ellipse(p.x, p.platY, k === 'foe' ? 260 : 330, k === 'foe' ? 64 : 84, 0x5aa050, 1).setStrokeStyle(4, 0x3f7a3a).setDepth(2);
    }
  }

  private monTexture(brokerId: string, facing: 'front' | 'back'): string {
    const key = `mon_${brokerId}_${facing}`;
    if (this.textures.exists(key)) return key;
    const fb = `fallback_${brokerId}_${facing}`;
    if (!this.textures.exists(fb)) {
      const cv = this.textures.createCanvas(fb, 128, 128)!;
      const ctx = cv.getContext();
      ctx.fillStyle = '#c8c8d8'; ctx.strokeStyle = '#181818'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.ellipse(64, 74, 46, 42, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      cv.refresh();
      this.textures.get(fb).setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    return fb;
  }

  private buildCombatant(side: Side, ally: boolean, snap: BattleSnapshot): Combatant {
    const champ = snap.champions[side];
    const broker = brokerByNum(champ.id);
    const pos = ally ? POS.ally : POS.foe;
    const tex = this.monTexture(broker.id, ally ? 'back' : 'front');
    const sprite = this.add.image(pos.x, pos.y, tex).setDepth(10).setOrigin(0.5);
    const baseScale = pos.size / sprite.width;
    sprite.setScale(baseScale);
    const shadow = this.add.ellipse(pos.x, pos.platY - 10, pos.size * 0.8, pos.size * 0.16, 0x000000, 0.22).setDepth(3);
    const plate = new MonPlate(this, pos.plateX, pos.plateY, pos.plateW, pos.plateH, ally);
    const f = snap.state.fighters[side];
    const level = f.level ?? 0;
    const shownName = evolvedName(champ.id, level);
    plate.setMon({ name: shownName, typeName: typeName(champ.type), hp: f.hp, maxHp: f.maxHp, level: level + 1, stars: stageStars(level) }, broker.ticker, ally ? undefined : this.foeTag());
    this.applyEvolution(sprite, level);
    const c: Combatant = {
      side, ally, speciesId: broker.id, name: shownName, typeName: typeName(champ.type),
      sprite, shadow, plate, baseX: pos.x, baseY: pos.y, baseScale,
    };
    // Start off-screen for the entrance.
    sprite.setX(pos.x + (ally ? -520 : 520)); shadow.setAlpha(0);
    plate.container.setX(pos.plateX + (ally ? 520 : -520));
    return c;
  }

  /** Evolved forms are bigger and glow: stage 1 silver-blue, stage 2 gold. Falls back to a tint on non-WebGL renderers. */
  private applyEvolution(sprite: Phaser.GameObjects.Image, level: number) {
    const stage = level >= 6 ? 2 : level >= 3 ? 1 : 0;
    if (stage === 0) return;
    sprite.setScale(sprite.scaleX * (stage === 2 ? 1.16 : 1.08));
    const color = stage === 2 ? 0xffd23c : 0x78c8ff;
    try {
      const fx = (sprite as unknown as { preFX?: { addGlow: (c: number, o: number, i: number, q: boolean, a: number, d: number) => unknown; setPadding: (n: number) => void } }).preFX;
      if (fx) { fx.setPadding(16); fx.addGlow(color, stage === 2 ? 5 : 3, 0, false, 0.1, 12); return; }
    } catch { /* WebGL FX unavailable */ }
    sprite.setTint(stage === 2 ? 0xfff0b0 : 0xd8ecff);
  }

  private buildTimer() {
    this.timerG = this.add.graphics().setDepth(42);
    this.timerLabel = txt(this, 640, 20, 'TIME', 9, '#ffffff', { stroke: '#181818', strokeThickness: 4 }).setDepth(43).setVisible(false);
    this.foeStatus = txt(this, 936, 46, '', 8, '#ffffff', { stroke: '#181818', strokeThickness: 4 }).setOrigin(1, 0).setDepth(43);
  }

  private buildCommandMenu() {
    this.command = new CommandMenu(this, [
      { id: 'fight', label: 'FIGHT', color: C.red, dark: C.redDark },
      { id: 'stats', label: 'STATS', color: 0xf0c040, dark: 0xa08020, text: '#181818' },
      { id: 'market', label: 'MARKET', color: 0x40b850, dark: C.greenDark },
      { id: 'run', label: 'RUN', color: 0x9a9aa8, dark: C.grayDark },
    ], (id) => this.onCommand(id));
  }

  // ───────────────────────────── intro / entrance ──────────────────────────

  private async runIntro() {
    this.mode = 'intro';
    const me = this.cmb[ME], foe = this.cmb[FOE];
    this.tweens.add({ targets: [foe.plate.container], x: POS.foe.plateX, duration: 520, ease: 'Cubic.easeOut' });
    this.tweens.add({ targets: [me.plate.container], x: POS.ally.plateX, duration: 520, delay: 160, ease: 'Cubic.easeOut' });
    await Promise.all([
      tweenP(this, { targets: foe.sprite, x: foe.baseX, duration: 620, ease: 'Cubic.easeOut' }),
      tweenP(this, { targets: me.sprite, x: me.baseX, duration: 620, delay: 160, ease: 'Cubic.easeOut' }),
    ]);
    this.tweens.add({ targets: [foe.shadow, me.shadow], alpha: 0.22, duration: 240 });
    this.startIdle(foe); this.startIdle(me);

    const { kind, trainerName } = this.init0;
    const snap = this.src.getSnapshot();
    const foeName = foe.name.toUpperCase();
    if (kind === 'trainer') {
      await this.dialog.say(`${(trainerName ?? 'A rival BROKER').toUpperCase()} wants to trade blows!`, { holdMs: 750 });
      await this.dialog.say(`They sent out ${foeName}!`, { holdMs: 650 });
    } else {
      await this.dialog.say(`A wild ${foeName} appeared!`, { holdMs: 750 });
      await this.dialog.say(`${snap.opponent.label} is at the controls.`, { holdMs: 650 });
    }
    await this.dialog.say(`Go! ${me.name.toUpperCase()}!`, { holdMs: 650 });
    for (const line of this.moodLines(snap)) await this.dialog.say(line, { holdMs: 900 });
    this.dialog.clear();
    this.mode = 'idle';
  }

  private moodLines(snap: BattleSnapshot): string[] {
    const out: string[] = [];
    for (const side of [ME, FOE] as const) {
      const t = brokerByNum(snap.champions[side].id);
      const m = snap.mood[side];
      if (m > 0) out.push(`${t.ticker} is trending up. ${t.name.toUpperCase()} hits 10% harder!`);
      else if (m < 0) out.push(`${t.ticker} is sliding. ${t.name.toUpperCase()} hits 10% softer.`);
    }
    return out;
  }

  private startIdle(c: Combatant) {
    this.idle[c.side]?.stop();
    c.sprite.setPosition(c.baseX, c.baseY);
    this.idle[c.side] = this.tweens.add({ targets: c.sprite, y: c.baseY - 6, duration: 1100 + (c.ally ? 0 : 160), yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  private stopIdle() {
    for (const k of [0, 1] as const) {
      this.idle[k]?.stop();
      this.idle[k] = undefined;
      const c = this.cmb[k];
      if (c && c.sprite.visible) c.sprite.setPosition(c.baseX, c.baseY);
    }
  }

  // ───────────────────────────── main loop ─────────────────────────────────

  update() {
    if (this.mode === 'boot' || !this.cmb) return;
    this.poll();
    this.drawTimer();
  }

  private poll() {
    const snap = this.src.getSnapshot();

    if (!this.moodShown && (snap.mood[0] !== 0 || snap.mood[1] !== 0)) {
      this.moodShown = true;
      for (const side of [ME, FOE] as const) this.cmb[side].plate.setMood(snap.mood[side] > 0 ? 1.1 : snap.mood[side] < 0 ? 0.9 : 1, snap.movePct[side]);
    }

    if (this.mode === 'intro' || this.mode === 'ended') return;

    // 1) Play anything the source has resolved, strictly in order.
    if (!this.playing && this.played < snap.turns.length) { void this.playPending(); return; }
    if (this.playing) return;

    // 2) The match ended without a final turn (forfeit).
    if (snap.phase === 'FINISHED') { void this.finish(); return; }

    // 3) Opponent indicator: who we face, whether they already sealed their pick (pressure), or that we are the one waited on.
    const human = !snap.opponent.isBot;
    if (this.mode === 'command' || this.mode === 'moves') {
      if (human && snap.oppLocked) this.foeStatus.setText('OPPONENT LOCKED IN').setColor('#f85858');
      else this.foeStatus.setText(`VS ${snap.opponent.label.toUpperCase()}`).setColor('#f8d858');
    } else if (human && snap.phase === 'RESOLVING' && snap.locked && this.mode !== 'playing') {
      this.foeStatus.setText(snap.oppLocked ? 'BOTH LOCKED. RESOLVING...' : 'LOCKED. WAITING FOR OPPONENT...').setColor(snap.oppLocked ? '#58d858' : '#f8d858');
    } else this.foeStatus.setText('');

    // 4) Open our command window.
    if (this.mode === 'idle' && snap.phase === 'PICKING' && !snap.locked) this.openCommand(snap);
  }

  // ───────────────────────────── command flow ──────────────────────────────

  private openCommand(snap: BattleSnapshot) {
    this.deadline = this.time.now + snap.turnMs;
    this.mode = 'command';
    this.dialog.prompt(`What will\n${this.cmb[ME].name.toUpperCase()} do?`);
    this.command!.show();
  }

  private onCommand(id: string) {
    const snap = this.src.getSnapshot();
    if (this.mode !== 'command') return;
    if (id === 'fight') {
      this.command!.hide();
      this.dialog.clear();
      this.mode = 'moves';
      this.moveMenu?.destroy();
      this.moveMenu = new MoveMenu(
        this, snap.champions[FOE].type,
        (slot) => rules.previewDamage(this.src.getSnapshot().state, ME, slot),
        (slot) => void this.onPickMove(slot),
        () => this.backToCommand(),
      );
      this.moveMenu.show(snap.champions[ME].moves);
    } else if (id === 'stats') this.showStats(snap);
    else if (id === 'market') this.showMarket(snap);
    else if (id === 'run') this.confirmRun();
  }

  private backToCommand() {
    if (this.mode !== 'moves') return;
    this.moveMenu?.hide();
    this.mode = 'command';
    this.dialog.prompt(`What will\n${this.cmb[ME].name.toUpperCase()} do?`);
    this.command!.show();
  }

  private foeTag(): string {
    const o = this.src.getSnapshot().opponent;
    return o.isBot ? 'HOUSE' : o.label.replace(/ .*/, '').toUpperCase();
  }

  private async onPickMove(slot: Slot) {
    if (this.mode !== 'moves') return;
    this.moveMenu?.hide();
    this.mode = 'locked';
    const bot = this.src.getSnapshot().opponent.isBot;
    this.dialog.prompt(bot ? 'Locked in. The House Agent\nis deciding...' : 'Locked in and sealed.\nWaiting for your friend...');
    try {
      await this.src.lock(slot);
    } catch (e) {
      // The pick did not go through (network, rollup hiccup): hand the choice back instead of freezing.
      EventBus.emit('toast', { text: (e as Error).message || 'That move did not go through. Try again.', tone: 'bad' });
      this.mode = 'command';
      this.dialog.prompt(`What will\n${this.cmb[ME].name.toUpperCase()} do?`);
      this.command!.show();
    }
  }

  private confirmRun() {
    this.command!.hide();
    this.dialog.prompt('Close your position and\nforfeit the match?');
    const yn = new CommandMenu(this, [
      { id: 'yes', label: 'YES', color: C.red, dark: C.redDark },
      { id: 'no', label: 'NO', color: 0x9a9aa8, dark: C.grayDark },
    ], (id) => {
      yn.destroy();
      if (id === 'yes') { this.mode = 'locked'; this.dialog.prompt('You bailed out...'); void this.src.leave(); }
      else { this.mode = 'command'; this.dialog.prompt(`What will\n${this.cmb[ME].name.toUpperCase()} do?`); this.command!.show(); }
    });
    yn.show();
  }

  private abortInput() {
    this.command?.hide();
    this.moveMenu?.hide();
    this.closeInfo();
  }

  // ───────────────────────── info panels (STATS / MARKET) ──────────────────

  private closeInfo() { this.info.forEach((o) => o.destroy()); this.info = []; }

  private panel(title: string, rows: string[], colors: string[] = []) {
    this.closeInfo();
    const g = this.add.graphics().setDepth(70);
    drawFrame(g, 150, 110, 660, 330, { fill: C.navyDark, border: C.gold, borderW: 4, inner: C.white });
    const t = txt(this, 480, 138, title, 16, '#f8d858').setOrigin(0.5).setDepth(71);
    const body = rows.map((r, i) => txt(this, 190, 184 + i * 30, r, 11, colors[i] ?? '#ffffff').setDepth(71));
    const hint = txt(this, 480, 412, isTouch() ? 'TAP TO CLOSE' : 'PRESS ANY KEY OR CLICK TO CLOSE', 9, '#a8b8f8').setOrigin(0.5).setDepth(71);
    const zone = this.add.zone(480, 320, W, H).setDepth(72).setInteractive();
    const close = () => { this.closeInfo(); this.input.keyboard?.off('keydown', close); };
    zone.once('pointerdown', close);
    this.time.delayedCall(120, () => this.input.keyboard?.once('keydown', close));
    this.info.push(g, t, ...body, hint, zone);
  }

  private showStats(snap: BattleSnapshot) {
    const rows: string[] = [];
    for (const side of [ME, FOE] as const) {
      const c = snap.champions[side], f = snap.state.fighters[side];
      rows.push(`${side === ME ? 'YOU' : 'FOE'}  ${c.name.toUpperCase()}  ${typeName(c.type)}  MARGIN ${f.hp}/${f.maxHp}`);
      rows.push(`  ATK ${c.atk}  DEF ${c.def}  SPD ${c.spd}${f.charged ? '  LEVERAGED' : ''}`);
    }
    this.panel('BATTLE STATS', rows, ['#f8d858', '#ffffff', '#f88858', '#ffffff']);
  }

  private showMarket(snap: BattleSnapshot) {
    const rows: string[] = [];
    const cols: string[] = [];
    for (const side of [ME, FOE] as const) {
      const b = brokerByNum(snap.champions[side].id);
      const m = snap.mood[side], pct = snap.movePct[side];
      rows.push(`${b.ticker}: ${m > 0 ? 'BULL' : m < 0 ? 'BEAR' : 'FLAT'}  (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% since the bell)`);
      cols.push(m > 0 ? '#58d858' : m < 0 ? '#f85858' : '#ffffff');
      rows.push(`  ${b.name.toUpperCase()} deals ${m > 0 ? '+10%' : m < 0 ? '-10%' : 'normal'} damage`);
      cols.push('#c8c8d8');
    }
    rows.push('');
    rows.push('Price moves since the bell set the mood:');
    rows.push('up buffs a BrokerMon, down drags it.');
    this.panel('MARKET MOOD', rows, cols);
  }

  // ───────────────────────────── timer ─────────────────────────────────────

  private drawTimer() {
    const g = this.timerG;
    g.clear();
    if (this.mode !== 'command' && this.mode !== 'moves') { this.timerLabel.setVisible(false); return; }
    const sn = this.src.getSnapshot();
    // duels share the chain's own deadline so both players see the same clock
    const remainMs = Math.max(0, sn.deadlineMs ? sn.deadlineMs - Date.now() : this.deadline - this.time.now);
    const secs = remainMs / 1000;
    const total = Math.max(1, sn.turnMs / 1000);
    const w = 240, x = 696, y = 22;
    const col = secs > 15 ? 0x58d858 : secs > 5 ? 0xf8d858 : 0xf85858;
    const pulse = secs < 3 ? 0.55 + 0.45 * Math.abs(Math.sin(this.time.now / 110)) : 1;
    g.fillStyle(C.ink, 1).fillRoundedRect(x - 3, y - 3, w + 6, 18, 5);
    g.fillStyle(0x3a3f66, 1).fillRoundedRect(x - 1, y - 1, w + 2, 14, 4);
    g.fillStyle(col, pulse).fillRect(x, y, Math.max(0, Math.round(w * (secs / total))), 12);
    this.timerLabel.setVisible(true).setText(`${Math.ceil(secs)}s`).setPosition(x - 44, y);
    if (remainMs <= 0) {
      // Same rule the chain applies on timeout: a missed pick defaults to HEDGE.
      this.abortInput();
      this.mode = 'locked';
      this.dialog.prompt('Time is up! Hedging by default.');
      audio.sfx('error');
      void this.src.lock(2);
    }
  }

  // ───────────────────────────── turn playback ─────────────────────────────

  private async playPending() {
    if (this.playing) return;
    this.playing = true;
    this.abortInput();
    this.mode = 'playing';
    this.foeStatus.setText('');
    this.dialog.clear();
    try {
      for (;;) {
        const snap = this.src.getSnapshot();
        if (this.played >= snap.turns.length) break;
        const rec = snap.turns[this.played];
        this.stopIdle();
        await playTurn({ scene: this, combatants: this.cmb, champions: snap.champions, movePct: snap.movePct, dialog: this.dialog, picks: rec.picks }, rec.events, rec.state);
        this.played++;
        for (const k of [0, 1] as const) if (this.cmb[k].sprite.visible) this.startIdle(this.cmb[k]);
      }
    } finally {
      this.playing = false;
    }
    if (this.src.getSnapshot().phase === 'FINISHED') { await this.finish(); return; }
    this.dialog.clear();
    this.mode = 'idle';
  }

  // ───────────────────────────── ending ────────────────────────────────────

  private async finish() {
    if (this.endShown) return;
    this.endShown = true;
    this.mode = 'ended';
    this.abortInput();
    this.foeStatus.setText('');
    const snap = this.src.getSnapshot();
    const res = snap.result;
    if (!res) { void this.close(); return; }
    const won = res.winner === ME;
    const forfeit = !snap.turns.some((t) => t.events.some((e) => e.kind === 'ko'));
    EventBus.emit('battle:end', { won, turns: res.turns, ratingBefore: res.ratingBefore, ratingAfter: res.ratingAfter });
    if (forfeit) {
      const loser = this.cmb[res.winner === ME ? FOE : ME];
      if (loser.sprite.visible) await this.dialog.say(won ? 'The opponent gave up!' : 'You gave up...', { holdMs: 800 });
    }
    await delay(this, 250);
    const pr = res.progress;
    const progress = pr && won
      ? {
        name: evolvedName(pr.species, pr.levelAfter), fromName: evolvedName(pr.species, pr.levelBefore),
        levelBefore: pr.levelBefore + 1, levelAfter: pr.levelAfter + 1, xpGain: pr.xpAfter - pr.xpBefore,
        evolved: evolutionStage(pr.levelAfter) > evolutionStage(pr.levelBefore),
        pctBefore: xpPct(pr.xpBefore), pctAfter: xpPct(pr.xpAfter), maxed: pr.levelAfter >= MAX_LEVEL,
      }
      : undefined;
    this.overlay = new EndOverlay(this, {
      won, turns: res.turns, forfeit, foeLabel: snap.opponent.label,
      ratingBefore: res.ratingBefore, ratingAfter: res.ratingAfter, progress, privateDuel: snap.kind === 'private',
      onContinue: () => void this.close(),
    });
    if (snap.onChain) {
      if (won && snap.kind !== 'private') this.overlay.setClaiming();
      this.overlay.setSaved(snap.kind === 'private' ? 'Result settled in the Private ER. Committing to Solana…' : 'Result written on Solana. Saving your rating…', '#f8d858');
      let tries = 0, saved = false, badgesShown = false;
      const poll = this.time.addEvent({ delay: 600, loop: true, callback: () => {
        const r = this.src.getSnapshot().result;
        if (r?.signature && !saved) { saved = true; this.overlay?.setSaved(snap.kind === 'private' ? 'Committed to Solana from the Private ER ✓  Open "Proof"' : 'Saved to Solana ✓  Open "Proof" to verify every transaction', '#58d858'); }
        if (r?.badges?.length && !badgesShown) { badgesShown = true; this.overlay?.setBadges(r.badges.map((id) => BADGES[id]?.name ?? `Badge ${id}`)); }
        if (!saved && tries === 12 && snap.kind !== 'private') this.overlay?.setSaved('Rating is live on the rollup (saved to Solana in batches)', '#58d858');
        if (++tries > 36 || (saved && (badgesShown || tries > 18))) { if (!badgesShown) this.overlay?.setBadges([]); poll.remove(); }
      } });
    }
  }

  private async close() {
    if (this.closing) return;
    this.closing = true;
    audio.lowHp(false);
    await this.src.leave();
    this.cameras.main.fadeOut(260, 0, 0, 0);
    await delay(this, 280);
    this.scene.stop('Battle');
    EventBus.emit('battle:closed');
  }

  private cleanup() {
    this.command?.destroy(); this.moveMenu?.destroy(); this.overlay?.destroy(); this.closeInfo();
    this.dialog?.destroy();
    for (const k of [0, 1] as const) { this.idle[k]?.stop(); this.cmb?.[k]?.plate.destroy(); }
    audio.lowHp(false);
  }
}
