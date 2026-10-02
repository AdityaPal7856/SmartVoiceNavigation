import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  ActivityIndicator,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { auth, db } from "../firebase";
import AsyncStorage from "@react-native-async-storage/async-storage";

type HistoryItem = {
  id: string;
  title: string;
  subtitle?: string;
  time: string;
  type: "search" | "route";
  destination?: string;
  category?: string;
};

type FirestoreHistory = {
  userId?: string;
  title?: string;
  subtitle?: string;
  destination?: string;
  category?: string;
  type?: "search" | "route";
  createdAt?: {
    toDate?: () => Date;
  };
};

const HISTORY_STORAGE_KEY =
  "smartVoiceNavigation_history";

function formatDate(value: unknown): string {
  let date: Date | null = null;

  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    date = (value as { toDate: () => Date }).toDate();
  } else if (value instanceof Date) {
    date = value;
  }

  if (!date || Number.isNaN(date.getTime())) {
    return "Recently";
  }

  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();

  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  if (isToday) return `Today • ${time}`;
  if (isYesterday) return `Yesterday • ${time}`;

  return `${date.toLocaleDateString([], {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })} • ${time}`;
}

export default function HistoryScreen() {
  const [activeTab, setActiveTab] = useState<"searches" | "routes">(
    "searches"
  );

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function loadHistory(
    options: { background?: boolean } = {}
  ) {
    const currentUser = auth.currentUser;

    if (!currentUser) {
      setHistory([]);
      setLoading(false);
      return;
    }

    const userKey =
      `${HISTORY_STORAGE_KEY}:${currentUser.uid}`;

    // ------------------------------------------
    // LOCAL CACHE FIRST
    // ------------------------------------------
    if (!options.background) {
      try {
        const cached =
          await AsyncStorage.getItem(userKey);

        if (cached) {
          const localHistory =
            JSON.parse(cached);

          if (Array.isArray(localHistory)) {
            setHistory(localHistory);
          }
        }
      } catch (error) {
        console.error(
          "[History] Local cache load error:",
          error
        );
      } finally {
        // Cached history should make the screen usable immediately.
        setLoading(false);
      }
    }

    // ------------------------------------------
    // FIREBASE BACKGROUND REFRESH
    // ------------------------------------------
    try {
      const historyRef = collection(
        db,
        "users",
        currentUser.uid,
        "history"
      );

      let items: HistoryItem[] = [];

      try {
        const historyQuery = query(
          historyRef,
          orderBy("createdAt", "desc")
        );

        const snapshot =
          await getDocs(historyQuery);

        items = snapshot.docs.map((item) => {
          const data =
            item.data() as FirestoreHistory;

          return {
            id: item.id,
            title:
              data.title ||
              data.destination ||
              data.category ||
              "Unknown place",
            subtitle:
              data.subtitle ||
              (data.type === "route"
                ? "Navigation route"
                : "Search"),
            time: formatDate(data.createdAt),
            type:
              data.type === "route"
                ? "route"
                : "search",
            destination: data.destination,
            category: data.category,
          };
        });
      } catch (orderedError) {
        // Keep the existing fallback for collections without an index.
        console.error(
          "[History] Ordered load error:",
          orderedError
        );

        const snapshot =
          await getDocs(historyRef);

        items = snapshot.docs.map((item) => {
          const data =
            item.data() as FirestoreHistory;

          return {
            id: item.id,
            title:
              data.title ||
              data.destination ||
              data.category ||
              "Unknown place",
            subtitle:
              data.subtitle ||
              (data.type === "route"
                ? "Navigation route"
                : "Search"),
            time: formatDate(data.createdAt),
            type:
              data.type === "route"
                ? "route"
                : "search",
            destination: data.destination,
            category: data.category,
          };
        });
      }

      setHistory(items);

      // Refresh local cache for instant next opening.
      await AsyncStorage.setItem(
        userKey,
        JSON.stringify(items)
      );
    } catch (error) {
      console.error(
        "[History] Firebase background load error:",
        error
      );

      // If there is no cached data, show the error.
      if (!options.background) {
        const cached =
          await AsyncStorage.getItem(userKey);

        if (!cached) {
          Alert.alert(
            "History Error",
            "Unable to load history right now."
          );
        }
      }
    } finally {
      if (!options.background) {
        setLoading(false);
      }
    }
  }

  const firebaseLoadStarted =
    useRef(false);

  useEffect(() => {
    let mounted = true;

    const unsubscribe =
      auth.onAuthStateChanged((currentUser) => {
        if (!mounted) return;

        firebaseLoadStarted.current = false;

        if (!currentUser) {
          setHistory([]);
          setLoading(false);
          return;
        }

        // Local cache is loaded first.
        void loadHistory();

        // A second call is not needed here because loadHistory()
        // already refreshes Firebase after loading local cache.
        firebaseLoadStarted.current = true;
      });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const visibleHistory = useMemo(() => {
    return history.filter((item) => item.type === (
      activeTab === "searches" ? "search" : "route"
    ));
  }, [history, activeTab]);

  async function deleteHistoryItem(id: string) {
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    try {
      setDeletingId(id);

      // Update UI/cache immediately.
      const nextHistory =
        history.filter(
          (item) => item.id !== id
        );

      setHistory(nextHistory);

      await AsyncStorage.setItem(
        `${HISTORY_STORAGE_KEY}:${currentUser.uid}`,
        JSON.stringify(nextHistory)
      );

      // Firebase delete runs in the background.
      void deleteDoc(
        doc(
          db,
          "users",
          currentUser.uid,
          "history",
          id
        )
      )
        .then(() => {
          console.log(
            "[History] Firebase delete successful"
          );
        })
        .catch((error) => {
          console.error(
            "[History] Firebase background delete error:",
            error
          );

          // Refresh in case the remote delete failed.
          void loadHistory({
            background: true,
          });
        });
    } catch (error) {
      console.error(
        "[History] Local delete error:",
        error
      );

      Alert.alert(
        "Error",
        "Unable to delete this history item."
      );
    } finally {
      setDeletingId(null);
    }
  }

  function confirmDelete(item: HistoryItem) {
    Alert.alert(
      "Delete History",
      `Remove "${item.title}" from history?`,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteHistoryItem(item.id),
        },
      ]
    );
  }

  async function clearHistory() {
    const currentUser = auth.currentUser;

    if (
      !currentUser ||
      history.length === 0
    ) {
      return;
    }

    Alert.alert(
      "Clear History",
      "Delete all saved history?",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Clear All",
          style: "destructive",
          onPress: () => {
            const userKey =
              `${HISTORY_STORAGE_KEY}:${currentUser.uid}`;

            // Clear the UI/cache immediately.
            setHistory([]);

            void AsyncStorage.setItem(
              userKey,
              JSON.stringify([])
            )
              .then(async () => {
                try {
                  const historyRef =
                    collection(
                      db,
                      "users",
                      currentUser.uid,
                      "history"
                    );

                  const snapshot =
                    await getDocs(historyRef);

                  await Promise.all(
                    snapshot.docs.map((item) =>
                      deleteDoc(item.ref)
                    )
                  );

                  console.log(
                    "[History] Firebase clear successful"
                  );
                } catch (error) {
                  console.error(
                    "[History] Firebase background clear error:",
                    error
                  );

                  // Remote state may still contain items.
                  // Refresh cache/UI in the background.
                  void loadHistory({
                    background: true,
                  });
                }
              })
              .catch((error) => {
                console.error(
                  "[History] Local clear error:",
                  error
                );
              });
          },
        },
      ]
    );
  }

  function openHistoryItem(item: HistoryItem) {
    const destination =
      item.destination || item.category || item.title;

    if (!destination) return;

    // Reuse the selected history item directly in navigation.
    // MapScreen already supports autoStart=true for voice-originated
    // navigation, so history reuse follows the same route flow.
    router.push({
      pathname: "/(tabs)/map",
      params: {
        destination,
        autoStart: "true",
        historyReuse: "true",
      },
    });
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityLabel="Go back"
        >
          <MaterialIcons
            name="arrow-back-ios"
            size={22}
            color="#111"
          />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>History</Text>

        {history.length > 0 ? (
          <TouchableOpacity
            onPress={clearHistory}
            accessibilityLabel="Clear all history"
          >
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 45 }} />
        )}
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === "searches" && styles.activeTab,
          ]}
          onPress={() => setActiveTab("searches")}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "searches" && styles.activeText,
            ]}
          >
            Recent Searches
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === "routes" && styles.activeTab,
          ]}
          onPress={() => setActiveTab("routes")}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === "routes" && styles.activeText,
            ]}
          >
            Recent Routes
          </Text>
        </TouchableOpacity>
      </View>

      {/* Loading */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator
            size="large"
            color="#2563EB"
          />
          <Text style={styles.loadingText}>
            Loading history...
          </Text>
        </View>
      ) : (
        <FlatList
          data={visibleHistory}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={
            visibleHistory.length === 0
              ? styles.emptyList
              : styles.list
          }
          onRefresh={loadHistory}
          refreshing={loading}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              activeOpacity={0.8}
              onPress={() => openHistoryItem(item)}
            >
              <View style={styles.iconBox}>
                <MaterialIcons
                  name={
                    item.type === "route"
                      ? "navigation"
                      : "search"
                  }
                  size={23}
                  color="#2563EB"
                />
              </View>

              <View style={styles.info}>
                <Text
                  style={styles.place}
                  numberOfLines={1}
                >
                  {item.title}
                </Text>

                <Text style={styles.city}>
                  {item.subtitle}
                </Text>

                <Text style={styles.time}>
                  {item.time}
                </Text>

                <Text style={styles.reuseHint}>
                  Tap to navigate again
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => confirmDelete(item)}
                disabled={deletingId === item.id}
                style={styles.deleteButton}
                accessibilityLabel={`Delete ${item.title}`}
              >
                {deletingId === item.id ? (
                  <ActivityIndicator
                    size="small"
                    color="#EF4444"
                  />
                ) : (
                  <MaterialIcons
                    name="delete-outline"
                    size={24}
                    color="#9CA3AF"
                  />
                )}
              </TouchableOpacity>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialIcons
                name={
                  activeTab === "routes"
                    ? "route"
                    : "history"
                }
                size={55}
                color="#CBD5E1"
              />

              <Text style={styles.emptyTitle}>
                No{" "}
                {activeTab === "routes"
                  ? "recent routes"
                  : "recent searches"}
              </Text>

              <Text style={styles.emptyText}>
                Your{" "}
                {activeTab === "routes"
                  ? "navigation routes"
                  : "searches"}{" "}
                will appear here.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    paddingTop: 60,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    marginBottom: 20,
  },

  headerTitle: {
    fontSize: 26,
    fontWeight: "700",
    color: "#111827",
  },

  clearText: {
    color: "#EF4444",
    fontSize: 14,
    fontWeight: "700",
  },

  tabs: {
    flexDirection: "row",
    marginHorizontal: 20,
    backgroundColor: "#EEF2FF",
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
  },

  tab: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },

  activeTab: {
    backgroundColor: "#FFFFFF",
  },

  tabText: {
    color: "#6B7280",
    fontWeight: "600",
  },

  activeText: {
    color: "#2563EB",
  },

  list: {
    paddingBottom: 30,
  },

  card: {
    backgroundColor: "#FFFFFF",
    marginHorizontal: 20,
    marginBottom: 15,
    padding: 16,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    elevation: 3,
  },

  iconBox: {
    width: 45,
    height: 45,
    borderRadius: 23,
    backgroundColor: "#EEF4FF",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 13,
  },

  info: {
    flex: 1,
  },

  place: {
    fontSize: 17,
    fontWeight: "700",
    color: "#111827",
  },

  city: {
    color: "#6B7280",
    marginTop: 3,
  },

  time: {
    color: "#9CA3AF",
    marginTop: 5,
    fontSize: 12,
  },

  reuseHint: {
    color: "#2563EB",
    marginTop: 6,
    fontSize: 11,
    fontWeight: "600",
  },

  deleteButton: {
    width: 42,
    height: 42,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 5,
  },

  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  loadingText: {
    marginTop: 10,
    color: "#6B7280",
  },

  emptyList: {
    flexGrow: 1,
  },

  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },

  emptyTitle: {
    marginTop: 15,
    fontSize: 18,
    fontWeight: "700",
    color: "#374151",
  },

  emptyText: {
    marginTop: 7,
    textAlign: "center",
    color: "#9CA3AF",
    lineHeight: 20,
  },
});
