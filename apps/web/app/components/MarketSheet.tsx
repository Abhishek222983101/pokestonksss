'use client';

import { getBroker } from '../../lib/brokermon';
import { arrow, formatPrice } from '../../lib/market';
import { Portrait } from './Portrait';
import { Icon } from './Icon';
import { Button, MoodChip, Panel, TypeChip } from './ui';
import type { RouteFeature } from './useRoutes';

interface Props {
  feature: RouteFeature;
  /** The player's current broker, shown so the choice is visible right where they commit. */
  speciesId: string | null;
  onEnter: () => void;
  onClose: () => void;
  onChangeBroker: () => void;
}

function moodCopy(symbol: string, mood: 'bull' | 'bear' | 'flat'): string {
  if (mood === 'bull') return `${symbol} is trending up. ${symbol} BrokerMon deal 10% more damage while that holds.`;
  if (mood === 'bear') return `${symbol} is sliding. ${symbol} BrokerMon deal 10% less damage while that holds.`;
  return `${symbol} is flat, so it gives no bonus and no drag.`;
}

export default function MarketSheet({ feature, speciesId, onEnter, onClose, onChangeBroker }: Props) {
  const p = feature.properties;
  const sp = getBroker(p.brokerId);
  const mine = speciesId ? getBroker(speciesId) : null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center pb-[max(8px,env(safe-area-inset-bottom))] sm:justify-start sm:pl-4">
      <Panel
        tone="plate"
        role="dialog"
        aria-label={`${p.name}, ${p.city}`}
        className="pointer-events-auto w-[min(100%_-_1rem,30rem)] animate-[sheet-in_360ms_steps(3,end)_both]"
      >
        <div className="flex items-start gap-3">
          <Portrait speciesId={p.brokerId} size={64} title={sp.name} />
          <div className="min-w-0 flex-1">
            <h2 className="font-pixel t-12 leading-snug text-navy">{p.name}</h2>
            <p className="mt-1 text-[15px] text-slate">
              {p.city} · {p.blurb}
            </p>
            <div className="mt-1 flex flex-wrap items-center">
              <TypeChip type={sp.type} />
            </div>
          </div>
          <Button variant="secondary" small icon aria-label="Close route details" onClick={onClose}>
            <Icon name="close" size={14} />
          </Button>
        </div>

        <Panel tone="well" className="mt-2" role="group" aria-label={`${p.symbol} price`}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-pixel t-10 text-slate">{p.symbol}</span>
            <span className="font-pixel t-16 tabular-nums">{formatPrice(p.price)}</span>
            <MoodChip mood={p.mood} />
            <span className="font-pixel t-8 text-slate">
              {arrow(p.pct)} {Math.abs(p.pct).toFixed(2)}%
            </span>
          </div>
          <p className="mt-2 text-[15px] leading-snug">{moodCopy(p.symbol, p.mood)}</p>
          <p className="mt-1 text-[13px] text-slate">Simulated price while offline. Live oracle on devnet.</p>
        </Panel>

        <div className="mt-2 flex items-center gap-3">
          {mine ? (
            <>
              <Portrait speciesId={mine.id} size={32} />
              <p className="min-w-0 flex-1 text-[15px] leading-tight">
                <span className="text-slate">Your broker</span>
                <br />
                <b>{mine.name}</b> <span className="text-slate">({mine.ticker})</span>
              </p>
              <Button variant="secondary" small onClick={onChangeBroker}>
                Change broker
              </Button>
            </>
          ) : (
            <Button variant="secondary" small onClick={onChangeBroker}>
              Pick a broker
            </Button>
          )}
        </div>

        <div className="mt-2 flex justify-end">
          <Button onClick={onEnter} disabled={!mine} className="w-full sm:w-auto">
            Enter route
          </Button>
        </div>
      </Panel>
    </div>
  );
}
