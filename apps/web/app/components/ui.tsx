import type { ComponentPropsWithRef, ElementType, HTMLAttributes } from 'react';
import { TYPE_NAMES, type TypeId } from '../../lib/rules';

export type Mood = 'bull' | 'bear' | 'flat';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

/* ------------------------------------------------------------------ Panel */

type PanelTone = 'plate' | 'dialog' | 'well';

interface PanelProps extends HTMLAttributes<HTMLElement> {
  tone?: PanelTone;
  /** Drop the inner ring (use for small wells inside a bigger panel). */
  flat?: boolean;
  as?: ElementType;
}

/**
 * The one surface. `plate` = cream/slate (information), `dialog` = navy/gold+white (choices, actions),
 * `well` = recessed cream field inside either. Stepped corners come from CSS box-shadow, not images.
 */
export function Panel({ tone = 'plate', flat, as: Tag = 'div', className, children, ...rest }: PanelProps) {
  return (
    <Tag className={cx('panel', `panel-${tone}`, (flat || tone === 'well') && 'panel-flat', className)} {...rest}>
      {children}
    </Tag>
  );
}

/* ----------------------------------------------------------------- Buttons */

type Variant = 'primary' | 'secondary' | 'quiet';

const variantClass: Record<Variant, string> = {
  primary: '',
  secondary: 'btn-secondary',
  quiet: 'btn-quiet',
};

interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: Variant;
  small?: boolean;
  icon?: boolean;
}

export function Button({ variant = 'primary', small, icon, className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={cx('btn', variantClass[variant], small && 'btn-sm', icon && 'btn-icon', className)} {...rest} />
  );
}

interface LinkButtonProps extends ComponentPropsWithRef<'a'> {
  variant?: Variant;
  small?: boolean;
  icon?: boolean;
}

export function LinkButton({ variant = 'secondary', small, icon, className, ...rest }: LinkButtonProps) {
  return <a className={cx('btn', variantClass[variant], small && 'btn-sm', icon && 'btn-icon', className)} {...rest} />;
}

/* ------------------------------------------------------------------- Chips */

const TYPE_CLASS: Record<TypeId, string> = {
  0: 'chip-speed',
  1: 'chip-armor',
  2: 'chip-arcane',
  3: 'chip-tide',
  4: 'chip-shade',
};

export const TYPE_COLOR: Record<TypeId, string> = {
  0: '#F8D030',
  1: '#B8B8D0',
  2: '#A870F8',
  3: '#6890F0',
  4: '#A07858',
};

const typeLabel = (t: TypeId) => TYPE_NAMES[t][0] + TYPE_NAMES[t].slice(1).toLowerCase();

export const typeChipClass = (t: TypeId) => TYPE_CLASS[t];

export function TypeChip({ type, className }: { type: TypeId; className?: string }) {
  return <span className={cx('chip', TYPE_CLASS[type], className)}>{typeLabel(type)}</span>;
}

export function TypeDot({ type }: { type: TypeId }) {
  return <i className={cx('dot', TYPE_CLASS[type])} aria-hidden="true" />;
}

const MOOD_COPY: Record<Mood, { glyph: string; label: string }> = {
  bull: { glyph: '▲', label: 'Bull' },
  bear: { glyph: '▼', label: 'Bear' },
  flat: { glyph: '■', label: 'Flat' },
};

/** Shape + word + colour, so the mood never rests on colour alone. */
export function MoodChip({ mood, className }: { mood: Mood; className?: string }) {
  const m = MOOD_COPY[mood];
  return (
    <span className={cx('chip', `chip-${mood}`, className)}>
      <span aria-hidden="true">{m.glyph}</span>
      {m.label}
    </span>
  );
}

/* ---------------------------------------------------------------- Stat bar */

export function StatBar({
  label,
  value,
  max,
  color,
  hint,
}: {
  label: string;
  value: number;
  max: number;
  color?: string;
  hint?: string;
}) {
  const pct = Math.max(4, Math.min(100, Math.round((value / max) * 100)));
  return (
    <div className="grid grid-cols-[3.4rem_1fr_2.4rem] items-center gap-2" title={hint}>
      <span className="font-pixel t-8 text-slate">{label}</span>
      <div className="bar" role="presentation">
        <i style={{ width: `${pct}%`, ['--bar' as string]: color }} />
      </div>
      <span className="font-pixel t-8 text-right tabular-nums">{value}</span>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx('spinner', className)} aria-hidden="true" />;
}

export { cx };
