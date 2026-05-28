import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/colors';
import type { Arrival } from '@/types';

interface AlertFeedProps {
  arrivals: Arrival[];
}

function formatTime(timestamp: any): string {
  try {
    const date: Date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

function ArrivalItem({ arrival }: { arrival: Arrival }) {
  return (
    <View style={styles.item}>
      <View style={styles.iconWrapper}>
        <Ionicons name="location" size={18} color={Colors.primary} />
      </View>
      <View style={styles.content}>
        <Text style={styles.playerName}>{arrival.playerName}</Text>
        <Text style={styles.checkpointName}>reached {arrival.checkpointName}</Text>
      </View>
      <Text style={styles.time}>{formatTime(arrival.timestamp)}</Text>
    </View>
  );
}

export function AlertFeed({ arrivals }: AlertFeedProps) {
  if (arrivals.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="radio-outline" size={32} color={Colors.textMuted} />
        <Text style={styles.emptyText}>Waiting for arrivals…</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={arrivals}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <ArrivalItem arrival={item} />}
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    paddingVertical: 8,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 10,
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
  },
  iconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  content: {
    flex: 1,
  },
  playerName: {
    color: Colors.text,
    fontWeight: '700',
    fontSize: 14,
  },
  checkpointName: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 1,
  },
  time: {
    color: Colors.textMuted,
    fontSize: 11,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  emptyText: {
    color: Colors.textMuted,
    fontSize: 14,
  },
});
