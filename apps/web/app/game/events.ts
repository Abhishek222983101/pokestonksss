/**
 * App-wide typed event bus. Deliberately Phaser-free so React components can import it without pulling
 * Phaser into the server bundle. Scenes and React talk through this.
 */
export interface GameEvents {
  /** Player closed the game and wants the globe back. */
  'game:exit': void;
  'battle:start': { foeBrokerId: string };
  'battle:end': { won: boolean; turns: number; ratingBefore: number; ratingAfter: number };
  /** Battle overlay closed, overworld resumes. */
  'battle:closed': void;
  /** Overworld -> HUD: transient text like "Margin topped up!". */
  'toast': { text: string; tone?: 'info' | 'good' | 'bad' };
}

type Handler<T> = (payload: T) => void;

class Bus {
  private map = new Map<string, Set<Handler<never>>>();

  on<K extends keyof GameEvents>(event: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.map.get(event as string);
    if (!set) this.map.set(event as string, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => this.off(event, fn);
  }

  once<K extends keyof GameEvents>(event: K, fn: Handler<GameEvents[K]>): () => void {
    const off = this.on(event, (p) => { off(); fn(p); });
    return off;
  }

  off<K extends keyof GameEvents>(event: K, fn: Handler<GameEvents[K]>): void {
    this.map.get(event as string)?.delete(fn as Handler<never>);
  }

  emit<K extends keyof GameEvents>(event: K, ...args: GameEvents[K] extends void ? [] : [GameEvents[K]]): void {
    this.map.get(event as string)?.forEach((fn) => {
      try { (fn as Handler<unknown>)(args[0]); } catch (e) { console.error(`[EventBus] handler for ${String(event)} threw`, e); }
    });
  }
}

export const EventBus = new Bus();
