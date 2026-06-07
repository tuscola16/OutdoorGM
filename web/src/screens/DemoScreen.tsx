/**
 * Demo / screenshot preview page — hidden from nav, not linked anywhere.
 * Access at /demo  (pick a screen, then ?state=<x> renders it full-bleed for clean
 * App Store / Play Store screenshots). Mock data only; no Firebase connection.
 *
 * Goal: visually match the real React Native screens — same Colors palette, same
 * Ionicons (via react-icons/io5), and metrics copied from each screen's StyleSheet.
 */

import type { CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { IconType } from 'react-icons';
import {
  IoArrowBack, IoChevronForward, IoEllipsisHorizontal, IoPersonCircleOutline,
  IoLogOutOutline, IoRestaurant, IoRestaurantOutline, IoCheckmarkCircle,
  IoLocationOutline, IoLocation, IoNotificationsOutline, IoNotifications,
  IoCameraOutline, IoShieldCheckmark, IoMegaphoneOutline, IoQrCodeOutline,
  IoTimeOutline, IoPeopleOutline, IoMap, IoStatsChart, IoWarning, IoWarningOutline,
  IoFlag, IoScanOutline, IoDocumentTextOutline, IoSettingsOutline, IoSkullOutline,
  IoAlertCircle, IoChatbubbleEllipsesOutline, IoHourglassOutline, IoBookOutline,
  IoEllipseOutline,
} from 'react-icons/io5';

// ─── Palette (exact values from constants/colors.ts) ───────────────────────────

const C = {
  bg: '#0D0D0D',
  surface: '#1A1A1A',
  elevated: '#242424',
  border: '#333333',
  primary: '#D4893F',
  secondary: '#5A7E4E',
  success: '#6B8F5E',
  danger: '#C0392B',
  text: '#F0F0F0',
  textSec: '#999999',
  textMute: '#555555',
  white: '#FFFFFF',
  black: '#000000',
  player: '#4FC3F7',
};

// Append an RN-style hex-alpha suffix (e.g. Colors.primary + '33').
const a = (hex: string, alpha: string) => `${hex}${alpha}`;

// ─── Icons (react-icons/io5 == Ionicons 5, the app's @expo/vector-icons set) ────

const ICONS: Record<string, IconType> = {
  'arrow-back': IoArrowBack,
  'chevron-forward': IoChevronForward,
  'ellipsis-horizontal': IoEllipsisHorizontal,
  'person-circle-outline': IoPersonCircleOutline,
  'log-out-outline': IoLogOutOutline,
  restaurant: IoRestaurant,
  'restaurant-outline': IoRestaurantOutline,
  'checkmark-circle': IoCheckmarkCircle,
  'location-outline': IoLocationOutline,
  location: IoLocation,
  'notifications-outline': IoNotificationsOutline,
  notifications: IoNotifications,
  'camera-outline': IoCameraOutline,
  'shield-checkmark': IoShieldCheckmark,
  'megaphone-outline': IoMegaphoneOutline,
  'qr-code-outline': IoQrCodeOutline,
  'time-outline': IoTimeOutline,
  'people-outline': IoPeopleOutline,
  map: IoMap,
  'stats-chart': IoStatsChart,
  warning: IoWarning,
  'warning-outline': IoWarningOutline,
  flag: IoFlag,
  'scan-outline': IoScanOutline,
  'document-text-outline': IoDocumentTextOutline,
  'settings-outline': IoSettingsOutline,
  'skull-outline': IoSkullOutline,
  'alert-circle': IoAlertCircle,
  'chatbubble-ellipses-outline': IoChatbubbleEllipsesOutline,
  'hourglass-outline': IoHourglassOutline,
  'book-outline': IoBookOutline,
};

function Icon({ name, size = 20, color = C.text, style }: {
  name: string; size?: number; color?: string; style?: CSSProperties;
}) {
  const Cmp = ICONS[name] ?? IoEllipseOutline;
  return <Cmp size={size} color={color} style={{ flexShrink: 0, ...style }} />;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

type DemoState =
  | 'games'
  | 'gm-setup'
  | 'lobby'
  | 'player-map'
  | 'player-stats'
  | 'player-alert'
  | 'gm-play'
  | 'gm-alerts'
  | 'results';

const STATE_LABELS: Record<DemoState, string> = {
  games: 'My Games',
  'gm-setup': 'GM · Setup',
  lobby: 'Player Lobby',
  'player-map': 'Player · Map',
  'player-stats': 'Player · Stats',
  'player-alert': 'Player · Alert',
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

function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
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
  { id: '1', name: 'Katniss E.', alive: true,  district: '12', x: 188, y: 165, elapsedSec: ELAPSED_SEC },
  { id: '2', name: 'Peeta M.',   alive: true,  district: '12', x: 293, y: 188, elapsedSec: ELAPSED_SEC },
  { id: '3', name: 'Thresh',     alive: true,  district: '11', x: 100, y: 198, elapsedSec: ELAPSED_SEC },
  { id: '4', name: 'Johanna M.', alive: true,  district: '7',  x: 148, y: 238, elapsedSec: ELAPSED_SEC },
  { id: '5', name: 'Glimmer',    alive: true,  district: '1',  x: 278, y: 88,  elapsedSec: ELAPSED_SEC },
  { id: '6', name: 'Finnick O.', alive: false, district: '4',  x: 78,  y: 106, elapsedSec: 3840 },
  { id: '7', name: 'Cato',       alive: false, district: '2',  x: 312, y: 138, elapsedSec: 1560 },
  { id: '8', name: 'Rue',        alive: false, district: '11', x: 172, y: 258, elapsedSec: 5220 },
];

const ME = PLAYERS[0];

// `revealed` flags a checkpoint as visible to players (#48): a named location the GM
// chose to surface. The player map shows only these; the GM map shows them all.
const CHECKPOINTS = [
  { id: 'c1', name: 'Cornucopia',   x: 200, y: 148, color: C.primary,   revealed: false },
  { id: 'c2', name: 'The Lake',     x: 90,  y: 158, color: C.danger,    revealed: false },
  { id: 'c3', name: 'Supply Cache', x: 318, y: 208, color: C.secondary, revealed: true  },
];

const ARRIVALS = [
  { id: 'a1', player: 'Katniss E.', sub: 'reached Cornucopia',          time: '10:22' },
  { id: 'a2', player: 'Glimmer',    sub: 'found a boon at Supply Cache', time: '09:48' },
  { id: 'a3', player: 'Peeta M.',   sub: 'hit a hazard at The Lake',     time: '09:15' },
  { id: 'a4', player: 'Thresh',     sub: 'reached Cornucopia',          time: '08:50' },
  { id: 'a5', player: 'Finnick O.', sub: 'hit a hazard at The Lake',     time: '07:10' },
];

const BROADCASTS = [
  { id: 'b1', message: 'The storm is closing in from the north — head south.', time: '10:18' },
  { id: 'b2', message: '5 tributes remain.', time: '08:30' },
];

// ─── Terrain map SVG (kept — high-quality, no real tiles needed) ───────────────

function MapSVG({ mode }: { mode: 'player' | 'gm' }) {
  const alive = PLAYERS.filter((p) => p.alive);
  const dead = PLAYERS.filter((p) => !p.alive);
  const revealed = CHECKPOINTS.filter((c) => c.revealed);

  return (
    <svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg"
      style={{ width: '100%', height: '100%', display: 'block' }} aria-hidden="true">
      <defs>
        <radialGradient id="lake" cx="50%" cy="45%" r="50%">
          <stop offset="0%" stopColor="#1d2e4a" />
          <stop offset="100%" stopColor="#1a2535" />
        </radialGradient>
      </defs>

      <rect width="400" height="300" fill="#1c2819" />
      <rect x="0" y="0" width="400" height="22" fill="#121c0f" />
      <rect x="0" y="22" width="38" height="256" fill="#121c0f" />
      <rect x="362" y="22" width="38" height="256" fill="#121c0f" />
      <rect x="0" y="278" width="400" height="22" fill="#121c0f" />
      {[18, 62, 108, 155, 202, 250, 298, 345, 390].map((cx, i) => (
        <ellipse key={i} cx={cx} cy={i % 2 === 0 ? 12 : 15} rx={i % 3 === 0 ? 28 : 22} ry={i % 2 === 0 ? 17 : 13} fill="#0d1509" />
      ))}
      <rect x="38" y="22" width="324" height="256" fill="#1f2c1c" rx="2" />
      <ellipse cx="340" cy="55" rx="30" ry="22" fill="#172213" />
      <ellipse cx="55" cy="250" rx="22" ry="18" fill="#172213" />
      <ellipse cx="355" cy="265" rx="25" ry="20" fill="#172213" />
      <ellipse cx="68" cy="65" rx="18" ry="14" fill="#172213" />
      <ellipse cx="90" cy="158" rx="52" ry="38" fill="url(#lake)" />
      <ellipse cx="88" cy="156" rx="40" ry="28" fill="#1d2e4a" opacity="0.55" />
      <line x1="68" y1="147" x2="102" y2="143" stroke="rgba(100,160,220,0.18)" strokeWidth="1.5" />
      <line x1="60" y1="158" x2="98" y2="154" stroke="rgba(100,160,220,0.18)" strokeWidth="1.5" />
      <line x1="70" y1="169" x2="110" y2="165" stroke="rgba(100,160,220,0.13)" strokeWidth="1" />
      <path d="M200 278 C200 258 199 218 200 148" stroke="#25221a" strokeWidth="14" fill="none" strokeLinecap="round" />
      <path d="M200 278 C200 258 199 218 200 148" stroke="#2e2b21" strokeWidth="8" fill="none" strokeLinecap="round" />
      <path d="M200 148 C162 150 128 153 90 158" stroke="#25221a" strokeWidth="11" fill="none" strokeLinecap="round" />
      <path d="M200 148 C162 150 128 153 90 158" stroke="#2e2b21" strokeWidth="6" fill="none" strokeLinecap="round" />
      <path d="M200 148 C248 166 280 188 318 208" stroke="#25221a" strokeWidth="11" fill="none" strokeLinecap="round" />
      <path d="M200 148 C248 166 280 188 318 208" stroke="#2e2b21" strokeWidth="6" fill="none" strokeLinecap="round" />

      {/* Game boundary (orange, like the app's polygon overlay) */}
      <rect x="40" y="22" width="320" height="256" rx="4" fill="rgba(212,137,63,0.06)"
        stroke="rgba(212,137,63,0.5)" strokeWidth="2" />

      {mode === 'gm' && (
        <>
          {dead.map((p) => (
            <g key={p.id}>
              <circle cx={p.x} cy={p.y} r="8" fill="rgba(192,57,43,0.25)" stroke={C.danger} strokeWidth="1.5" />
              <line x1={p.x - 4} y1={p.y - 4} x2={p.x + 4} y2={p.y + 4} stroke={C.danger} strokeWidth="1.5" />
              <line x1={p.x + 4} y1={p.y - 4} x2={p.x - 4} y2={p.y + 4} stroke={C.danger} strokeWidth="1.5" />
            </g>
          ))}
          {/* GM sees every checkpoint: translucent radius + pin */}
          {CHECKPOINTS.map((cp) => (
            <g key={cp.id}>
              <circle cx={cp.x} cy={cp.y} r="22" fill={a(cp.color, '26')} stroke={cp.color} strokeWidth="1.5" />
              <circle cx={cp.x} cy={cp.y + 1} r="8" fill="rgba(0,0,0,0.3)" />
              <circle cx={cp.x} cy={cp.y} r="7" fill={cp.color} stroke={C.white} strokeWidth="2" />
            </g>
          ))}
          {alive.map((p) => {
            const initials = p.name.split(' ').map((w) => w[0]).join('').slice(0, 2);
            return (
              <g key={p.id}>
                <circle cx={p.x} cy={p.y} r="11" fill={C.player} stroke={C.white} strokeWidth="2" />
                <text x={p.x} y={p.y + 3} fontSize="8" fontWeight="800" fill={C.black} textAnchor="middle">{initials}</text>
              </g>
            );
          })}
        </>
      )}

      {/* Player map: own location dot + only the revealed markers (#48) */}
      {mode === 'player' && (
        <>
          {revealed.map((cp) => (
            <g key={cp.id}>
              <circle cx={cp.x} cy={cp.y + 1} r="8" fill="rgba(0,0,0,0.35)" />
              <circle cx={cp.x} cy={cp.y} r="7" fill={C.secondary} stroke={C.white} strokeWidth="2" />
              <text x={cp.x} y={cp.y + 22} fontSize="10" fontWeight="700" fill={C.white}
                textAnchor="middle" style={{ paintOrder: 'stroke', stroke: '#000', strokeWidth: 2 }}>
                {cp.name}
              </text>
            </g>
          ))}
          <circle cx={ME.x} cy={ME.y} r="48" fill="rgba(79,195,247,0.07)" stroke="rgba(79,195,247,0.22)" strokeWidth="1.5" />
          <circle cx={ME.x} cy={ME.y} r="26" fill="rgba(79,195,247,0.16)" />
          <circle cx={ME.x} cy={ME.y} r="9" fill={C.player} stroke={C.white} strokeWidth="2.5" />
          <path d={`M${ME.x},${ME.y - 9} L${ME.x - 5},${ME.y - 21} L${ME.x},${ME.y - 17} L${ME.x + 5},${ME.y - 21} Z`}
            fill={C.player} opacity="0.7" />
        </>
      )}
    </svg>
  );
}

// ─── Shared style primitives (metrics copied from the RN StyleSheets) ──────────

const card: CSSProperties = {
  background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16,
};

function btn(variant: 'primary' | 'secondary' | 'ghost' | 'danger'): CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 50, padding: '14px 24px', borderRadius: 12,
    fontSize: 16, fontWeight: 600, letterSpacing: 0.3, cursor: 'pointer', width: '100%',
    border: variant === 'ghost' ? `1px solid ${C.primary}`
      : variant === 'secondary' ? `1px solid ${C.border}`
        : 'none',
    background: variant === 'primary' ? C.primary
      : variant === 'danger' ? C.danger
        : variant === 'secondary' ? C.elevated
          : 'transparent',
    color: variant === 'ghost' ? C.primary : C.white,
  };
}

const sectionLabel: CSSProperties = {
  fontSize: 12, fontWeight: 700, color: C.textSec, letterSpacing: 1, textTransform: 'uppercase',
};

function PhaseChip({ phase }: { phase: string }) {
  const labels: Record<string, string> = { setup: 'SETUP', lobby: 'LOBBY', play: 'IN PLAY', results: 'RESULTS' };
  return (
    <span style={{
      fontSize: 10, fontWeight: 800, letterSpacing: 1, padding: '1px 6px', borderRadius: 6,
      background: C.elevated, color: C.primary,
    }}>
      {labels[phase] ?? phase.toUpperCase()}
    </span>
  );
}

// ─── Screen: My Games (← app/(app)/games.tsx) ──────────────────────────────────

function GamesListView() {
  const games = [
    { id: 'g1', name: 'Arena 2025',     role: 'gm' as const,     phase: 'play' },
    { id: 'g2', name: 'Finals Day',     role: 'player' as const, phase: 'play' },
    { id: 'g3', name: 'Old Quarry Run', role: 'gm' as const,     phase: 'lobby' },
  ];
  const phaseText: Record<string, string> = {
    setup: '● Setting up', lobby: '● Lobby open', play: '● In play', results: '○ Finished',
  };
  return (
    <div style={{ height: '100%', background: C.bg, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '52px 24px 8px' }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: C.text }}>My Games</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ padding: 4, display: 'flex' }}><Icon name="person-circle-outline" size={26} color={C.textSec} /></span>
          <span style={{ padding: 4, display: 'flex' }}><Icon name="log-out-outline" size={24} color={C.textSec} /></span>
        </div>
      </div>

      <div style={{ flex: 1, padding: '12px 24px', display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
        {games.map((g) => (
          <div key={g.id} style={{ ...card, display: 'flex', alignItems: 'center', padding: 16 }}>
            <span style={{
              fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: C.text,
              borderRadius: 6, padding: '4px 8px', marginRight: 12,
              background: g.role === 'gm' ? a(C.secondary, '33') : a(C.primary, '33'),
            }}>
              {g.role === 'gm' ? 'GM' : 'PLAYER'}
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{g.name}</div>
              <div style={{ fontSize: 13, color: C.textSec, marginTop: 2 }}>{phaseText[g.phase]}</div>
            </div>
            <Icon name={g.role === 'gm' && g.phase !== 'play' ? 'ellipsis-horizontal' : 'chevron-forward'} size={20} color={C.textMute} />
          </div>
        ))}
      </div>

      <div style={{ padding: '12px 24px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button style={btn('secondary')}>Join a Game</button>
        <button style={btn('primary')}>Create a Game (GM)</button>
      </div>
    </div>
  );
}

// ─── Screen: GM Setup (← SetupView in gm/[gameId]/index.tsx) ────────────────────

function ChecklistRow({ icon, title, sub, done }: { icon: string; title: string; sub: string; done: boolean }) {
  return (
    <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{
        width: 42, height: 42, borderRadius: 21, background: C.elevated,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={icon} size={22} color={C.primary} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{title}</div>
        <div style={{ fontSize: 13, color: C.textSec, marginTop: 2 }}>{sub}</div>
      </div>
      <Icon name={done ? 'checkmark-circle' : 'chevron-forward'} size={done ? 22 : 20} color={done ? C.success : C.textMute} />
    </div>
  );
}

function GMSetupView() {
  return (
    <div style={{ height: '100%', background: C.bg, display: 'flex', flexDirection: 'column' }}>
      <GMHeader phase="setup" />
      <div style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
        <p style={{ margin: '0 0 4px', color: C.textSec, fontSize: 14, lineHeight: 1.45 }}>
          Set up your game. When you're ready, open it so players can join.
        </p>
        <ChecklistRow icon="scan-outline" title="Set the boundary" sub="Boundary set — tap to adjust" done />
        <ChecklistRow icon="location-outline" title="Manage checkpoints" sub="3 checkpoints — tap to edit" done />
        <ChecklistRow icon="document-text-outline" title="Rules" sub="Rules written" done />
        <ChecklistRow icon="settings-outline" title="Game settings" sub="3.5h game · tap to adjust" done={false} />
      </div>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button style={btn('primary')}>Open to Players</button>
        <div style={{ textAlign: 'center', color: C.danger, fontSize: 14, fontWeight: 600, padding: 6 }}>Delete game</div>
      </div>
    </div>
  );
}

// ─── Screen: Player lobby (← player/game.tsx lobby + LobbyPermissions.tsx) ──────

function PermissionRow({ icon, label, note, granted }: { icon: string; label: string; note: string; granted: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <Icon name={icon} size={20} color={granted ? C.success : C.primary} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{label}</div>
        {!granted && <div style={{ fontSize: 12, color: C.textSec, marginTop: 2, lineHeight: 1.35 }}>{note}</div>}
      </div>
      {granted ? (
        <Icon name="checkmark-circle" size={22} color={C.success} />
      ) : (
        <span style={{ padding: '8px 16px', borderRadius: 8, background: C.primary, color: C.black, fontSize: 13, fontWeight: 800 }}>
          Allow
        </span>
      )}
    </div>
  );
}

function PlayerLobbyView() {
  return (
    <div style={{ height: '100%', background: C.bg, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, padding: '60px 24px 24px', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        <div style={{ textAlign: 'center', paddingTop: 12 }}>
          <Icon name="hourglass-outline" size={48} color={C.primary} />
          <div style={{ fontSize: 22, fontWeight: 800, color: C.text, marginTop: 10 }}>You're in!</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: C.primary, marginTop: 4 }}>{GAME_NAME}</div>
          <div style={{ fontSize: 15, color: C.textSec, marginTop: 8 }}>Waiting for the GM to start the game…</div>
        </div>

        {/* Permission primer (#16) — matches LobbyPermissions.tsx */}
        <div style={{ ...card, marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ color: C.text, fontSize: 15, fontWeight: 800 }}>Finish setup before kickoff</div>
          <PermissionRow icon="location-outline" label="Location — Allow all the time"
            note="Set Location to “Allow all the time” so you stay on the map when locked." granted={false} />
          <PermissionRow icon="notifications-outline" label="Notifications" note="" granted />
          <PermissionRow icon="camera-outline" label="Camera" note="" granted />
        </div>

        <button style={{ ...btn('ghost'), marginTop: 16 }}>
          <Icon name="book-outline" size={18} color={C.primary} /> How to play
        </button>
      </div>

      <div style={{ padding: '8px 24px 42px' }}>
        <button style={{ ...btn('ghost'), borderColor: C.danger, color: C.danger }}>Leave Game</button>
      </div>
    </div>
  );
}

// ─── Player tab bar (Map / Stats) ──────────────────────────────────────────────

function PlayerTabBar({ active }: { active: 'map' | 'stats' }) {
  const tabs = [
    { key: 'map' as const, label: 'MAP', icon: 'map' },
    { key: 'stats' as const, label: 'STATS', icon: 'stats-chart' },
  ];
  return (
    <div style={{ borderTop: `1px solid ${C.border}`, background: C.surface, display: 'flex', paddingBottom: 28 }}>
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <div key={t.key} style={{
            flex: 1, textAlign: 'center', paddingTop: 10, paddingBottom: 2,
            borderTop: `2px solid ${on ? C.primary : 'transparent'}`,
          }}>
            <Icon name={t.icon} size={22} color={on ? C.primary : C.textSec} />
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, marginTop: 2, color: on ? C.primary : C.textSec }}>
              {t.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Screen: Player — Map tab (← player/game.tsx) ──────────────────────────────

function PlayerMapView() {
  return (
    <div style={{ height: '100%', background: C.bg, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <MapSVG mode="player" />
        {/* Time-left pill (mapTimePill: time-outline + remaining) */}
        <div style={{
          position: 'absolute', top: 56, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.72)', borderRadius: 20, padding: '7px 14px',
          display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap',
        }}>
          <Icon name="time-outline" size={15} color={C.text} />
          <span style={{ color: C.text, fontSize: 15, fontWeight: 800, letterSpacing: 0.5 }}>{fmtDuration(REMAINING_SEC)}</span>
        </div>
      </div>
      <PlayerTabBar active="map" />
    </div>
  );
}

// ─── Screen: Player — Stats tab (← player/game.tsx + RationPanel.tsx) ──────────

function RationCard() {
  const remaining = 390; // 6:30 left in the eat window
  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="restaurant" size={18} color={C.primary} />
        <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Ration check</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: C.textSec, fontVariant: 'tabular-nums' }}>
          eat within {fmtClock(remaining)}
        </span>
      </div>
      <div style={{ color: C.textSec, fontSize: 13, lineHeight: 1.4 }}>
        Photograph your numbered ration card to prove you ate. Miss the window and you starve.
      </div>
      <div style={{
        background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12,
        color: C.textMute, fontSize: 16,
      }}>
        Ration card number (required)
      </div>
      <button style={btn('primary')}>
        <Icon name="camera-outline" size={18} color={C.white} /> Take ration photo
      </button>
    </div>
  );
}

function PlayerStatsView() {
  return (
    <div style={{ height: '100%', background: C.bg, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, padding: '52px 16px 8px', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
        {/* Timer card */}
        <div style={{ ...card, textAlign: 'center' }}>
          <div style={{ ...sectionLabel, marginBottom: 8 }}>TIME REMAINING</div>
          <div style={{ fontSize: 38, fontWeight: 800, color: C.primary, letterSpacing: 1 }}>{fmtDuration(REMAINING_SEC)}</div>
          <div style={{ fontSize: 13, color: C.textSec, marginTop: 6 }}>
            Playing for <strong style={{ color: C.text }}>{fmtShort(ELAPSED_SEC)}</strong>
          </div>
        </div>

        <RationCard />

        {/* Tracking status */}
        <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 10, height: 10, borderRadius: 5, background: C.success, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Location Sharing Active</div>
            <div style={{ fontSize: 12, color: C.textSec, marginTop: 2 }}>Updated 15s ago · GPS</div>
          </div>
        </div>

        {/* Messages */}
        <div>
          <div style={{ ...sectionLabel, marginBottom: 10 }}>MESSAGES</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {BROADCASTS.map((b) => (
              <div key={b.id} style={{ background: C.elevated, borderRadius: 10, padding: '12px 14px', borderLeft: `3px solid ${C.primary}` }}>
                <div style={{ fontSize: 14, color: C.text, lineHeight: 1.4 }}>{b.message}</div>
                <div style={{ fontSize: 11, color: C.textSec, marginTop: 6 }}>{b.time}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pinned safety bar */}
      <div style={{ padding: '8px 16px 4px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button style={btn('danger')}>
          <Icon name="skull-outline" size={18} color={C.white} /> I've been killed
        </button>
        <button style={{ ...btn('ghost'), borderColor: C.border, color: C.text }}>
          <Icon name="warning-outline" size={18} color={C.text} /> SOS — Safety alert
        </button>
      </div>
      <PlayerTabBar active="stats" />
    </div>
  );
}

// ─── Screen: Player — heads-up alert overlay (← AlertOverlay.tsx, #17) ──────────

function PlayerAlertView() {
  return (
    <div style={{ height: '100%', background: C.bg, position: 'relative' }}>
      <PlayerMapView />
      {/* Heads-up modal over the app */}
      <div style={{
        position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.78)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 28px',
      }}>
        <div style={{
          alignSelf: 'stretch', background: C.surface, borderRadius: 20, border: `2px solid ${C.danger}`,
          padding: '28px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
        }}>
          <div style={{
            width: 76, height: 76, borderRadius: 38, background: a(C.danger, '22'), border: `1.5px solid ${C.danger}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="warning" size={40} color={C.danger} />
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: C.danger, textAlign: 'center' }}>Hazard!</div>
          <div style={{ fontSize: 17, color: C.text, textAlign: 'center', lineHeight: 1.4 }}>
            A beast attacks! Defend or flee to the tree line before it reaches you.
          </div>
          <button style={{ ...btn('danger'), color: C.black, fontWeight: 800, marginTop: 8 }}>Got it</button>
        </div>
      </div>
    </div>
  );
}

// ─── GM header + tab bar (← gm/[gameId]/index.tsx) ─────────────────────────────

function GMHeader({ phase = 'play' }: { phase?: 'setup' | 'lobby' | 'play' | 'results' }) {
  // Mirror the real header's conditional icon buttons.
  const icons: { name: string; badge?: number }[] = [];
  if (phase === 'lobby' || phase === 'play') icons.push({ name: 'megaphone-outline' });
  icons.push({ name: 'qr-code-outline' });
  if (phase === 'play') icons.push({ name: 'restaurant-outline', badge: 2 });
  if (phase !== 'results') icons.push({ name: 'time-outline' });
  icons.push({ name: 'people-outline' });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '52px 16px 12px' }}>
      <Icon name="arrow-back" size={24} color={C.text} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {GAME_NAME}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
          <span style={{ fontSize: 11, color: C.secondary, fontWeight: 700, letterSpacing: 1 }}>GAME MASTER</span>
          <PhaseChip phase={phase} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icons.map((ic, i) => (
          <div key={i} style={{ position: 'relative', padding: 4, display: 'flex' }}>
            <Icon name={ic.name} size={22} color={C.text} />
            {ic.badge != null && (
              <span style={{
                position: 'absolute', top: -2, right: -4, minWidth: 16, height: 16, borderRadius: 8,
                background: C.danger, color: C.white, fontSize: 9, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
              }}>{ic.badge}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatsBar({ items }: { items: { label: string; value: string; danger?: boolean }[] }) {
  return (
    <div style={{
      display: 'flex', margin: '0 16px 8px', background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: 12,
    }}>
      {items.map((s, i) => (
        <div key={i} style={{ flex: 1, textAlign: 'center', borderRight: i < items.length - 1 ? `1px solid ${C.border}` : 'none' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: s.danger ? C.danger : C.text }}>{s.value}</div>
          <div style={{ fontSize: 11, color: C.textSec, marginTop: 2 }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

function GMTabBar({ active }: { active: 'map' | 'alerts' }) {
  const tabs = [
    { key: 'map' as const, label: 'Map', icon: 'map' },
    { key: 'alerts' as const, label: 'Alerts', icon: 'notifications' },
  ];
  return (
    <div style={{ margin: '0 16px 8px', display: 'flex', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 4 }}>
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <div key={t.key} style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '8px 0', borderRadius: 8, background: on ? C.elevated : 'transparent',
          }}>
            <Icon name={t.icon} size={18} color={on ? C.primary : C.textSec} />
            <span style={{ color: on ? C.primary : C.textSec, fontWeight: 600, fontSize: 14 }}>{t.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Screen: GM — Map tab (← gm/[gameId]/index.tsx) ────────────────────────────

function GMPlayView() {
  const alive = PLAYERS.filter((p) => p.alive).length;
  return (
    <div style={{ height: '100%', background: C.bg, display: 'flex', flexDirection: 'column' }}>
      <GMHeader phase="play" />
      <StatsBar items={[
        { label: 'Remaining', value: fmtDuration(REMAINING_SEC) },
        { label: 'Alive', value: String(alive) },
        { label: 'Active', value: String(alive) },
        { label: 'Arrivals', value: String(ARRIVALS.length) },
      ]} />
      <GMTabBar active="map" />

      {/* Stale chip */}
      <div style={{
        margin: '0 16px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        background: a(C.danger, '1A'), border: `1px solid ${C.danger}`, borderRadius: 8, padding: '8px 12px',
      }}>
        <Icon name="warning-outline" size={16} color={C.danger} />
        <span style={{ color: C.danger, fontSize: 13, fontWeight: 600 }}>1 player not reporting — tap to check</span>
      </div>

      <div style={{ flex: 1, margin: '0 16px', borderRadius: 12, overflow: 'hidden', border: `1px solid ${C.border}` }}>
        <MapSVG mode="gm" />
      </div>

      <div style={{ padding: '12px 16px 36px', display: 'flex', justifyContent: 'center' }}>
        <div style={{ padding: '10px 24px', borderRadius: 20, border: `1px solid ${C.danger}`, color: C.danger, fontWeight: 600, fontSize: 14 }}>
          End Game
        </div>
      </div>
    </div>
  );
}

// ─── Screen: GM — Alerts tab (← AlertFeed.tsx) ─────────────────────────────────

function GMAlertsFeedView() {
  return (
    <div style={{ height: '100%', background: C.bg, display: 'flex', flexDirection: 'column' }}>
      <GMHeader phase="play" />
      <StatsBar items={[
        { label: 'Remaining', value: fmtDuration(REMAINING_SEC) },
        { label: 'Alive', value: '5' },
        { label: 'Active', value: '5' },
        { label: 'Arrivals', value: String(ARRIVALS.length) },
      ]} />
      <GMTabBar active="alerts" />

      <div style={{ flex: 1, margin: '0 16px', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, overflowY: 'auto' }}>
        {ARRIVALS.map((al) => (
          <div key={al.id} style={{
            display: 'flex', alignItems: 'center', padding: '10px 12px', marginBottom: 6,
            background: C.elevated, borderRadius: 10, borderLeft: `3px solid ${C.primary}`,
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: 16, background: C.surface, marginRight: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Icon name="location" size={18} color={C.primary} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>{al.player}</div>
              <div style={{ color: C.textSec, fontSize: 12, marginTop: 1 }}>{al.sub}</div>
            </div>
            <span style={{ color: C.textMute, fontSize: 11 }}>{al.time}</span>
          </div>
        ))}
      </div>

      <div style={{ padding: '12px 16px 36px', display: 'flex', justifyContent: 'center' }}>
        <div style={{ padding: '10px 24px', borderRadius: 20, border: `1px solid ${C.danger}`, color: C.danger, fontWeight: 600, fontSize: 14 }}>
          End Game
        </div>
      </div>
    </div>
  );
}

// ─── Screen: Results (← gm/[gameId]/index.tsx ResultsView) ─────────────────────

function ResultsView() {
  const startMs = Date.now() - ELAPSED_SEC * 1000;
  return (
    <div style={{ height: '100%', background: C.bg, overflowY: 'auto' }}>
      <div style={{ padding: '60px 24px 40px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ textAlign: 'center' }}>
          <Icon name="flag" size={40} color={C.primary} />
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, color: C.textSec, marginTop: 12 }}>GAME OVER</div>
          <div style={{ fontSize: 44, fontWeight: 800, color: C.text, letterSpacing: 1, marginTop: 6 }}>{fmtDuration(ELAPSED_SEC)}</div>
          <div style={{ fontSize: 13, color: C.textSec, marginTop: 6 }}>total game time</div>
        </div>

        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 8 }}>Players</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {PLAYERS.map((p) => {
              const endMs = p.alive ? Date.now() : startMs + p.elapsedSec * 1000;
              const played = Math.floor((endMs - startMs) / 1000);
              return (
                <div key={p.id} style={{ ...card, padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{
                    fontWeight: 600, fontSize: 15, color: p.alive ? C.text : C.textSec,
                    textDecoration: p.alive ? 'none' : 'line-through',
                  }}>{p.name}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {!p.alive && (
                      <span style={{ fontSize: 10, fontWeight: 800, color: C.danger, border: `1px solid ${C.danger}`, borderRadius: 4, padding: '1px 5px', letterSpacing: 1 }}>OUT</span>
                    )}
                    <span style={{ fontWeight: 700, color: C.primary, fontSize: 15, fontVariant: 'tabular-nums' }}>{fmtShort(Math.max(0, played))}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button style={btn('primary')}>Back to My Games</button>
          <div style={{ textAlign: 'center', color: C.textSec, fontSize: 14, fontWeight: 600, padding: 6 }}>
            Archive game (hide from My Games)
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Demo Screen ──────────────────────────────────────────────────────────

export function DemoScreen() {
  const [params] = useSearchParams();
  const raw = params.get('state');

  const views: Record<DemoState, JSX.Element> = {
    games: <GamesListView />,
    'gm-setup': <GMSetupView />,
    lobby: <PlayerLobbyView />,
    'player-map': <PlayerMapView />,
    'player-stats': <PlayerStatsView />,
    'player-alert': <PlayerAlertView />,
    'gm-play': <GMPlayView />,
    'gm-alerts': <GMAlertsFeedView />,
    results: <ResultsView />,
  };

  const state = raw && raw in views ? (raw as DemoState) : null;

  return (
    <div style={{
      height: '100%', background: C.bg, overflow: 'hidden', position: 'relative',
      fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    }}>
      {state ? views[state] : <DemoPicker />}
    </div>
  );
}

// ─── State picker (shown at /demo with no state param) ─────────────────────────

function DemoPicker() {
  return (
    <div style={{
      height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 32, gap: 28,
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 2, color: C.primary }}>OUTDOOR GM</div>
        <h1 style={{ margin: '8px 0 4px', fontSize: 26, fontWeight: 800, color: C.text }}>Screenshot Preview</h1>
        <p style={{ margin: 0, fontSize: 14, color: C.textSec, maxWidth: 380 }}>
          Pick a screen to preview. The picker is hidden once a screen is open, so screenshots come out clean.
        </p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, width: '100%', maxWidth: 560 }}>
        {(Object.keys(STATE_LABELS) as DemoState[]).map((s) => (
          <a key={s} href={`/demo?state=${s}`} style={{
            ...card, textDecoration: 'none', color: C.text, textAlign: 'center',
            fontWeight: 700, fontSize: 15, padding: '20px 12px', cursor: 'pointer',
          }}>
            {STATE_LABELS[s]}
          </a>
        ))}
      </div>
      <p style={{ margin: 0, fontSize: 12, color: C.textMute }}>
        Tip: append <code style={{ color: C.textSec }}>?state=gm-play</code> to jump straight to a screen.
      </p>
    </div>
  );
}
