import { useRef, useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/colors';

/**
 * In-app camera for ration-card capture. Replaces `ImagePicker.launchCameraAsync`,
 * which on Android could launch the external camera activity and never return (the
 * host activity gets recreated and the result promise is lost — the field-test
 * "opening camera… then nothing"). Capturing inside our own activity sidesteps that.
 */
export function CameraCapture({
  visible,
  onClose,
  onCapture,
}: {
  visible: boolean;
  onClose: () => void;
  onCapture: (uri: string) => void;
}) {
  const ref = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);

  async function snap() {
    if (busy || !ref.current) return;
    setBusy(true);
    try {
      const photo = await ref.current.takePictureAsync({ quality: 0.6, skipProcessing: true });
      if (photo?.uri) onCapture(photo.uri);
    } catch {
      /* let the player retry */
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.container}>
        {!permission ? (
          <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>
        ) : !permission.granted ? (
          <View style={styles.center}>
            <Ionicons name="camera-outline" size={48} color={Colors.textMuted} />
            <Text style={styles.msg}>Camera access is needed to photograph your ration card.</Text>
            <TouchableOpacity
              style={styles.grantBtn}
              onPress={permission.canAskAgain ? requestPermission : () => Linking.openSettings()}
            >
              <Text style={styles.grantText}>{permission.canAskAgain ? 'Grant camera access' : 'Open Settings'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={{ padding: 10 }}>
              <Text style={styles.cancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <CameraView ref={ref} style={StyleSheet.absoluteFill} facing="back" />
            <View style={styles.hintBar}>
              <Text style={styles.hintText}>Frame your numbered ration card and tap the shutter.</Text>
            </View>
            <View style={styles.controls}>
              <TouchableOpacity style={styles.sideBtn} onPress={onClose}>
                <Ionicons name="close" size={28} color={Colors.white} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.shutter} onPress={snap} disabled={busy} activeOpacity={0.8}>
                {busy ? <ActivityIndicator color={Colors.black} /> : <View style={styles.shutterInner} />}
              </TouchableOpacity>
              <View style={styles.sideBtn} />
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  msg: { color: Colors.text, fontSize: 16, textAlign: 'center', lineHeight: 23 },
  grantBtn: { backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 24 },
  grantText: { color: Colors.black, fontWeight: '800', fontSize: 16 },
  cancel: { color: Colors.textSecondary, fontSize: 15, fontWeight: '600' },
  hintBar: { position: 'absolute', top: 60, left: 0, right: 0, alignItems: 'center', paddingHorizontal: 24 },
  hintText: {
    color: Colors.white, fontSize: 14, textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20,
    overflow: 'hidden',
  },
  controls: {
    position: 'absolute', bottom: 48, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: 32,
  },
  sideBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  shutter: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: Colors.white,
    alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: 'rgba(255,255,255,0.4)',
  },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: Colors.white },
});
