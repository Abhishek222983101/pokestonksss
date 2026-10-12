'use client';

import { useEffect, useRef } from 'react';
import { AVATAR_KEYS, drawCharacter } from '../game/art';

/** The standing, front-facing frame of a trainer avatar, drawn from the same procedural sprite sheet as the overworld. */
export function AvatarFace({ avatar, size = 48, className, title }: { avatar: number; size?: number; className?: string; title?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const sheet = drawCharacter(AVATAR_KEYS[avatar] ?? AVATAR_KEYS[0]);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);
    // frame (column 1, row 0) is the standing "down" pose; crop to the upper body
    ctx.drawImage(sheet, 16, 0, 16, 24, 0, 0, c.width, c.height);
  }, [avatar]);
  return <canvas ref={ref} width={size} height={Math.round(size * 1.5)} className={className} style={{ imageRendering: 'pixelated', width: size, height: Math.round(size * 1.5) }} role="img" aria-label={title ?? 'Trainer avatar'} />;
}
