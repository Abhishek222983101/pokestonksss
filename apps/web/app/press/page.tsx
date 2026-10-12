'use client';

import { Logotype } from '../components/Logotype';
import { Portrait } from '../components/Portrait';
import { BROKERMON } from '../../lib/brokermon';

/**
 * Press kit: the project logo (1080 x 1080) and a banner (1600 x 900), rendered from the game's own pixel
 * wordmark and BrokerMon sprites. scripts/render-media.ts screenshots each frame into docs/media/.
 */
const NAVY = '#183088';
const DEEP = '#0b1030';
const GOLD = '#d8a830';

const sky = {
  background: `radial-gradient(circle at 4% 6%, rgba(255,255,255,.9) 0 2px, transparent 3px),
    radial-gradient(circle at 72% 12%, rgba(255,255,255,.8) 0 2px, transparent 3px),
    radial-gradient(circle at 86% 34%, rgba(255,255,255,.7) 0 2px, transparent 3px),
    radial-gradient(circle at 63% 70%, rgba(255,255,255,.6) 0 2px, transparent 3px),
    linear-gradient(180deg, ${DEEP} 0%, #22186a 55%, #3a2a8a 100%)`,
} as const;

/** Synthwave floor like the battle scene. */
function Floor({ h }: { h: number }) {
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0, height: h,
      background: `repeating-linear-gradient(90deg, rgba(120,90,255,.55) 0 3px, transparent 3px 80px),
        repeating-linear-gradient(0deg, rgba(120,90,255,.55) 0 3px, transparent 3px 40px), #2a1d78`,
      transform: 'perspective(500px) rotateX(55deg)', transformOrigin: 'bottom',
    }} />
  );
}

function Chip({ children, big }: { children: React.ReactNode; big?: boolean }) {
  return (
    <span style={{
      fontFamily: '"Press Start 2P", monospace', fontSize: big ? 22 : 18, color: '#181818', background: '#f8f8d0',
      border: `4px solid ${NAVY}`, boxShadow: `4px 4px 0 ${DEEP}`, padding: big ? '12px 16px' : '10px 14px', whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

function Mon({ id, size, label }: { id: string; size: number; label?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <Portrait speciesId={id} size={size} />
      {label && <span style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 20, color: '#f8f8d0', textShadow: `3px 3px 0 ${DEEP}` }}>{label}</span>}
    </div>
  );
}

export default function PressPage() {
  return (
    <main style={{ background: '#111', padding: 40, display: 'flex', flexDirection: 'column', gap: 40, alignItems: 'flex-start' }}>
      {/* ------------------------------------------------------------------ square logo */}
      <section id="logo" style={{ ...sky, position: 'relative', width: 1080, height: 1080, overflow: 'hidden', border: `12px solid ${GOLD}`, boxSizing: 'border-box' }}>
        <Floor h={300} />
        <div style={{ position: 'absolute', top: 90, left: 80, right: 80 }}><Logotype /></div>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 150, display: 'flex', justifyContent: 'center', alignItems: 'flex-end', gap: 10 }}>
          <Mon id="btc" size={260} />
          <div style={{ marginBottom: 40 }}><Mon id="sol" size={400} /></div>
          <Mon id="doge" size={260} />
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 56, display: 'flex', justifyContent: 'center', gap: 18 }}>
          <Chip>SOLANA</Chip><Chip>MAGICBLOCK</Chip>
        </div>
      </section>

      {/* ------------------------------------------------------------------ banner */}
      <section id="banner" style={{ ...sky, position: 'relative', width: 1600, height: 900, overflow: 'hidden', border: `12px solid ${GOLD}`, boxSizing: 'border-box' }}>
        <Floor h={220} />
        <div style={{ position: 'absolute', top: 70, left: 70, width: 760 }}>
          <Logotype />
          <p style={{ marginTop: 40, fontFamily: '"Press Start 2P", monospace', fontSize: 30, lineHeight: 1.5, color: '#f8f8d0', textShadow: `4px 4px 0 ${DEEP}` }}>
            The rollup is<br />the game server.
          </p>
          <p style={{ marginTop: 18, fontFamily: 'system-ui, sans-serif', fontSize: 28, lineHeight: 1.35, color: '#dfe6ff' }}>
            Beat a BrokerMon, capture its asset. Sealed duels in a Private Ephemeral Rollup.
          </p>
          <div style={{ marginTop: 34, display: 'flex', flexWrap: 'wrap', gap: 14, maxWidth: 760 }}>
            <Chip>EPHEMERAL ROLLUP</Chip><Chip>PRIVATE ER (TEE)</Chip><Chip>VRF</Chip><Chip>ORACLE</Chip><Chip>SESSION KEYS</Chip>
          </div>
        </div>
        <div style={{ position: 'absolute', top: 90, right: 70, display: 'grid', gridTemplateColumns: 'repeat(3, 200px)', gap: 18 }}>
          {BROKERMON.slice(0, 6).map((b) => <Mon key={b.id} id={b.id} size={180} label={`$${b.ticker}`} />)}
        </div>
        <div style={{ position: 'absolute', right: 70, bottom: 48 }}><Chip big>pokestonksss.vercel.app</Chip></div>
      </section>
    </main>
  );
}
