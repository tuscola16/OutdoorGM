// Pushes the Outdoor GM store listing to Google Play.
//
// Writes en-US title / short description / full description / promo video, the 5 phone
// screenshots, the 512 icon, and the 1024x500 feature graphic. Does NOT touch
// contactEmail, tracks, or any App content declaration — those are separate concerns and
// two of them (content rating, target audience) have no API at all.
//
// STORE_LISTING.md is the source of truth for the copy; it's parsed here rather than
// duplicated, so the doc and the store can't drift.
//
//   SA_KEY=./play-service-account.json node scripts/play-push-listing.js
//
// Re-running is safe for text (it overwrites) but NOT for images: uploads append, so a
// second run leaves 10 screenshots. Use scripts/play-read.js to check counts first, and
// DELETE `.../listings/en-US/{imageType}` to clear a slot before re-uploading.

const fs = require('fs');
const path = require('path');
const { token, api } = require('./play-auth.js');

const PKG = 'com.bagelrun.outdoorgm';
const LANG = 'en-US';
const REPO = path.resolve(__dirname, '..');
const SHOTS = path.join(REPO, 'store-screenshots');
const UPLOAD = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3';

// Store-listing promo video: the player-side capture, since this is the listing for the
// Android app itself. The web GM side is https://youtu.be/977LJcfcu6o.
const VIDEO = 'https://youtu.be/fX3AxKAL0s4';

/** Pull the listing copy out of STORE_LISTING.md so there's one source of truth. */
function copyFromDoc() {
  const md = fs.readFileSync(path.join(REPO, 'STORE_LISTING.md'), 'utf8');
  const full = md.match(/\*\*Description\*\* \(≤4000\):\r?\n```\r?\n([\s\S]*?)\r?\n```/);
  const short = md.match(/\*\*Short description\*\* \(≤80\):\r?\n> (.+)/);
  if (!full || !short) throw new Error('could not parse STORE_LISTING.md — did its headings change?');
  return {
    fullDescription: full[1].replace(/\r/g, '').trim(),
    shortDescription: short[1].trim(),
  };
}

async function uploadImage(tok, editId, imageType, file) {
  const r = await fetch(
    `${UPLOAD}/applications/${PKG}/edits/${editId}/listings/${LANG}/${imageType}?uploadType=media`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${tok}`, 'content-type': 'image/png' },
      body: fs.readFileSync(file),
    }
  );
  const txt = await r.text();
  if (!r.ok) throw new Error(`upload ${imageType} ${path.basename(file)} -> ${r.status}\n${txt.slice(0, 500)}`);
  return JSON.parse(txt).image;
}

(async () => {
  const { fullDescription, shortDescription } = copyFromDoc();
  if (shortDescription.length > 80) throw new Error(`short description ${shortDescription.length} > 80`);
  if (fullDescription.length > 4000) throw new Error(`full description ${fullDescription.length} > 4000`);

  const tok = await token();
  const edit = await api(tok, 'POST', `/applications/${PKG}/edits`);
  console.log('edit', edit.id);

  // listings.update replaces the whole object, so the title has to be sent back or it
  // gets blanked.
  const listing = await api(tok, 'PUT', `/applications/${PKG}/edits/${edit.id}/listings/${LANG}`, {
    language: LANG,
    title: 'Outdoor GM',
    shortDescription,
    fullDescription,
    video: VIDEO,
  });
  console.log(`listing: short=${listing.shortDescription.length} full=${listing.fullDescription.length} video=${listing.video}`);

  // Screenshots display in upload order, which the 01..05 filename prefixes drive.
  for (const f of fs.readdirSync(path.join(SHOTS, 'play-phone')).filter((x) => x.endsWith('.png')).sort()) {
    const img = await uploadImage(tok, edit.id, 'phoneScreenshots', path.join(SHOTS, 'play-phone', f));
    console.log(`  phoneScreenshot ${f} -> ${img.id}`);
  }
  console.log(`  icon -> ${(await uploadImage(tok, edit.id, 'icon', path.join(SHOTS, 'play-icon-512.png'))).id}`);
  console.log(`  featureGraphic -> ${(await uploadImage(tok, edit.id, 'featureGraphic', path.join(SHOTS, 'play-feature-graphic.png'))).id}`);

  const res = await api(tok, 'POST', `/applications/${PKG}/edits/${edit.id}:commit`);
  console.log('\nCOMMITTED:', JSON.stringify(res));
})().catch((e) => {
  console.error('FAILED:\n' + e.message);
  process.exit(1);
});
