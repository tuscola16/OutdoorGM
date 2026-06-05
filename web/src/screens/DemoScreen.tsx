/**
 * Demo / screenshot preview page — hidden from nav, not linked anywhere.
 * Access at /demo  (add ?controls=0 or press H to hide the switcher for clean screenshots).
 *
 * Uses entirely mock data; no Firebase connection required.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

// ─── Types ────────────────────────────────────────────────────────────────────

type DemoState =
  | 'games'
  | 'lobby'
  | 'player-map'
  | 'player-stats'
  | 'gm-play'
  | 'gm-alerts'
  | 'results';

const STATE_LABELS: Record<DemoState, string> = {
  games: 'My Games',
  lobby: 'Player Lobby',
  'player-map': 'Player · Map',
  'player-stats': 'Player · Stats',
  'gm-play': 'GM · Map',
  'gm-alerts': 'GM · Alerts',
  results: 'Results',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(sec: number): string {
  if (sec <= 0) return '0:00:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtShort(sec: number): string {
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const GAME_NAME = 'Arena 2025';

const ELAPSED_SEC = 6120;   // 1 h 42 m played
const REMAINING_SEC = 5280; // 1 h 28 m left

const PLAYERS = [
  { id: '1', name: 'Katniss E.',  alive: true,  district: '12', lastFixAgo: 15,   x: 188, y: 165, elapsedSec: ELAPSED_SEC },
  { id: '2', name: 'Peeta M.',    alive: true,  district: '12', lastFixAgo: 45,   x: 293, y: 188, elapsedSec: ELAPSED_SEC },
  { id: '3', name: 'Thresh',      alive: true,  district: '11', lastFixAgo: 30,   x: 100, y: 198, elapsedSec: ELAPSED_SEC },
  { id: '4', name: 'Johanna M.',  alive: true,  district: '7',  lastFixAgo: 120,  x: 148, y: 238, elapsedSec: ELAPSED_SEC },
  { id: '5', name: 'Glimmer',     alive: true,  district: '1',  lastFixAgo: 20,   x: 278, y: 88,  elapsedSec: ELAPSED_SEC },
  { id: '6', name: 'Finnick O.',  alive: false, district: '4',  lastFixAgo: null, x: 78,  y: 106, elapsedSec: 3840 },
  { id: '7', name: 'Cato',        alive: false, district: '2',  lastFixAgo: null, x: 312, y: 138, elapsedSec: 1560 },
  { id: '8', name: 'Rue',         alive: false, district: '11', lastFixAgo: null, x: 172, y: 258, elapsedSec: 5220 },
];

const ME = PLAYERS[0];

const CHECKPOINTS = [
  { id: 'c1', name: 'Cornucopia',    x: 200, y: 148, color: '#d4893f', kind: 'gm-only'  },
  { id: 'c2', name: 'The Lake',      x: 90,  y: 158, color: '#c0392b', kind: 'hazard'   },
  { id: 'c3', name: 'Supply Cache',  x: 318, y: 208, color: '#6b8f5e', kind: 'boon'     },
];

const ARRIVALS = [
  { id: 'a1', player: 'Katniss E.', checkpoint: 'Cornucopia',   time: '10:22', color: '#d4893f', icon: '📍', sub: 'reached Cornucopia' },
  { id: 'a2', player: 'Glimmer',    checkpoint: 'Supply Cache', time: '09:48', color: '#6b8f5e', icon: '✨', sub: 'Boon at Supply Cache' },
  { id: 'a3', player: 'Peeta M.',   checkpoint: 'The Lake',     time: '09:15', color: '#c0392b', icon: '⚠️', sub: 'Hazard at The Lake'   },
  { id: 'a4', player: 'Thresh',     checkpoint: 'Cornucopia',   time: '08:50', color: '#d4893f', icon: '📍', sub: 'reached Cornucopia'  },
  { id: 'a5', player: 'Finnick O.', checkpoint: 'The Lake',     time: '07:10', color: '#c0392b', icon: '⚠️', sub: 'Hazard at The Lake'   },
  { id: 'd1', player: 'Rue',        checkpoint: '',             time: '06:30', color: '#555',    icon: '☠️', sub: 'Eliminated by GM'      },
];

const BROADCASTS = [
  { id: 'b1', message: 'The storm is closing in from the north — head south.', time: '10:18' },
  { id: 'b2', message: '5 tributes remain.',                                    time: '08:30' },
];

// ─── Terrain map SVG ─────────────────────────────────────────────────────────
//
// viewBox 0 0 400 300  — reused at any size, aspect-ratio preserved.
// mode 'player' shows only boundary + own location dot.
// mode 'gm' adds checkpoint markers, all player dots, and death markers.

function MapSVG({ mode }: { mode: 'player' | 'gm' }) {
  const alive = PLAYERS.filter((p) => p.alive);
  const dead  = PLAYERS.filter((p) => !p.alive);

  return (
    <svg
      viewBox="0 0 400 300"
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: '100%', height: '100%', display: 'block' }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="lake" cx="50%" cy="45%" r="50%">
          <stop offset="0%"   stopColor="#1d2e4a"/>
          <stop offset="100%" stopColor="#1a2535"/>
        </radialGradient>
      </defs>

      {/* Base terrain */}
      <rect width="400" height="300" fill="#1c2819"/>

      {/* Dense forest borders */}
      <rect x="0"   y="0"   width="400" height="22"  fill="#121c0f"/>
      <rect x="0"   y="22"  width="38"  height="256" fill="#121c0f"/>
      <rect x="362" y="22"  width="38"  height="256" fill="#121c0f"/>
      <rect x="0"   y="278" width="400" height="22"  fill="#121c0f"/>

      {/* Tree bumps along top edge */}
      {[18, 62, 108, 155, 202, 250, 298, 345, 390].map((cx, i) => (
        <ellipse key={i} cx={cx} cy={i % 2 === 0 ? 12 : 15} rx={i % 3 === 0 ? 28 : 22} ry={i % 2 === 0 ? 17 : 13} fill="#0d1509"/>
      ))}

      {/* Open meadow */}
      <rect x="38" y="22" width="324" height="256" fill="#1f2c1c" rx="2"/>

      {/* Interior tree clusters */}
      <ellipse cx="340" cy="55"  rx="30" ry="22" fill="#172213"/>
      <ellipse cx="55"  cy="250" rx="22" ry="18" fill="#172213"/>
      <ellipse cx="355" cy="265" rx="25" ry="20" fill="#172213"/>
      <ellipse cx="68"  cy="65"  rx="18" ry="14" fill="#172213"/>

      {/* Lake */}
      <ellipse cx="90" cy="158" rx="52" ry="38" fill="url(#lake)"/>
      <ellipse cx="88" cy="156" rx="40" ry="28" fill="#1d2e4a" opacity="0.55"/>
      {/* Shimmer lines */}
      <line x1="68"  y1="147" x2="102" y2="143" stroke="rgba(100,160,220,0.18)" strokeWidth="1.5"/>
      <line x1="60"  y1="158" x2="98"  y2="154" stroke="rgba(100,160,220,0.18)" strokeWidth="1.5"/>
      <line x1="70"  y1="169" x2="110" y2="165" stroke="rgba(100,160,220,0.13)" strokeWidth="1"/>

      {/* Dirt paths */}
      {/* Main north-south path */}
      <path d="M200 278 C200 258 199 218 200 148" stroke="#25221a" strokeWidth="14" fill="none" strokeLinecap="round"/>
      <path d="M200 278 C200 258 199 218 200 148" stroke="#2e2b21" strokeWidth="8"  fill="none" strokeLinecap="round"/>
      {/* Path to lake */}
      <path d="M200 148 C162 150 128 153 90 158" stroke="#25221a" strokeWidth="11" fill="none" strokeLinecap="round"/>
      <path d="M200 148 C162 150 128 153 90 158" stroke="#2e2b21" strokeWidth="6"  fill="none" strokeLinecap="round"/>
      {/* Path to supply cache */}
      <path d="M200 148 C248 166 280 188 318 208" stroke="#25221a" strokeWidth="11" fill="none" strokeLinecap="round"/>
      <path d="M200 148 C248 166 280 188 318 208" stroke="#2e2b21" strokeWidth="6"  fill="none" strokeLinecap="round"/>

      {/* Game boundary (dashed) */}
      <rect x="40" y="22" width="320" height="256" rx="4" fill="none"
            stroke="rgba(255,255,255,0.32)" strokeWidth="1.5" strokeDasharray="10 6"/>

      {/* ── GM-only layers ───────────────────────────────────────── */}

      {mode === 'gm' && (
        <>
          {/* Death markers */}
          {dead.map((p) => (
            <g key={p.id}>
              <circle cx={p.x} cy={p.y} r="8"  fill="rgba(192,57,43,0.25)" stroke="#c0392b" strokeWidth="1.5"/>
              <line   x1={p.x - 4} y1={p.y - 4} x2={p.x + 4} y2={p.y + 4} stroke="#c0392b" strokeWidth="1.5"/>
              <line   x1={p.x + 4} y1={p.y - 4} x2={p.x - 4} y2={p.y + 4} stroke="#c0392b" strokeWidth="1.5"/>
            </g>
          ))}

          {/* Alive player dots */}
          {alive.map((p) => {
            const isMe = p.id === ME.id;
            return (
              <g key={p.id}>
                {isMe && <circle cx={p.x} cy={p.y} r="18" fill="rgba(79,195,247,0.2)"/>}
                <circle cx={p.x}    cy={p.y}    r="7" fill="#4fc3f7" stroke="white" strokeWidth={isMe ? 2.5 : 1.5}/>
              </g>
            );
          })}
        </>
      )}

      {/* ── Checkpoints (GM sees all; player sees none) ──────────── */}

      {mode === 'gm' && CHECKPOINTS.map((cp) => (
        <g key={cp.id}>
          <circle cx={cp.x} cy={cp.y + 1} r="11" fill="rgba(0,0,0,0.3)"/>
          <circle cx={cp.x} cy={cp.y}     r="10" fill={cp.color} stroke="rgba(255,255,255,0.82)" strokeWidth="2"/>
          <circle cx={cp.x} cy={cp.y}     r="4"  fill="rgba(255,255,255,0.7)"/>
        </g>
      ))}

      {/* ── Player-only: own location with accuracy ring ─────────── */}

      {mode === 'player' && (
        <g>
          <circle cx={ME.x} cy={ME.y} r="48" fill="rgba(79,195,247,0.07)" stroke="rgba(79,195,247,0.22)" strokeWidth="1.5"/>
          <circle cx={ME.x} cy={ME.y} r="26" fill="rgba(79,195,247,0.16)"/>
          <circle cx={ME.x} cy={ME.y} r="9"  fill="#4fc3f7" stroke="white" strokeWidth="2.5"/>
          {/* Direction arrow */}
          <path
            d={`M${ME.x},${ME.y - 9} L${ME.x - 5},${ME.y - 21} L${ME.x},${ME.y - 17} L${ME.x + 5},${ME.y - 21} Z`}
            fill="#4fc3f7" opacity="0.7"
          />
        </g>
      )}
    </svg>
  );
}

// ─── Shared primitives ────────────────────────────────────────────────────────

const C = {
  bg:       '#0d0d0d',
  surface:  '#1a1a1a',
  elevated: '#242424',
  border:   '#333',
  primary:  '#d4893f',
  secondary:'#5a7e4e',
  success:  '#6b8f5e',
  danger:   '#c0392b',
  text:     '#f0f0f0',
  textSec:  '#999',
  textMute: '#555',
  player:   '#4fc3f7',
};

const card: React.CSSProperties = {
  background: C.surface, border: `1px solid ${C.border}`,
  borderRadius: 12, padding: 16,
};

const btn = (variant: 'primary' | 'secondary' | 'ghost' | 'danger'): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  border: variant === 'ghost' ? `1px solid ${C.border}`
        : variant === 'danger' ? `1px solid ${C.danger}`
        : 'none',
  borderRadius: 12, padding: '14px 18px',
  fontSize: 15, fontWeight: 700, cursor: 'pointer',
  background: variant === 'primary'   ? C.primary
            : variant === 'secondary' ? C.secondary
            : 'transparent',
  color: variant === 'ghost' ? C.textSec
       : variant === 'danger' ? C.danger
       : '#fff',
  width: '100%',
});

function PhaseChip({ phase }: { phase: string }) {
  const labels: Record<string, string> = {
    setup: 'SETUP', lobby: 'LOBBY', play: 'IN PLAY', results: 'RESULTS',
  };
  return (
    <span style={{
      fontSize: 10, fontWeight: 800, letterSpacing: 1, padding: '2px 7px', borderRadius: 6,
      background: C.elevated, color: C.primary,
    }}>
      {labels[phase] ?? phase.toUpperCase()}
    </span>
  );
}

function RoleBadge({ role }: { role: 'gm' | 'player' }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, letterSpacing: 0.5, padding: '3px 8px', borderRadius: 6,
      background: role === 'gm' ? 'rgba(90,126,78,0.2)' : 'rgba(212,137,63,0.15)',
      color: role === 'gm' ? C.secondary : C.primary,
    }}>
      {role === 'gm' ? 'GM' : 'PLAYER'}
    </span>
  );
}

// ─── Screen: My Games list ────────────────────────────────────────────────────

function GamesListView() {
  const mockGames = [
    { id: 'g1', name: 'Arena 2025',     role: 'gm'     as const, phase: 'play'   },
    { id: 'g2', name: 'Finals Day',     role: 'player' as const, phase: 'play'   },
    { id: 'g3', name: 'Old Quarry Run', role: 'gm'     as const, phase: 'lobby'  },
  ];

  const phaseText: Record<string, { label: string; color: string }> = {
    setup:   { label: '● Setting up',  color: C.textSec },
    lobby:   { label: '● Lobby open',  color: C.primary },
    play:    { label: '● In play',     color: C.primary },
    results: { label: '○ Finished',    color: C.textSec },
  };

  return (
    <div style={{ height: '100%', background: C.bg, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '52px 22px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: C.text }}>My Games</h1>
          <div style={{
            width: 36, height: 36, borderRadius: 18, background: C.elevated,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
          }}>
            👤
          </div>
        </div>

        {/* Segment control */}
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          {['Active (3)', 'Archived (1)'].map((label, i) => (
            <button key={label} style={{
              padding: '7px 16px', borderRadius: 20, border: 'none', cursor: 'pointer',
              background: i === 0 ? C.primary : C.elevated,
              color: i === 0 ? '#fff' : C.textSec,
              fontSize: 13, fontWeight: 700,
            }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Games */}
      <div style={{ flex: 1, padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
        {mockGames.map((g) => {
          const { label, color } = phaseText[g.phase];
          return (
            <div key={g.id} style={{ ...card, display: 'flex', alignItems: 'center', gap: 14 }}>
              <RoleBadge role={g.role}/>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{g.name}</div>
                <div style={{ fontSize: 13, color, marginTop: 2 }}>{label}</div>
              </div>
              <span style={{ color: C.textMute, fontSize: 20 }}>›</span>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ padding: '8px 22px 42px', display: 'flex', flexDirection: 'column', gap: 10, borderTop: `1px solid #1e1e1e` }}>
        <button style={btn('ghost')}>Join a Game</button>
        <button style={btn('primary')}>Create a Game</button>
      </div>
    </div>
  );
}

// ─── Screen: Player lobby ─────────────────────────────────────────────────────

function PlayerLobbyView() {
  return (
    <div style={{ height: '100%', background: C.bg, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, padding: '60px 24px 24px', display: 'flex', flexDirection: 'column', gap: 20, overflowY: 'auto' }}>
        {/* Hero */}
        <div style={{ textAlign: 'center', paddingTop: 12 }}>
          <div style={{ fontSize: 52, marginBottom: 10 }}>⏳</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.text }}>You're in!</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: C.primary, marginTop: 4 }}>{GAME_NAME}</div>
          <div style={{ fontSize: 15, color: C.textSec, marginTop: 8 }}>Waiting for the GM to start the game…</div>
        </div>

        {/* Location readiness */}
        <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 10, height: 10, borderRadius: 5, background: C.success, display: 'block' }}/>
          <span style={{ color: C.text, fontSize: 14, fontWeight: 600 }}>Location ready</span>
          <span style={{ marginLeft: 'auto', color: C.textSec, fontSize: 13 }}>GPS active</span>
        </div>

        {/* Tutorial button */}
        <button style={{ ...btn('ghost'), borderColor: C.primary, color: C.primary }}>
          📖  How to play
        </button>

        {/* Broadcasts placeholder */}
        <div style={{ ...card }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textSec, letterSpacing: 1, marginBottom: 12 }}>BROADCASTS</div>
          <div style={{ color: C.textMute, fontSize: 14, textAlign: 'center', padding: '12px 0' }}>
            No messages yet — the GM will send updates here.
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '8px 24px 42px' }}>
        <button style={{ ...btn('ghost'), borderColor: C.danger, color: C.danger }}>
          Leave Game
        </button>
      </div>
    </div>
  );
}

// ─── Screen: Player in-game — Map tab ─────────────────────────────────────────

function PlayerMapView() {
  return (
    <div style={{ height: '100%', background: C.bg, display: 'flex', flexDirection: 'column' }}>
      {/* Map fills screen */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <MapSVG mode="player"/>

        {/* Time pill (floating) */}
        <div style={{
          position: 'absolute', top: 56, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)',
          borderRadius: 20, paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8,
          display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap',
        }}>
          <span style={{ color: C.primary, fontSize: 13, fontWeight: 700 }}>⏱</span>
          <span style={{ color: C.text, fontSize: 15, fontWeight: 800, letterSpacing: 0.5 }}>
            {fmtShort(ELAPSED_SEC)}
          </span>
        </div>

        {/* North indicator */}
        <div style={{
          position: 'absolute', top: 56, right: 16,
          width: 32, height: 32, borderRadius: 16,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, color: C.text,
        }}>
          N
        </div>
      </div>

      {/* Tab bar */}
      <PlayerTabBar active="map"/>
    </div>
  );
}

// ─── Screen: Player in-game — Stats tab ───────────────────────────────────────

function PlayerStatsView() {
  return (
    <div style={{ height: '100%', background: C.bg, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, padding: '52px 20px 12px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>

        {/* Timer card */}
        <div style={{ ...card, textAlign: 'center' }}>
          <div style={{ fontSize: 12, color: C.textSec, fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>TIME REMAINING</div>
          <div style={{ fontSize: 38, fontWeight: 800, color: C.primary, letterSpacing: 1 }}>
            {fmtDuration(REMAINING_SEC)}
          </div>
          <div style={{ fontSize: 13, color: C.textSec, marginTop: 6 }}>
            Playing for <strong style={{ color: C.text }}>{fmtShort(ELAPSED_SEC)}</strong>
          </div>
        </div>

        {/* Location status */}
        <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 10, height: 10, borderRadius: 5, background: C.success, display: 'block', flexShrink: 0 }}/>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Sharing location</div>
            <div style={{ fontSize: 12, color: C.textSec, marginTop: 2 }}>Updated 15s ago · GPS</div>
          </div>
        </div>

        {/* Broadcast feed */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textSec, letterSpacing: 1, marginBottom: 10 }}>BROADCASTS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {BROADCASTS.map((b) => (
              <div key={b.id} style={{
                background: C.elevated, borderRadius: 10, padding: '12px 14px',
                borderLeft: `3px solid ${C.primary}`,
              }}>
                <div style={{ fontSize: 14, color: C.text, lineHeight: 1.4 }}>{b.message}</div>
                <div style={{ fontSize: 11, color: C.textSec, marginTop: 6 }}>{b.time}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pinned actions */}
      <div style={{ padding: '8px 20px 4px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button style={{ ...btn('danger') }}>I've been killed</button>
        <button style={{ ...btn('ghost'), color: C.text, borderColor: C.border }}>
          🆘  Safety alert
        </button>
      </div>

      <PlayerTabBar active="stats"/>
    </div>
  );
}

function PlayerTabBar({ active }: { active: 'map' | 'stats' }) {
  const tabs = [
    { key: 'map'  as const, label: 'Map',  icon: '🗺️' },
    { key: 'stats'as const, label: 'Stats', icon: '📊' },
  ];
  return (
    <div style={{
      borderTop: `1px solid ${C.border}`, background: C.surface,
      display: 'flex', paddingBottom: 28,
    }}>
      {tabs.map((t) => (
        <div key={t.key} style={{
          flex: 1, textAlign: 'center', paddingTop: 10, paddingBottom: 2,
          borderTop: t.key === active ? `2px solid ${C.primary}` : '2px solid transparent',
        }}>
          <div style={{ fontSize: 22 }}>{t.icon}</div>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 0.5, marginTop: 2,
            color: t.key === active ? C.primary : C.textSec,
          }}>
            {t.label.toUpperCase()}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Screen: GM in-play — Map tab ────────────────────────────────────────────

function GMPlayView() {
  const alive    = PLAYERS.filter((p) =>  p.alive).length;
  const active   = PLAYERS.filter((p) =>  p.alive).length; // all alive have recent fix
  const arrivals = ARRIVALS.length;

  return (
    <div style={{ height: '100%', background: C.bg, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <GMHeader />

      {/* Stats bar */}
      <div style={{
        display: 'flex', gap: 0,
        borderBottom: `1px solid ${C.border}`,
      }}>
        {[
          { label: 'Remaining', value: fmtDuration(REMAINING_SEC), danger: false },
          { label: 'Alive',     value: String(alive),              danger: false },
          { label: 'Active',    value: String(active),             danger: false },
          { label: 'Arrivals',  value: String(arrivals),           danger: false },
        ].map((s, i) => (
          <div key={i} style={{
            flex: 1, textAlign: 'center', padding: '10px 4px',
            borderRight: i < 3 ? `1px solid ${C.border}` : 'none',
          }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: s.danger ? C.danger : C.text }}>{s.value}</div>
            <div style={{ fontSize: 10, color: C.textSec, marginTop: 1 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Stale warning chip */}
      <div style={{
        margin: '10px 16px 0',
        background: 'rgba(192,57,43,0.1)', border: `1px solid ${C.danger}`,
        borderRadius: 8, padding: '8px 12px',
        fontSize: 13, fontWeight: 600, color: C.danger,
      }}>
        ⚠ 1 player not reporting — tap to check
      </div>

      {/* Map area */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', margin: '10px 0 0' }}>
        <MapSVG mode="gm"/>

        {/* Checkpoint legend */}
        <div style={{
          position: 'absolute', bottom: 12, left: 12,
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
          borderRadius: 8, padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          {CHECKPOINTS.map((cp) => (
            <div key={cp.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: cp.color, display: 'block' }}/>
              <span style={{ color: C.text, fontSize: 11 }}>{cp.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* GM tab bar */}
      <GMTabBar active="map"/>

      {/* End game */}
      <div style={{ padding: '6px 16px 36px' }}>
        <button style={btn('danger')}>End Game</button>
      </div>
    </div>
  );
}

// ─── Screen: GM in-play — Alerts tab ─────────────────────────────────────────

function GMAlertsFeedView() {
  const filterKeys = ['All', 'Events', 'Arrivals', 'Safety'] as const;
  type FilterKey = typeof filterKeys[number];
  const [filter, setFilter] = useState<FilterKey>('All');

  return (
    <div style={{ height: '100%', background: C.bg, display: 'flex', flexDirection: 'column' }}>
      <GMHeader/>

      {/* Stats bar */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}` }}>
        {[
          { label: 'Remaining', value: fmtDuration(REMAINING_SEC) },
          { label: 'Alive',     value: '5' },
          { label: 'Active',    value: '5' },
          { label: 'Arrivals',  value: String(ARRIVALS.length) },
        ].map((s, i) => (
          <div key={i} style={{
            flex: 1, textAlign: 'center', padding: '10px 4px',
            borderRight: i < 3 ? `1px solid ${C.border}` : 'none',
          }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{s.value}</div>
            <div style={{ fontSize: 10, color: C.textSec, marginTop: 1 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter chips */}
      <div style={{ padding: '10px 16px 4px', display: 'flex', gap: 6 }}>
        {filterKeys.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '5px 12px', borderRadius: 14, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${filter === f ? C.primary : C.border}`,
              background: filter === f ? C.primary : 'transparent',
              color: filter === f ? '#fff' : C.textSec,
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Notifications list */}
      <div style={{ flex: 1, padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto' }}>
        {ARRIVALS.map((a) => (
          <div key={a.id} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
            background: C.elevated, borderRadius: 10, borderLeft: `3px solid ${a.color}`,
          }}>
            <span style={{ fontSize: 18 }}>{a.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{a.player}</div>
              <div style={{ color: C.textSec, fontSize: 12 }}>{a.sub}</div>
            </div>
            <span style={{ color: C.textMute, fontSize: 11 }}>{a.time}</span>
          </div>
        ))}
      </div>

      <GMTabBar active="alerts"/>

      <div style={{ padding: '6px 16px 36px' }}>
        <button style={btn('danger')}>End Game</button>
      </div>
    </div>
  );
}

function GMHeader() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '52px 16px 12px', borderBottom: `1px solid ${C.border}`,
    }}>
      <span style={{ color: C.textSec, fontSize: 22, cursor: 'pointer' }}>‹</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {GAME_NAME}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <span style={{ fontSize: 11, color: C.secondary, fontWeight: 700, letterSpacing: 0.5 }}>GAME MASTER</span>
          <PhaseChip phase="play"/>
        </div>
      </div>
      {/* Icon buttons */}
      {['📢', '🔑', '🍽'].map((icon, i) => (
        <div key={i} style={{
          width: 36, height: 36, borderRadius: 8, background: C.elevated,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, position: 'relative',
        }}>
          {icon}
          {icon === '🍽' && (
            <span style={{
              position: 'absolute', top: -4, right: -4, width: 16, height: 16,
              borderRadius: 8, background: C.danger, color: '#fff', fontSize: 9,
              fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>2</span>
          )}
        </div>
      ))}
      <div style={{
        height: 36, borderRadius: 8, background: C.elevated, padding: '0 10px',
        display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: C.textSec, fontWeight: 600,
      }}>
        👥 <span>7</span>
      </div>
    </div>
  );
}

function GMTabBar({ active }: { active: 'map' | 'alerts' }) {
  const tabs = [
    { key: 'map'    as const, label: 'Map',    icon: '🗺️' },
    { key: 'alerts' as const, label: 'Alerts', icon: '🔔' },
  ];
  return (
    <div style={{ borderTop: `1px solid ${C.border}`, background: C.surface, display: 'flex' }}>
      {tabs.map((t) => (
        <div key={t.key} style={{
          flex: 1, textAlign: 'center', padding: '10px 0 8px',
          borderTop: t.key === active ? `2px solid ${C.primary}` : '2px solid transparent',
        }}>
          <div style={{ fontSize: 20 }}>{t.icon}</div>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 0.5, marginTop: 2,
            color: t.key === active ? C.primary : C.textSec,
          }}>
            {t.label.toUpperCase()}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Screen: Results ──────────────────────────────────────────────────────────

function ResultsView() {
  const startMs = Date.now() - ELAPSED_SEC * 1000;

  return (
    <div style={{ height: '100%', background: C.bg, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      <div style={{ padding: '60px 24px 40px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Hero */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 54 }}>🏁</div>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, color: C.textSec, marginTop: 16 }}>GAME OVER</div>
          <div style={{ fontSize: 44, fontWeight: 800, color: C.text, letterSpacing: 1, marginTop: 6 }}>
            {fmtDuration(ELAPSED_SEC)}
          </div>
          <div style={{ fontSize: 14, color: C.textSec, marginTop: 6 }}>total game time</div>
        </div>

        {/* Player results */}
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 12 }}>Players</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {PLAYERS.map((p) => {
              const endMs = p.alive ? Date.now() : startMs + p.elapsedSec * 1000;
              const played = Math.floor((endMs - startMs) / 1000);
              return (
                <div key={p.id} style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{
                    fontWeight: 700, fontSize: 15, color: p.alive ? C.text : C.textSec,
                    textDecoration: p.alive ? 'none' : 'line-through',
                  }}>
                    {p.name}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {!p.alive && (
                      <span style={{
                        fontSize: 10, fontWeight: 800, color: C.danger,
                        border: `1px solid ${C.danger}`, borderRadius: 4, padding: '1px 5px',
                      }}>
                        OUT
                      </span>
                    )}
                    <span style={{ fontWeight: 800, color: C.primary, fontSize: 15 }}>
                      {fmtShort(Math.max(0, played))}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button style={btn('ghost')}>Back to My Games</button>
          <button style={btn('secondary')}>Archive game</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Demo Screen ─────────────────────────────────────────────────────────

export function DemoScreen() {
  const [params, setParams] = useSearchParams();
  const state       = (params.get('state') ?? 'gm-play') as DemoState;
  const rawControls = params.get('controls');
  const [hidden, setHidden] = useState(rawControls === '0');

  // Toggle controls with H key
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'h' || e.key === 'H') setHidden((v) => !v);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function go(s: DemoState) {
    setParams({ state: s, ...(hidden ? { controls: '0' } : {}) });
  }

  const views: Record<DemoState, JSX.Element> = {
    games:          <GamesListView/>,
    lobby:          <PlayerLobbyView/>,
    'player-map':   <PlayerMapView/>,
    'player-stats': <PlayerStatsView/>,
    'gm-play':      <GMPlayView/>,
    'gm-alerts':    <GMAlertsFeedView/>,
    results:        <ResultsView/>,
  };

  return (
    <div style={{
      height: '100%', background: C.bg, overflow: 'hidden',
      fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      position: 'relative',
    }}>
      {views[state]}

      {/* Floating state switcher */}
      {!hidden && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(10,10,10,0.9)', backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.12)', borderRadius: 20,
          padding: '10px 14px', display: 'flex', gap: 6, alignItems: 'center',
          zIndex: 9999, boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          flexWrap: 'wrap', maxWidth: 'calc(100vw - 32px)', justifyContent: 'center',
        }}>
          {(Object.keys(STATE_LABELS) as DemoState[]).map((s) => (
            <button
              key={s}
              onClick={() => go(s)}
              style={{
                padding: '6px 12px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: state === s ? C.primary : 'rgba(255,255,255,0.07)',
                color: state === s ? '#fff' : C.textSec,
                fontSize: 12, fontWeight: 600, transition: 'background 0.15s',
              }}
            >
              {STATE_LABELS[s]}
            </button>
          ))}
          <span style={{
            marginLeft: 4, fontSize: 11, color: C.textMute, borderLeft: `1px solid ${C.border}`, paddingLeft: 8,
          }}>
            H to hide
          </span>
        </div>
      )}
    </div>
  );
}
