// Uploads docs/data_safety_filled.csv to Play as the app's Safety Labels declaration.
//
// Generate the CSV first with scripts/play-data-safety.js and review its printed summary —
// this is a policy attestation, not just metadata.
//
// Note there is NO read method for data safety in androidpublisher v3, so the only way to
// confirm afterwards is Play Console → App content → Data safety.
//
//   SA_KEY=./play-service-account.json node scripts/play-push-data-safety.js

const fs = require('fs');
const path = require('path');
const { token } = require('./play-auth.js');

const PKG = 'com.bagelrun.outdoorgm';
const CSV = path.resolve(__dirname, '../docs/data_safety_filled.csv');

(async () => {
  const safetyLabels = fs.readFileSync(CSV, 'utf8');
  const answered = safetyLabels.split('\n').slice(1).filter((l) => {
    const c = l.split(',');
    return c[0] && c[2] && c[2].trim() !== '';
  }).length;
  console.log(`${path.basename(CSV)}: ${(safetyLabels.length / 1024).toFixed(0)}KB, ~${answered} answered rows`);

  const tok = await token();
  const r = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}/dataSafety`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      body: JSON.stringify({ safetyLabels }),
    }
  );
  const txt = await r.text();
  if (!r.ok) throw new Error(`dataSafety -> ${r.status}\n${txt.slice(0, 1500)}`);
  console.log('\nACCEPTED:', txt || '(empty 200 — Play returns no body on success)');
})().catch((e) => {
  console.error('FAILED:\n' + e.message);
  process.exit(1);
});
