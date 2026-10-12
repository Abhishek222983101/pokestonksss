'use client';

import { useCallback, useRef, useState, type KeyboardEvent } from 'react';
import { BROKERMON, getBroker } from '../../lib/brokermon';
import { arrow, formatPrice, usePrices } from '../../lib/market';
import { rules } from '../../lib/rules';
import { audio } from '../game/audio';
import { Portrait } from './Portrait';
import { Button, Panel, StatBar, TYPE_COLOR, TypeChip, TypeDot } from './ui';

const COLS = 4;
const STAT_MAX = 180;
const KIND = { strike: 'Pump', guard: 'Hedge', charge: 'Leverage' } as const;

interface Props {
  /** The remembered broker, if any. */
  initialId: string | null;
  onConfirm: (speciesId: string) => void;
  onBack: () => void;
}

export default function BrokerSelect({ initialId, onConfirm, onBack }: Props) {
  const [activeId, setActiveId] = useState<string>(initialId ?? BROKERMON[0].id);
  const prices = usePrices();
  const tiles = useRef<Record<string, HTMLButtonElement | null>>({});
  const active = getBroker(activeId);
  const champ = rules.roster()[active.num];

  const move = useCallback((id: string) => {
    setActiveId(id);
    audio.sfx('menu_move');
    tiles.current[id]?.focus();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = BROKERMON.findIndex((s) => s.id === activeId);
    let next = i;
    switch (e.key) {
      case 'ArrowRight': next = Math.min(BROKERMON.length - 1, i + 1); break;
      case 'ArrowLeft': next = Math.max(0, i - 1); break;
      case 'ArrowDown': next = Math.min(BROKERMON.length - 1, i + COLS); break;
      case 'ArrowUp': next = Math.max(0, i - COLS); break;
      case 'Home': next = 0; break;
      case 'End': next = BROKERMON.length - 1; break;
      case 'Enter':
        e.preventDefault();
        audio.sfx('menu_select');
        onConfirm(activeId);
        return;
      default: return;
    }
    e.preventDefault();
    if (next !== i) move(BROKERMON[next].id);
  };

  const stats: Array<[string, number, number]> = [
    ['Margin', champ.hp, STAT_MAX],
    ['Pump', champ.atk, 120],
    ['Hedge', champ.def, 120],
    ['Speed', champ.spd, 120],
  ];

  return (
    <section aria-labelledby="select-heading" className="pointer-events-none relative h-full">
      <div className="pointer-events-auto absolute inset-0 overflow-y-auto overscroll-contain pb-28">
        <div className="mx-auto flex min-h-full max-w-[64rem] flex-col gap-2 px-2 pt-[max(0.75rem,env(safe-area-inset-top))] md:grid md:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] md:items-start md:gap-6 md:px-6 md:pt-8 short:md:pt-2">
          <Panel tone="dialog">
            <h1 id="select-heading" className="font-pixel t-12 leading-relaxed text-yellow">
              Choose your BrokerMon
            </h1>
            <p className="mt-2 text-[15px] leading-snug">
              Pick the asset you will fight for. Each has its own type, stats and moves. You can change it any time from the map.
            </p>
            <div
              role="radiogroup"
              aria-label="BrokerMon"
              onKeyDown={onKeyDown}
              className="mt-3 grid grid-cols-4 gap-1 short:mt-1 short:grid-cols-6"
            >
              {BROKERMON.map((s) => {
                const on = s.id === activeId;
                return (
                  <button
                    key={s.id}
                    ref={(el) => {
                      tiles.current[s.id] = el;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={`${s.name}, ${s.ticker}, ${s.typeLabel} type`}
                    tabIndex={on ? 0 : -1}
                    className="tile"
                    style={{ ['--t' as string]: TYPE_COLOR[s.type] }}
                    onClick={() => {
                      if (!on) move(s.id);
                    }}
                  >
                    <Portrait speciesId={s.id} size={64} />
                    <span>{s.ticker}</span>
                    <span className={`tile-price ${prices[s.id].change >= 0 ? 'text-green-deep' : 'text-red-deep'}`}>
                      {formatPrice(prices[s.id].price)} {arrow(prices[s.id].change)}
                    </span>
                  </button>
                );
              })}
            </div>
          </Panel>

          <Panel tone="plate" className="md:sticky md:top-8">
            <div className="flex items-start gap-3">
              <Portrait speciesId={active.id} size={96} title={active.name} />
              <div className="min-w-0 flex-1">
                <h2 className="font-pixel t-14 leading-snug text-navy">{active.name}</h2>
                <p className="font-pixel t-10 mt-1 text-slate">
                  {active.ticker} <span className="text-ink">{formatPrice(prices[active.id].price)}</span>{' '}
                  <span className={prices[active.id].change >= 0 ? 'text-green-deep' : 'text-red-deep'}>
                    {arrow(prices[active.id].change)} {Math.abs(prices[active.id].change).toFixed(2)}%
                  </span>
                </p>
                <div className="mt-1 flex flex-wrap items-center">
                  <TypeChip type={active.type} />
                  <span className="chip chip-plain">{active.sector}</span>
                </div>
              </div>
            </div>
            <p className="mt-2 text-[16px] leading-snug">{active.tagline}</p>

            <Panel tone="well" className="mt-2">
              <h3 className="font-pixel t-8 mb-2 text-slate">Stats</h3>
              <div className="flex flex-col gap-2">
                {stats.map(([label, value, max]) => (
                  <StatBar key={label} label={label} value={value} max={max} />
                ))}
              </div>
            </Panel>

            <h3 className="font-pixel t-8 mt-3 text-slate">Moves</h3>
            <ul className="mt-1 grid gap-1 sm:grid-cols-2">
              {champ.moves.map((m) => (
                <li key={m.slot} className="flex items-center gap-2 text-[15px] leading-tight">
                  {m.kind === 'strike' ? <TypeDot type={m.type} /> : <i className="dot" style={{ ['--chip' as string]: m.kind === 'guard' ? '#6890f0' : '#f8d858' }} aria-hidden="true" />}
                  <span className="min-w-0">
                    <b>{m.name}</b>
                    <br />
                    <span className="text-slate">
                      {m.kind === 'strike' ? `${KIND.strike}, ${m.power} power, ${m.acc}% accuracy` : m.kind === 'guard' ? `${KIND.guard}: block most damage` : `${KIND.charge}: next Pump hits double`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <Panel tone="dialog" className="pointer-events-auto flex w-[min(100%_-_1rem,40rem)] flex-wrap items-center justify-between gap-x-2 py-2!">
          <Button
            variant="quiet"
            small
            onClick={() => {
              audio.sfx('menu_back');
              onBack();
            }}
          >
            {initialId ? 'Back to map' : 'Back'}
          </Button>
          <Button
            onClick={() => {
              audio.sfx('menu_select');
              onConfirm(activeId);
            }}
          >
            Choose {active.name}
          </Button>
        </Panel>
      </div>
    </section>
  );
}
