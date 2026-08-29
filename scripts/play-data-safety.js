// Fills Play's Data safety CSV from the declared answers below, writing
// docs/data_safety_filled.csv. Does NOT upload — review the printed summary, then run
// scripts/play-push-data-safety.js to POST it via applications.dataSafety.
//
// Input is the blank template exported from Play Console → App content → Data safety →
// "Export to CSV". Its 782 rows are the full question bank; we only set "Response value".
//
// Answers are grounded in what the code does — see PLAY_SUBMISSION.md §4.
//
//   node scripts/play-data-safety.js

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const IN = path.join(REPO, 'docs/data_safety_export.csv');
const OUT = path.join(REPO, 'docs/data_safety_filled.csv');

const SUPPORT_URL = 'https://outdoor-gm.web.app/support';

// ── The declaration ────────────────────────────────────────────────────────────
//
// collected: always true here (we only list types we actually collect)
// shared:    visible to OTHER USERS counts as sharing under Play's definition, and
//            location / display name / ration photos all reach the game's Game Masters
// required:  true  = users cannot opt out
//            false = "users can choose whether it's collected"
const TYPES = {
  PSL_PRECISE_LOCATION: {
    label: 'Precise location',
    shared: true, required: true,
    collectPurposes: ['PSL_APP_FUNCTIONALITY'],
    sharePurposes: ['PSL_APP_FUNCTIONALITY'],
    why: 'GPS uploaded to games/{id}/locations/{uid}; GMs see it on the live map',
  },
  PSL_NAME: {
    label: 'Name (display name)',
    shared: true, required: true,
    collectPurposes: ['PSL_APP_FUNCTIONALITY'],
    sharePurposes: ['PSL_APP_FUNCTIONALITY'],
    why: 'chosen per game, visible to other participants',
  },
  PSL_EMAIL: {
    label: 'Email address',
    shared: false, required: true,
    collectPurposes: ['PSL_APP_FUNCTIONALITY', 'PSL_ACCOUNT_MANAGEMENT'],
    sharePurposes: [],
    why: 'Firebase Auth account identity',
  },
  PSL_USER_ACCOUNT: {
    label: 'User IDs',
    shared: false, required: true,
    collectPurposes: ['PSL_APP_FUNCTIONALITY', 'PSL_ACCOUNT_MANAGEMENT'],
    sharePurposes: [],
    why: 'Firebase uid stored on every member/location/arrival doc',
  },
  PSL_PHOTOS: {
    label: 'Photos (ration cards)',
    shared: true, required: false,
    collectPurposes: ['PSL_APP_FUNCTIONALITY'],
    sharePurposes: ['PSL_APP_FUNCTIONALITY'],
    why: 'only when the GM enables rations; readable by that game\'s GMs',
  },
  PSL_DEVICE_ID: {
    label: 'Device or other IDs (FCM token)',
    shared: false, required: true,
    collectPurposes: ['PSL_APP_FUNCTIONALITY'],
    sharePurposes: [],
    why: 'push delivery',
  },
  PSL_CRASH_LOGS: {
    label: 'Crash logs',
    shared: false, required: true,
    collectPurposes: ['PSL_APP_FUNCTIONALITY', 'PSL_ANALYTICS'],
    sharePurposes: [],
    why: 'Crashlytics; no in-app opt-out, so declared required',
  },
};

// Top-level answers keyed "QUESTION_ID" or "QUESTION_ID|RESPONSE_ID".
const TOP = {
  PSL_DATA_COLLECTION_COLLECTS_PERSONAL_DATA: 'true',
  PSL_DATA_COLLECTION_ENCRYPTED_IN_TRANSIT: 'true',       // Firebase is TLS throughout
  'PSL_SUPPORTED_ACCOUNT_CREATION_METHODS|PSL_ACM_USER_ID_PASSWORD': 'true',
  'PSL_SUPPORT_DATA_DELETION_BY_USER|DATA_DELETION_YES': 'true',
  PSL_ACCOUNT_DELETION_URL: SUPPORT_URL,
  PSL_DATA_DELETION_URL: SUPPORT_URL,
  // PSL_HAS_OUTSIDE_APP_ACCOUNTS is deliberately left blank. It is listed OPTIONAL in the
  // template, but the API rejects the whole submission with "You cannot answer
  // PSL_HAS_OUTSIDE_APP_ACCOUNTS" if it carries a value — it is gated on answers we don't
  // give (accounts are email/password, created in-app). Same for its follow-ups.
};

// ── CSV round-trip ─────────────────────────────────────────────────────────────

function parse(t) {
  const rows = []; let f = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { f.push(cur); cur = ''; }
    else if (c === '\n') { f.push(cur); rows.push(f); f = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur || f.length) { f.push(cur); rows.push(f); }
  return rows;
}
const esc = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const write = (rows) => rows.map((r) => r.map(esc).join(',')).join('\n') + '\n';

/** Answer for one row, or '' to leave blank. */
function answer(qid, rid) {
  const direct = TOP[rid ? `${qid}|${rid}` : qid];
  if (direct !== undefined) return direct;

  // Which data types are collected at all.
  if (qid.startsWith('PSL_DATA_TYPES_')) return TYPES[rid] ? 'true' : 'false';

  // Per-type usage: PSL_DATA_USAGE_RESPONSES:<TYPE>:<SECTION>
  const m = qid.match(/^PSL_DATA_USAGE_RESPONSES:([^:]+):(.+)$/);
  if (!m) return '';
  const t = TYPES[m[1]];
  if (!t) return '';                       // type not collected — leave its block blank
  switch (m[2]) {
    case 'PSL_DATA_USAGE_COLLECTION_AND_SHARING':
      // Both ticked = "collected and shared". We always collect; shared varies.
      if (rid === 'PSL_DATA_USAGE_ONLY_COLLECTED') return 'true';
      if (rid === 'PSL_DATA_USAGE_ONLY_SHARED') return String(t.shared);
      return '';
    case 'PSL_DATA_USAGE_EPHEMERAL':
      return 'false';                      // everything here is persisted server-side
    case 'DATA_USAGE_USER_CONTROL':
      if (rid === 'PSL_DATA_USAGE_USER_CONTROL_REQUIRED') return String(t.required);
      if (rid === 'PSL_DATA_USAGE_USER_CONTROL_OPTIONAL') return String(!t.required);
      return '';
    case 'DATA_USAGE_COLLECTION_PURPOSE':
      return String(t.collectPurposes.includes(rid));
    case 'DATA_USAGE_SHARING_PURPOSE':
      return String(t.shared && t.sharePurposes.includes(rid));
    default:
      return '';
  }
}

const rows = parse(fs.readFileSync(IN, 'utf8'));
let filled = 0;
for (const r of rows.slice(1)) {
  if (!r[0]) continue;
  const v = answer(r[0], r[1]);
  if (v !== '') { r[2] = v; filled++; }
}
fs.writeFileSync(OUT, write(rows));

console.log(`wrote ${path.relative(REPO, OUT)} — ${filled} of ${rows.length - 1} rows answered\n`);
console.log('DECLARED DATA TYPES');
for (const [k, t] of Object.entries(TYPES)) {
  console.log(
    `  ${t.label.padEnd(32)} shared=${String(t.shared).padEnd(5)} ` +
    `${t.required ? 'required' : 'optional'}  collect:[${t.collectPurposes.map((p) => p.replace('PSL_', '')).join(',')}]` +
    (t.shared ? ` share:[${t.sharePurposes.map((p) => p.replace('PSL_', '')).join(',')}]` : '')
  );
  console.log(`  ${''.padEnd(32)} ${t.why}`);
}
console.log('\nTOP-LEVEL');
for (const [k, v] of Object.entries(TOP)) console.log(`  ${k.replace('PSL_', '').padEnd(52)} ${v}`);
console.log('\nNOT declared (verify these are genuinely absent):');
console.log('  phone number, address, payment info, contacts, calendar, audio, files,');
console.log('  browsing history, installed apps, in-app search history, messages');
