'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as MapLibreMap } from 'maplibre-gl';
import PixelBlast from './PixelBlast';
import MarketPins from './MarketPins';
import MarketSheet from './MarketSheet';
import { Panel, Spinner, TYPE_COLOR } from './ui';
import { getBroker } from '../../lib/brokermon';
import { arrow, formatPrice } from '../../lib/market';
import { useRouteFeatures } from './useRoutes';
import { useSessionStore } from '../stores/sessionStore';
import { EventBus } from '../game/events';
import { audio } from '../game/audio';

// Phaser only ever loads in the browser, from this Client Component.
const PhaserMount = dynamic(() => import('../game/PhaserMount'), { ssr: false });

const STYLE = 'https://tiles.openfreemap.org/styles/bright';
const GLOBE_CENTER: [number, number] = [14, 24];
/** Space-view field colour, matches the sky-pale page background. */
const FIELD_COLOR = '#94C6FC';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Whole-planet zoom (fills ~72% of the short side) and the zoom that frames North America. */
function cameraViews(el: HTMLElement) {
  const d = Math.min(el.clientWidth || 360, el.clientHeight || 640);
  // globe diameter in px = 512 * 2^zoom / PI
  const planet = clamp(Math.log2((d * 0.72) / 163), 0.4, 2.4);
  return { planet, region: clamp(planet + 0.55, 0.9, 3.2) };
}

type MapLibre = typeof import('maplibre-gl');

/** Pixel-field sizes the title view steps through as the camera pulls into the globe. */
const PULL_PIXEL_SIZES = [4, 6, 8, 12, 16, 24];

export default function Globe() {
  const stage = useSessionStore((s) => s.stage);
  const speciesId = useSessionStore((s) => s.speciesId);
  const playingRouteId = useSessionStore((s) => s.routeId);
  const setStage = useSessionStore((s) => s.setStage);
  const enterRoute = useSessionStore((s) => s.enterRoute);
  const exitRoute = useSessionStore((s) => s.exitRoute);

  const containerRef = useRef<HTMLDivElement>(null);
  const spinning = useRef(false);
  const [engine, setEngine] = useState<{ map: MapLibreMap; lib: MapLibre } | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pinsReady, setPinsReady] = useState(false);
  /** 0 = title field; 1..5 = pixels stepping chunkier; 6 = field fading; 7 = field removed. */
  const [pull, setPull] = useState(0);

  const onGlobe = stage === 'globe';
  const playing = playingRouteId !== null;
  const features = useRouteFeatures();

  /* ---- create the map once (lazy, so the title paints over the pixel field before MapLibre arrives) */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;
    let created: MapLibreMap | null = null;
    let loaded = false;
    const failTimer = setTimeout(() => {
      if (!loaded) setMapFailed(true);
    }, 10_000);

    (async () => {
      try {
        const lib = await import('maplibre-gl');
        if (cancelled) return;
        lib.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
        const view = cameraViews(el);
        const map = new lib.Map({
          container: el,
          style: STYLE,
          center: [-98, 22],
          zoom: view.planet,
          maxPitch: 0,
          dragRotate: false,
          pitchWithRotate: false,
          attributionControl: { compact: true },
        });
        created = map;
        map.touchZoomRotate.disableRotation();
        map.on('style.load', () => map.setProjection({ type: 'globe' }));
        // Title/select: the planet drifts east. Each finished ease starts the next one.
        map.on('moveend', () => {
          if (!spinning.current || map.isMoving()) return;
          const c = map.getCenter();
          map.easeTo({ center: [c.lng + 30, c.lat], duration: 10_000, easing: (t) => t, essential: false });
        });
        map.on('load', () => {
          loaded = true;
          if (!cancelled) setEngine({ map, lib });
        });
        map.on('error', () => {
          if (!loaded) setMapFailed(true);
        });
      } catch {
        if (!cancelled) setMapFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(failTimer);
      spinning.current = false;
      created?.remove();
      setEngine(null);
    };
  }, []);

  /* ---- camera: planet view for title/select, pull in to the region for the globe -------------- */
  useEffect(() => {
    const map = engine?.map;
    const el = containerRef.current;
    if (!map || !el) return;
    const reduced = prefersReducedMotion();
    const view = cameraViews(el);

    if (stage === 'globe') {
      spinning.current = false;
      map.stop();
      map.setMinZoom(0);
      map.easeTo({
        center: GLOBE_CENTER,
        // Portrait phones need a little more of the continent in view so both coasts fit.
        zoom: el.clientWidth < 640 && el.clientHeight >= 500 ? view.region - 0.35 : view.region,
        // Keep markets clear of the wallet HUD: it sits top-right on landscape phones and spans the top on portrait ones.
        padding:
          el.clientHeight < 500
            ? { top: 0, bottom: 0, left: 0, right: Math.round(Math.min(300, el.clientWidth * 0.34)) }
            : el.clientWidth < 640
              ? { top: Math.round(Math.min(150, el.clientHeight * 0.18)), bottom: Math.round(el.clientHeight * 0.14), left: 0, right: 0 }
              : { top: 0, bottom: 90, left: 0, right: 0 },
        duration: reduced ? 0 : 2600,
        easing: easeInOutCubic,
        essential: true,
      });
      const settle = () => {
        map.setMinZoom(Math.max(0, view.planet - 0.15));
        setPinsReady(true);
      };
      if (reduced) {
        settle();
        return;
      }
      map.once('moveend', settle);
      const fallback = setTimeout(settle, 3400);
      return () => {
        clearTimeout(fallback);
        map.off('moveend', settle);
        setPinsReady(false);
      };
    }

    map.setMinZoom(0);
    map.stop();
    spinning.current = !reduced;
    map.easeTo({ zoom: view.planet, duration: reduced ? 0 : 1600, easing: easeInOutCubic, essential: true });
    if (!reduced) {
      // If the ease finished instantly (already at planet view) moveend fires before we listen: kick the drift.
      const kick = setTimeout(() => {
        if (spinning.current && !map.isMoving()) map.easeTo({ center: [map.getCenter().lng + 30, map.getCenter().lat], duration: 10_000, easing: (t) => t });
      }, 1800);
      return () => clearTimeout(kick);
    }
  }, [engine, stage]);

  /* ---- pixel field: steps chunkier while the camera pulls in, then leaves ------------------- */
  useEffect(() => {
    if (stage !== 'globe') return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (prefersReducedMotion()) {
      timers.push(setTimeout(() => setPull(7), 0));
    } else {
      [200, 400, 600, 800, 1000].forEach((ms, i) => timers.push(setTimeout(() => setPull(i + 1), ms)));
      timers.push(setTimeout(() => setPull(6), 1100));
      timers.push(setTimeout(() => setPull(7), 1900));
    }
    return () => {
      timers.forEach(clearTimeout);
      setPull(0);
    };
  }, [stage]);

  const pixelSize = onGlobe ? PULL_PIXEL_SIZES[Math.min(pull, 5)] : PULL_PIXEL_SIZES[0];
  const showField = !onGlobe || pull < 7;
  const fieldFading = onGlobe && pull >= 6;

  /* ---- selection, sheet, entering a route --------------------------------------------------- */
  const selected = onGlobe && !playing ? (features.find((f) => f.id === selectedId) ?? null) : null;

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      audio.sfx('menu_select');
      const map = engine?.map;
      const el = containerRef.current;
      const f = features.find((x) => x.id === id);
      if (!map || !el || !f) return;
      const narrow = el.clientWidth < 640;
      map.flyTo({
        center: f.geometry.coordinates,
        zoom: Math.max(map.getZoom(), 9),
        padding: narrow ? { top: 0, left: 0, right: 0, bottom: Math.round(el.clientHeight * 0.42) } : { top: 0, right: 0, bottom: 0, left: 500 },
        duration: prefersReducedMotion() ? 0 : 1400,
        essential: true,
      });
    },
    [engine, features],
  );

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  const enter = useCallback(() => {
    if (!selected || !speciesId) return;
    audio.sfx('encounter');
    enterRoute(selected.id);
  }, [selected, speciesId, enterRoute]);

  // Stable identity matters: the game remounts if this callback changes.
  const onExit = useCallback(() => {
    exitRoute();
    audio.bgm('title');
  }, [exitRoute]);

  useEffect(() => EventBus.on('game:exit', onExit), [onExit]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-sky-pale">
      {showField && (
        <div
          className="absolute inset-0"
          style={{ opacity: fieldFading ? 0 : 1, transition: 'opacity 800ms steps(8, end)' }}
          aria-hidden="true"
        >
          <PixelBlast
            variant="square"
            pixelSize={pixelSize}
            color={FIELD_COLOR}
            patternScale={2.25}
            patternDensity={0.35}
            pixelSizeJitter={0}
            enableRipples
            rippleSpeed={0.4}
            rippleThickness={0.12}
            rippleIntensityScale={1.5}
            liquid
            liquidStrength={0.12}
            liquidRadius={1.2}
            liquidWobbleSpeed={5}
            speed={1}
            edgeFade={0}
            transparent
          />
        </div>
      )}

      <div
        ref={containerRef}
        // Inline on purpose: maplibre-gl.css sets `.maplibregl-map { position: relative }`, which beats a
        // Tailwind `absolute inset-0` class and collapses the map to its 300px default height.
        style={{ position: 'absolute', inset: 0, pointerEvents: onGlobe && !playing ? 'auto' : 'none' }}
      />

      {engine && onGlobe && (
        <MarketPins
          map={engine.map}
          lib={engine.lib}
          markets={features}
          selectedId={selected?.id ?? null}
          onSelect={select}
          reveal={pinsReady}
        />
      )}


      {onGlobe && !playing && !selected && pinsReady && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <Panel tone="dialog" className="pointer-events-auto w-[min(100%_-_1rem,46rem)] py-1.5! short:hidden!" aria-label="Routes">
            <p className="font-pixel t-8 mb-1 text-yellow">Pick a route</p>
            <ul className="grid grid-cols-4 gap-x-1 gap-y-1 sm:grid-cols-8">
              {features.map((f) => {
                const b = getBroker(f.properties.brokerId);
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      className="flex min-h-[44px] w-full flex-col items-center gap-0.5 py-1 text-cream hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
                      aria-label={`${f.properties.name}, ${f.properties.symbol}, ${f.properties.city}`}
                      onClick={() => select(f.id)}
                    >
                      <span className="flex items-center gap-1">
                        <i className="dot" style={{ ['--chip' as string]: TYPE_COLOR[b.type] }} aria-hidden="true" />
                        <span className="font-pixel t-8">{f.properties.symbol}</span>
                      </span>
                      <span className={`font-pixel text-[7px] ${f.properties.pct >= 0 ? 'text-green' : 'text-red'}`}>
                        {formatPrice(f.properties.price)} {arrow(f.properties.pct)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      )}

      {onGlobe && !playing && !engine && !mapFailed && (
        <div className="pointer-events-none absolute inset-x-0 top-20 z-30 flex justify-center">
          <Panel tone="plate" role="status" className="flex items-center gap-3 py-2!">
            <Spinner className="text-navy" />
            <span className="font-pixel t-8">Loading the map</span>
          </Panel>
        </div>
      )}

      {onGlobe && !playing && mapFailed && !engine && (
        <div className="absolute inset-x-0 top-16 z-30 flex justify-center px-2">
          <Panel tone="dialog" className="max-h-[60dvh] w-[min(100%_-_1rem,26rem)] overflow-y-auto">
            <h2 className="font-pixel t-12 text-yellow">Pick a route</h2>
            <p className="mt-2 text-[15px]">The map could not load, so here are the routes as a list. Check your connection and reload to see the globe.</p>
            <ul className="mt-2">
              {features.map((f) => (
                <li key={f.id}>
                  <button type="button" className="menu-item" onClick={() => setSelectedId(f.id)}>
                    <span>
                      {f.properties.symbol}
                      <small>
                        {f.properties.name}, {f.properties.city}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      {selected && (
        <MarketSheet
          key={selected.id}
          feature={selected}
          speciesId={speciesId}
          onEnter={enter}
          onClose={() => setSelectedId(null)}
          onChangeBroker={() => setStage('select')}
        />
      )}

      {playingRouteId !== null && speciesId && (
        <PhaserMount routeId={playingRouteId} speciesId={speciesId} onExit={onExit} />
      )}
    </div>
  );
}
