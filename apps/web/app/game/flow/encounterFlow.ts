import * as Phaser from 'phaser';
import { LocalBattleSource } from '../../../lib/localBattleSource';
import { brokerByNum, getBroker } from '../../../lib/brokermon';
import type { BattleSource } from '../../../lib/battleSource';
import { EventBus } from '../events';
import { audio } from '../audio';
import { playEncounterIntro, playVersus, clearCutscene } from '../overworld/cutscene';

export type EncounterKind = 'wild' | 'trainer';

export interface EncounterContext {
  /** Route the player is roaming (drives the battle backdrop). */
  routeId: string;
  kind: EncounterKind;
  /** BrokerMon number (0-7) of the opponent. */
  foeNum: number;
  /** Trainer display name for line-of-sight encounters. */
  trainerName?: string;
}

/**
 * Creates the battle for an encounter. Offline this is a LocalBattleSource against the House Agent;
 * P7 swaps this single function for the chain-backed source (start_practice on the Ephemeral Rollup).
 */
export type BattleSourceFactory = (playerNum: number, foeNum: number) => Promise<BattleSource> | BattleSource;
let factory: BattleSourceFactory = (p, f) => new LocalBattleSource(p, f);
export function setBattleSourceFactory(f: BattleSourceFactory) { factory = f; }

let matchActive = false;
/** True while an encounter owns the screen; other triggers must not start a second one. */
export const isMatchActive = () => matchActive;

/** Overworld -> cutscene -> battle -> overworld. Resolves when the battle is over and the overworld may resume. */
export async function runEncounter(scene: Phaser.Scene, ctx: EncounterContext): Promise<void> {
  if (matchActive) return;
  matchActive = true;
  const kb = scene.input.keyboard;
  const prevInput = scene.input.enabled;
  scene.input.enabled = false;
  if (kb) kb.enabled = false;
  let source: BattleSource | null = null;
  try {
    const speciesId = scene.registry.get('speciesId') as string | undefined;
    if (!speciesId) { EventBus.emit('toast', { text: 'Pick a BrokerMon first.', tone: 'bad' }); return; }
    const me = getBroker(speciesId);
    const foe = brokerByNum(ctx.foeNum === me.num ? (ctx.foeNum + 1) % 8 : ctx.foeNum);

    const opening = Promise.resolve(factory(me.num, foe.num)).then((s) => ({ s }), (e: Error) => ({ e }));
    await playEncounterIntro(scene, { kind: ctx.kind });
    const made = await opening;
    if ('e' in made) {
      clearCutscene(scene);
      EventBus.emit('toast', { text: 'The encounter could not start. Try again.', tone: 'bad' });
      return;
    }
    source = made.s;

    await playVersus(
      scene,
      { speciesId: me.id, name: me.name },
      { speciesId: foe.id, name: foe.name, isBot: true },
      { kind: ctx.kind },
    );

    EventBus.emit('battle:start', { foeBrokerId: foe.id });
    const closed = new Promise<void>((res) => { EventBus.once('battle:closed', () => res()); });
    scene.scene.launch('Battle', { source, routeId: ctx.routeId, kind: ctx.kind, trainerName: ctx.trainerName });
    scene.scene.bringToTop('Battle');
    scene.scene.pause();
    await closed;
    scene.scene.resume();
    clearCutscene(scene);
    audio.bgm('overworld');
  } catch (err) {
    console.error('[encounter] failed', err);
    clearCutscene(scene);
    EventBus.emit('toast', { text: 'The encounter could not start. Try again.', tone: 'bad' });
  } finally {
    if (source) await source.leave();
    scene.input.enabled = prevInput;
    if (kb) kb.enabled = true;
    matchActive = false;
  }
}
