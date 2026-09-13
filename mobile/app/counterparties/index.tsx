import React, { useState, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  Modal,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/src/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  getCounterparties,
  createCounterparty,
  CounterpartyRow,
  CounterpartyType,
} from '@/src/db';

export default function CounterpartiesScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const { t } = useTranslation();

  const [counterparties, setCounterparties] = useState<CounterpartyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Add counterparty modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<CounterpartyType>('person');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const list = await getCounterparties({ isArchived: false });
      setCounterparties(list);
    } catch (err) {
      console.error('Failed to load counterparties:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const filteredList = useMemo(() => {
    if (!searchQuery.trim()) return counterparties;
    const q = searchQuery.trim().toLowerCase();
    return counterparties.filter(
      (cp) =>
        cp.name.toLowerCase().includes(q) ||
        (cp.phone && cp.phone.toLowerCase().includes(q)) ||
        (cp.email && cp.email.toLowerCase().includes(q))
    );
  }, [counterparties, searchQuery]);

  const handleCreate = async () => {
    if (!name.trim()) {
      Alert.alert(t('common.error'), t('counterparties.errors.nameRequired'));
      return;
    }

    try {
      setIsSubmitting(true);
      await createCounterparty({
        name: name.trim(),
        type,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        note: note.trim() || undefined,
      });

      setModalVisible(false);
      setName('');
      setPhone('');
      setEmail('');
      setNote('');
      await loadData();
    } catch (err: any) {
      console.error('Failed to create counterparty:', err);
      Alert.alert(t('common.error'), err.message || 'Failed to create profile');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderItem = ({ item }: { item: CounterpartyRow }) => {
    const initials = item.name
      .split(' ')
      .map((part) => part[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();

    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
        activeOpacity={0.7}
        onPress={() => router.push(`/counterparties/${item.id}` as any)}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${t(`counterparties.types.${item.type}`)}`}
      >
        <View style={styles.cardLeft}>
          <View style={[styles.avatar, { backgroundColor: theme.surfaceTinted }]}>
            <Text style={[styles.avatarText, { color: theme.primary }]}>{initials}</Text>
          </View>
          <View style={styles.cardInfo}>
            <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={[styles.typeBadge, { color: theme.textMuted }]}>
              {t(`counterparties.types.${item.type}`)}
              {item.phone ? ` • ${item.phone}` : ''}
            </Text>
          </View>
        </View>

        <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel={t('actions.cancel')}
          >
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </TouchableOpacity>
          <View>
            <Text style={[styles.title, { color: theme.text }]}>{t('counterparties.title')}</Text>
            <Text style={[styles.subtitle, { color: theme.textMuted }]}>
              {t('counterparties.subtitle')}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.addButton, { backgroundColor: theme.primary }]}
          onPress={() => setModalVisible(true)}
          accessibilityRole="button"
          accessibilityLabel={t('counterparties.addCounterparty')}
        >
          <Ionicons name="add" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View style={[styles.searchBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Ionicons name="search" size={16} color={theme.textMuted} />
        <TextInput
          style={[styles.searchInput, { color: theme.text }]}
          placeholder={t('actions.search') || 'Search counterparties...'}
          placeholderTextColor={theme.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          clearButtonMode="while-editing"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={16} color={theme.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : (
        <FlatList
          data={filteredList}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={[styles.listContent, filteredList.length === 0 && styles.emptyListContent]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={[styles.emptyIconBg, { backgroundColor: theme.surfaceTinted }]}>
                <Ionicons name="people-outline" size={36} color={theme.primary} />
              </View>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>
                {t('counterparties.noCounterparties')}
              </Text>
              <Text style={[styles.emptySubtitle, { color: theme.textMuted }]}>
                {t('counterparties.noCounterpartiesSubtitle')}
              </Text>
              <TouchableOpacity
                style={[styles.emptyAddButton, { backgroundColor: theme.primary }]}
                onPress={() => setModalVisible(true)}
              >
                <Text style={styles.emptyAddButtonText}>{t('counterparties.addCounterparty')}</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}

      {/* Create Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>
                {t('counterparties.addCounterparty')}
              </Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={22} color={theme.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
              {/* Name */}
              <Text style={[styles.modalLabel, { color: theme.textMuted }]}>
                {t('counterparties.name')} *
              </Text>
              <TextInput
                style={[styles.modalInput, { backgroundColor: theme.background, borderColor: theme.border, color: theme.text }]}
                placeholder={t('counterparties.namePlaceholder')}
                placeholderTextColor={theme.textMuted}
                value={name}
                onChangeText={setName}
              />

              {/* Type */}
              <Text style={[styles.modalLabel, { color: theme.textMuted, marginTop: 12 }]}>
                {t('counterparties.type')}
              </Text>
              <View style={styles.typeRow}>
                {(['person', 'business', 'organisation', 'other'] as CounterpartyType[]).map((typeKey) => (
                  <TouchableOpacity
                    key={typeKey}
                    style={[
                      styles.typeButton,
                      type === typeKey && [styles.typeButtonActive, { backgroundColor: theme.surfaceTinted, borderColor: theme.primary }],
                      { borderColor: theme.border },
                    ]}
                    onPress={() => setType(typeKey)}
                  >
                    <Text
                      style={[
                        styles.typeButtonText,
                        { color: type === typeKey ? theme.primary : theme.textMuted },
                      ]}
                    >
                      {t(`counterparties.types.${typeKey}`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Phone */}
              <Text style={[styles.modalLabel, { color: theme.textMuted, marginTop: 12 }]}>
                {t('counterparties.phone')}
              </Text>
              <TextInput
                style={[styles.modalInput, { backgroundColor: theme.background, borderColor: theme.border, color: theme.text }]}
                placeholder={t('counterparties.phonePlaceholder')}
                placeholderTextColor={theme.textMuted}
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
              />

              {/* Email */}
              <Text style={[styles.modalLabel, { color: theme.textMuted, marginTop: 12 }]}>
                {t('counterparties.email')}
              </Text>
              <TextInput
                style={[styles.modalInput, { backgroundColor: theme.background, borderColor: theme.border, color: theme.text }]}
                placeholder={t('counterparties.emailPlaceholder')}
                placeholderTextColor={theme.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
              />

              {/* Note */}
              <Text style={[styles.modalLabel, { color: theme.textMuted, marginTop: 12 }]}>
                {t('counterparties.note')}
              </Text>
              <TextInput
                style={[styles.modalInput, { backgroundColor: theme.background, borderColor: theme.border, color: theme.text, height: 60 }]}
                placeholder={t('counterparties.notePlaceholder')}
                placeholderTextColor={theme.textMuted}
                multiline
                value={note}
                onChangeText={setNote}
              />
            </ScrollView>

            <TouchableOpacity
              style={[styles.modalSaveButton, { backgroundColor: theme.primary }]}
              onPress={handleCreate}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.modalSaveButtonText}>
                  {t('counterparties.createCounterparty')}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  backButton: {
    padding: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  addButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 10,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  card: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 15,
    fontWeight: '700',
  },
  cardInfo: {
    flex: 1,
    gap: 3,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
  },
  typeBadge: {
    fontSize: 12,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  emptyIconBg: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  emptyAddButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
  },
  emptyAddButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    gap: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  modalLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  modalInput: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 42,
    fontSize: 13,
  },
  typeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  typeButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  typeButtonActive: {},
  typeButtonText: {
    fontSize: 11,
    fontWeight: '600',
  },
  modalSaveButton: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  modalSaveButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
