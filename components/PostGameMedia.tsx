import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Linking, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { Colors } from '@/constants/colors';
import { normalizeYoutubeUrl, normalizePhotosUrl } from '@/common/mediaLinks';
import type { Game } from '@/types';

/**
 * Post-game media (#45): outbound Watch/View links shown on the results screen, plus an
 * optional GM editor (two host-validated URL fields). The same component renders for players
 * (display only) and the GM (display + edit), driven by `editable` + `onSave`.
 */
export function PostGameMedia({
  media,
  editable = false,
  onSave,
}: {
  media: Game['media'] | null | undefined;
  editable?: boolean;
  onSave?: (media: { youtubeUrl?: string; photosAlbumUrl?: string } | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [yt, setYt] = useState(media?.youtubeUrl ?? '');
  const [ph, setPh] = useState(media?.photosAlbumUrl ?? '');
  const [busy, setBusy] = useState(false);

  const hasVideo = !!media?.youtubeUrl;
  const hasAlbum = !!media?.photosAlbumUrl;
  const hasAny = hasVideo || hasAlbum;

  function open(url?: string) {
    if (url) Linking.openURL(url).catch(() => Alert.alert('Could not open link', url));
  }

  async function save() {
    const youtubeUrl = normalizeYoutubeUrl(yt);
    if (youtubeUrl === null) { Alert.alert('Invalid YouTube link', 'Enter a youtube.com or youtu.be URL, or leave it blank.'); return; }
    const photosAlbumUrl = normalizePhotosUrl(ph);
    if (photosAlbumUrl === null) { Alert.alert('Invalid Google Photos link', 'Enter a photos.google.com or photos.app.goo.gl URL, or leave it blank.'); return; }
    if (!youtubeUrl && !photosAlbumUrl) {
      setBusy(true);
      try { await onSave?.(null); setEditing(false); } finally { setBusy(false); }
      return;
    }
    setBusy(true);
    try {
      await onSave?.({
        ...(youtubeUrl ? { youtubeUrl } : {}),
        ...(photosAlbumUrl ? { photosAlbumUrl } : {}),
      });
      setEditing(false);
    } catch {
      /* onSave surfaces its own error */
    } finally {
      setBusy(false);
    }
  }

  // Players (non-editable) with no media → render nothing.
  if (!editable && !hasAny) return null;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Ionicons name="film-outline" size={18} color={Colors.primary} />
        <Text style={styles.title}>Recap & photos</Text>
      </View>

      {!editing && hasVideo && (
        <Button title="▶ Watch the recap" onPress={() => open(media?.youtubeUrl)} />
      )}
      {!editing && hasAlbum && (
        <Button title="🖼 View the photo album" onPress={() => open(media?.photosAlbumUrl)} variant="secondary" />
      )}
      {!editing && editable && !hasAny && (
        <Text style={styles.hint}>Add a YouTube recap and/or a Google Photos album to share with everyone.</Text>
      )}

      {editing && (
        <>
          <Text style={styles.label}>YouTube recap URL</Text>
          <TextInput
            style={styles.input}
            value={yt}
            onChangeText={setYt}
            placeholder="https://youtu.be/…"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.label}>Google Photos album URL</Text>
          <TextInput
            style={styles.input}
            value={ph}
            onChangeText={setPh}
            placeholder="https://photos.app.goo.gl/…"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.actions}>
            <Button title="Cancel" onPress={() => setEditing(false)} variant="ghost" fullWidth={false} style={{ flex: 1 }} />
            <Button title="Save" onPress={save} loading={busy} fullWidth={false} style={{ flex: 1 }} />
          </View>
        </>
      )}

      {editable && !editing && (
        <Button
          title={hasAny ? 'Edit links' : 'Add links'}
          onPress={() => { setYt(media?.youtubeUrl ?? ''); setPh(media?.photosAlbumUrl ?? ''); setEditing(true); }}
          variant="ghost"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface, borderRadius: 12, padding: 16, gap: 10,
    borderWidth: 1, borderColor: Colors.border,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, fontWeight: '700', color: Colors.text },
  hint: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  label: { fontSize: 11, color: Colors.textSecondary, fontWeight: '700', letterSpacing: 0.5, marginTop: 4 },
  input: {
    backgroundColor: Colors.surfaceElevated, borderRadius: 10, borderWidth: 1, borderColor: Colors.border,
    color: Colors.text, fontSize: 15, padding: 12,
  },
  actions: { flexDirection: 'row', gap: 12, marginTop: 4 },
});
