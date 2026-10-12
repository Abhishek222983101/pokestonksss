import type Phaser from 'phaser';
import type { Side } from '../../../lib/rules';
import type { MonPlate } from './plates';

export interface Combatant {
  side: Side;
  ally: boolean;
  speciesId: string;
  name: string;
  typeName: string;
  sprite: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Ellipse;
  plate: MonPlate;
  baseX: number;
  baseY: number;
  baseScale: number;
}
