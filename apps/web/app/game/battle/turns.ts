import * as Phaser from 'phaser';
import { typeName, type Champion, type MatchState, type Side, type TurnEvent } from '../../../lib/rules';
import { audio } from '../audio';
import type { DialogBox } from './dialog';
import type { Combatant } from './types';
import * as fx from './fx';
import { delay } from './ui';

export interface TurnCtx {
  scene: Phaser.Scene;
  combatants: Record<Side, Combatant>;
  champions: [Champion, Champion];
  dialog: DialogBox;
}

const other = (s: Side): Side => (s === 0 ? 1 : 0);

/**
 * Plays one resolved turn, event by event, awaiting each animation before the next. The event list is the
 * only input (from the BattleSource), so a replayed or chain-delivered turn animates identically.
 */
export async function playTurn(ctx: TurnCtx, events: TurnEvent[], after: MatchState): Promise<void> {
  for (const ev of events) await playEvent(ctx, ev);
  // snap plates to the authoritative state (also covers any event we did not animate)
  for (const s of [0, 1] as const) {
    void ctx.combatants[s].plate.setHp(after.fighters[s].hp, false);
    ctx.combatants[s].plate.setFlags(after.fighters[s].charged, after.fighters[s].lastGuard);
  }
}

async function playEvent(ctx: TurnCtx, ev: TurnEvent): Promise<void> {
  const { scene, dialog } = ctx;
  const nm = (s: Side) => ctx.combatants[s].name.toUpperCase();

  if (ev.kind === 'mood') {
    const c = ctx.combatants[ev.side];
    c.plate.setMood(ev.mood > 0 ? 1.1 : 0.9, ev.mood > 0 ? 10 : -10);
    return;
  }

  if (ev.kind === 'guard') {
    const c = ctx.combatants[ev.side];
    await dialog.say(`${nm(ev.side)} hedges its position!`, { holdMs: 300 });
    await fx.shield(scene, c, ev.heal);
    if (ev.heal > 0) {
      await c.plate.setHp(ev.hp[ev.side], true);
      await dialog.say(`+${ev.heal} margin restored.`, { holdMs: 520 });
    } else {
      await dialog.say('Hedged twice in a row: no refill.', { holdMs: 520 });
    }
    c.plate.setFlags(false, true);
    return;
  }

  if (ev.kind === 'charge') {
    const c = ctx.combatants[ev.side];
    await dialog.say(`${nm(ev.side)} piles on leverage!`, { holdMs: 300 });
    await fx.powerUp(scene, c);
    c.plate.setFlags(true, false);
    await dialog.say('Next Pump hits x2. But it is exposed!', { holdMs: 560 });
    return;
  }

  if (ev.kind === 'ko') {
    const c = ctx.combatants[ev.side];
    await fx.faint(scene, c);
    await dialog.say(`${nm(ev.side)} was liquidated!`, { holdMs: 900 });
    return;
  }

  // strike (hit or miss)
  const actor = ctx.combatants[ev.side];
  const target = ctx.combatants[other(ev.side)];
  const move = ctx.champions[ev.side].moves[ev.slot];
  await dialog.say(`${nm(ev.side)} used ${move.name.toUpperCase()}!`, { holdMs: 380 });
  const from = fx.centerOf(actor), to = fx.centerOf(target);
  await Promise.all([fx.castType(scene, typeName(move.type), from, to), delay(scene, 60)]);

  if (ev.kind === 'miss') {
    audio.sfx('miss');
    scene.tweens.add({ targets: target.sprite, x: target.baseX + (target.ally ? -40 : 40), duration: 140, yoyo: true, ease: 'Sine.easeOut' });
    await dialog.say('It missed!', { holdMs: 650 });
    actor.plate.setFlags(false, false);
    return;
  }

  const mult = ev.eff / 100;
  audio.sfx(mult > 1 ? 'hit_super' : mult < 1 ? 'hit_resist' : 'hit');
  fx.shake(scene, mult, ev.crit);
  fx.squash(scene, target);
  fx.damageNumber(scene, to, ev.dmg, ev.crit, mult);
  if (ev.crit) fx.critBurst(scene, to);
  const hp = target.plate.setHp(ev.hp[target.side], true);
  await fx.hitFlash(scene, target.sprite);
  await fx.hitStop(scene, 60);
  await hp;
  actor.plate.setFlags(false, false);
  if (ev.crit) await dialog.say('A critical hit!', { holdMs: 560 });
  if (mult > 1) await dialog.say("It's super effective!", { holdMs: 620 });
  else if (mult < 1) await dialog.say('It was resisted...', { holdMs: 620 });
}
