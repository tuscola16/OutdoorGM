const { token, api } = require('./play-auth.js');
const PKG = 'com.bagelrun.outdoorgm';

(async () => {
  const tok = await token();
  console.log('auth OK — token minted\n');

  const edit = await api(tok, 'POST', `/applications/${PKG}/edits`);
  console.log('edit created:', edit.id);
  try {
    const details = await api(tok, 'GET', `/applications/${PKG}/edits/${edit.id}/details`);
    console.log('\n=== details ===');
    console.log(JSON.stringify(details, null, 1));

    const listings = await api(tok, 'GET', `/applications/${PKG}/edits/${edit.id}/listings`);
    console.log('\n=== listings ===');
    for (const l of listings.listings || []) {
      console.log(` [${l.language}] title=${JSON.stringify(l.title)}`);
      console.log(`   short(${(l.shortDescription||'').length}): ${JSON.stringify((l.shortDescription||'').slice(0,90))}`);
      console.log(`   full (${(l.fullDescription||'').length} chars)`);
      console.log(`   video: ${JSON.stringify(l.video||'')}`);
    }
    if (!listings.listings?.length) console.log(' (none)');

    console.log('\n=== images (en-US) ===');
    for (const t of ['icon','featureGraphic','phoneScreenshots','sevenInchScreenshots','tenInchScreenshots']) {
      const imgs = await api(tok, 'GET', `/applications/${PKG}/edits/${edit.id}/listings/en-US/${t}`);
      console.log(` ${t}: ${(imgs.images||[]).length}`);
    }

    const tracks = await api(tok, 'GET', `/applications/${PKG}/edits/${edit.id}/tracks`);
    console.log('\n=== tracks ===');
    for (const t of tracks.tracks||[]) console.log(` ${t.track}: releases=${(t.releases||[]).length} ${JSON.stringify((t.releases||[]).map(r=>r.status))}`);
  } finally {
    await api(tok, 'DELETE', `/applications/${PKG}/edits/${edit.id}`);
    console.log('\nedit abandoned — nothing written');
  }
})().catch(e => { console.error('FAILED:\n' + e.message); process.exit(1); });
