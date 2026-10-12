import { ROSTER_DATA } from '@pokestonksss/rules-wasm';
import { evolutionStage } from '@pokestonksss/sdk';

/** Display name of a champion at a level: base name, then its first and second evolution. */
export function evolvedName(champ: number, level: number): string {
  const c = ROSTER_DATA.champions[champ];
  if (!c) return 'BrokerMon';
  const stage = evolutionStage(level);
  return stage === 0 ? c.name : ((c as unknown as { evolutions: string[] }).evolutions[stage - 1] ?? c.name);
}
export const stageStars = (level: number): string => '★'.repeat(evolutionStage(level));
