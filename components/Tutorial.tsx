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
    icon: 'navigate-outline',
    title: 'Welcome to the arena',
    body: "You're a tribute in a last-one-standing survival game. You see only your own dot on the map; your Game Master sees everyone. Stay inside the play area and outlast the field.",
  },
  {
    icon: 'people-outline',
    title: 'You have a district',
    body: 'You and your district partner are a pair. Some events treat you as a team — for example, a trap may be held back if you and your partner arrive at a site together.',
  },
  {
    icon: 'warning-outline',
    title: 'Events in the field',
    body: 'Reaching certain locations triggers something: a hazard to survive, a boon to grab, or a message. Some sites only go live at set times — when one fires for you, an alert pops up over your screen.',
  },
  {
    icon: 'restaurant-outline',
    title: 'Eat or starve',
    body: 'Every so often a ration window opens and you’ll be alerted. Before it closes, photograph your numbered ration card with the camera to prove you ate. Miss the window and you risk starving out.',
  },
  {
    icon: 'notifications-outline',
    title: "Don't miss an alert",
    body: 'Your GM sends announcements and event alerts that pop up over the app — tap to dismiss. Keep notifications on and your location set to “Allow all the time” so alerts reach you and you stay on the map even when your screen is locked.',
  },
  {
    icon: 'alert-circle-outline',
    title: "If you're out — or in trouble",
    body: 'Struck or caught? Tap “I’ve been killed” to bow out and lock in your time, then wave your red bandana as you leave the arena. Feel unsafe, injured, or too cold? Hit the Safety alert — your GM is notified instantly and can see exactly where you are.',
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
