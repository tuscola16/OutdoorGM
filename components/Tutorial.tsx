import { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, ScrollView, TouchableOpacity, Dimensions,
  NativeSyntheticEvent, NativeScrollEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/colors';

const { width } = Dimensions.get('window');

interface Slide {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}

const SLIDES: Slide[] = [
  {
    icon: 'map-outline',
    title: 'Your mini-map',
    body: "You'll see only your own location on the map. Your Game Master sees everyone — but other players can't see you.",
  },
  {
    icon: 'time-outline',
    title: 'When the game starts',
    body: 'The GM starts the round. A timer shows how long you have been playing. Reach checkpoints to alert your GM.',
  },
  {
    icon: 'flag-outline',
    title: "Tapping out",
    body: "Done early, or caught? Hit “I’m Out” to stop and lock in your time. When the game ends you'll see how you did.",
  },
];

/**
 * One-time intro shown to a player after they join, before the game starts.
 * Caller controls visibility and persistence (so it only shows once).
 */
export function Tutorial({
  visible,
  onDone,
  rules,
}: {
  visible: boolean;
  onDone: () => void;
  rules?: string;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  const slides = rules?.trim()
    ? [...SLIDES, { icon: 'document-text-outline' as const, title: "GM's rules", body: rules.trim() }]
    : SLIDES;
  const isLast = index >= slides.length - 1;

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index) setIndex(i);
  }

  function next() {
    if (isLast) { onDone(); return; }
    scrollRef.current?.scrollTo({ x: (index + 1) * width, animated: true });
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onDone}>
      <View style={styles.container}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={onDone} hitSlop={12}>
            <Text style={styles.skip}>Skip</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
        >
          {slides.map((s, i) => (
            <View key={i} style={styles.slide}>
              <View style={styles.iconCircle}>
                <Ionicons name={s.icon} size={56} color={Colors.primary} />
              </View>
              <Text style={styles.slideTitle}>{s.title}</Text>
              <Text style={styles.slideBody}>{s.body}</Text>
            </View>
          ))}
        </ScrollView>

        <View style={styles.dots}>
          {slides.map((_, i) => (
            <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>

        <TouchableOpacity style={styles.cta} onPress={next}>
          <Text style={styles.ctaText}>{isLast ? "Got it" : 'Next'}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  topBar: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 24, paddingTop: 16 },
  skip: { color: Colors.textSecondary, fontSize: 15, fontWeight: '600' },
  slide: { width, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 20 },
  iconCircle: {
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  slideTitle: { fontSize: 24, fontWeight: '800', color: Colors.text, textAlign: 'center' },
  slideBody: { fontSize: 16, color: Colors.textSecondary, textAlign: 'center', lineHeight: 24 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 24 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.border },
  dotActive: { backgroundColor: Colors.primary, width: 20 },
  cta: {
    marginHorizontal: 24, marginBottom: 40,
    backgroundColor: Colors.primary,
    borderRadius: 14, paddingVertical: 16, alignItems: 'center',
  },
  ctaText: { color: Colors.black, fontSize: 16, fontWeight: '800' },
});
