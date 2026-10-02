import React, { useEffect, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  StyleSheet,
  Switch,
  TouchableOpacity,
  Alert,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTheme } from "../context/ThemeContext";

const SETTINGS_KEY = "@smart_voice_navigation_settings";

type Settings = {
  darkMode: boolean;
  traffic: boolean;
  notifications: boolean;
  voiceLanguage: "English (India)" | "Hindi (India)" | "Hinglish";
  voiceType: "Male" | "Female";
  distanceUnit: "Kilometers" | "Miles";
  avoidTolls: boolean;
  avoidHighways: boolean;
  avoidFerries: boolean;
  voiceSpeed: number;
};

const DEFAULT_SETTINGS: Settings = {
  darkMode: false,
  traffic: true,
  notifications: true,
  voiceLanguage: "English (India)",
  voiceType: "Male",
  distanceUnit: "Kilometers",
  avoidTolls: false,
  avoidHighways: false,
  avoidFerries: false,
  voiceSpeed: 1.0,
};

export default function SettingsScreen() {
  const { isDark, colors, setDarkMode } = useTheme();
  const [settings, setSettings] =
    useState<Settings>(DEFAULT_SETTINGS);

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const saved =
        await AsyncStorage.getItem(SETTINGS_KEY);

      if (saved) {
        const parsed = JSON.parse(saved);

        const nextSettings = {
          ...DEFAULT_SETTINGS,
          ...parsed,
        };
        setSettings(nextSettings);
        if (typeof nextSettings.darkMode === "boolean") {
          setDarkMode(nextSettings.darkMode);
        }
      }
    } catch (error) {
      console.error("[Settings] Load error:", error);
    } finally {
      setLoading(false);
    }
  }

  async function updateSettings(
    patch: Partial<Settings>
  ) {
    const nextSettings = {
      ...settings,
      ...patch,
    };

    setSettings(nextSettings);

    try {
      await AsyncStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify(nextSettings)
      );
    } catch (error) {
      console.error(
        "[Settings] Save error:",
        error
      );
    }
  }

  async function resetSettings() {
    Alert.alert(
      "Reset Settings",
      "Reset all settings to their default values?",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            try {
              await AsyncStorage.setItem(
                SETTINGS_KEY,
                JSON.stringify(DEFAULT_SETTINGS)
              );

              setSettings(DEFAULT_SETTINGS);
              setDarkMode(DEFAULT_SETTINGS.darkMode);
            } catch (error) {
              console.error(
                "[Settings] Reset error:",
                error
              );
            }
          },
        },
      ]
    );
  }

  function chooseOption<T extends string>(
    title: string,
    current: T,
    options: T[],
    onSelect: (value: T) => void
  ) {
    Alert.alert(
      title,
      "Choose an option",
      [
        ...options.map((option) => ({
          text:
            option === current
              ? `✓ ${option}`
              : option,
          onPress: () => onSelect(option),
        })),
        {
          text: "Cancel",
          style: "cancel" as const,
        },
      ]
    );
  }


  if (loading) {
  return (
      <SafeAreaView
        style={[
          styles.container,
          { backgroundColor: colors.background },
        ]}
      >
        <View style={styles.loadingContainer}>
          <Text
            style={[
              styles.loadingText,
              { color: colors.text },
            ]}
          >
            Loading settings...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: colors.background },
      ]}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Ionicons
              name="chevron-back"
              size={28}
              color={colors.text}
            />
          </TouchableOpacity>

          <Text
            style={[
              styles.title,
              { color: colors.text },
            ]}
          >
            Settings
          </Text>
        </View>

        {/* Appearance */}
        <Text
          style={[
            styles.section,
            { color: colors.secondary },
          ]}
        >
          Appearance
        </Text>

        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.left}>
            <View
              style={[
                styles.iconBox,
                { backgroundColor: isDark ? "#1F2937" : "#EEF2FF" },
              ]}
            >
              <Ionicons
                name={
                  settings.darkMode
                    ? "moon-outline"
                    : "sunny-outline"
                }
                size={21}
                color={colors.primary}
              />
            </View>

            <Text
              style={[
                styles.itemText,
                { color: colors.text },
              ]}
            >
              Dark Mode
            </Text>
          </View>

          <Switch
            value={settings.darkMode}
            trackColor={{ false: "#D1D5DB", true: colors.primary }}
            thumbColor={settings.darkMode ? "#FFFFFF" : "#FFFFFF"}
            onValueChange={(value) => {
              setDarkMode(value);
              void updateSettings({
                darkMode: value,
              });
            }}
          />
        </View>

        {/* Voice */}
        <Text
          style={[
            styles.section,
            { color: colors.secondary },
          ]}
        >
          Voice & Language
        </Text>

        <TouchableOpacity
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
          onPress={() =>
            chooseOption(
              "Voice Language",
              settings.voiceLanguage,
              [
                "English (India)",
                "Hindi (India)",
                "Hinglish",
              ],
              (value) =>
                updateSettings({
                  voiceLanguage: value,
                })
            )
          }
        >
          <View style={styles.left}>
            <View
              style={[
                styles.iconBox,
                { backgroundColor: isDark ? "#1F2937" : "#EEF2FF" },
              ]}
            >
              <Ionicons
                name="language-outline"
                size={21}
                color={colors.primary}
              />
            </View>

            <Text
              style={[
                styles.itemText,
                { color: colors.text },
              ]}
            >
              Voice Language
            </Text>
          </View>

          <View style={styles.right}>
            <Text
              style={[
                styles.value,
                { color: colors.secondary },
              ]}
            >
              {settings.voiceLanguage}
            </Text>

            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.icon}
            />
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
          onPress={() =>
            chooseOption(
              "Voice Type",
              settings.voiceType,
              ["Male", "Female"],
              (value) =>
                updateSettings({
                  voiceType: value,
                })
            )
          }
        >
          <View style={styles.left}>
            <View
              style={[
                styles.iconBox,
                { backgroundColor: isDark ? "#1F2937" : "#EEF2FF" },
              ]}
            >
              <Ionicons
                name="mic-outline"
                size={21}
                color={colors.primary}
              />
            </View>

            <Text
              style={[
                styles.itemText,
                { color: colors.text },
              ]}
            >
              Voice Type
            </Text>
          </View>

          <View style={styles.right}>
            <Text
              style={[
                styles.value,
                { color: colors.secondary },
              ]}
            >
              {settings.voiceType}
            </Text>

            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.icon}
            />
          </View>
        </TouchableOpacity>

        {/* Navigation */}
        <Text
          style={[
            styles.section,
            { color: colors.secondary },
          ]}
        >
          Navigation
        </Text>

        <TouchableOpacity
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
          onPress={() =>
            chooseOption(
              "Distance Unit",
              settings.distanceUnit,
              ["Kilometers", "Miles"],
              (value) =>
                updateSettings({
                  distanceUnit: value,
                })
            )
          }
        >
          <View style={styles.left}>
            <View
              style={[
                styles.iconBox,
                { backgroundColor: isDark ? "#1F2937" : "#EEF2FF" },
              ]}
            >
              <Ionicons
                name="speedometer-outline"
                size={21}
                color={colors.primary}
              />
            </View>

            <Text
              style={[
                styles.itemText,
                { color: colors.text },
              ]}
            >
              Distance Unit
            </Text>
          </View>

          <View style={styles.right}>
            <Text
              style={[
                styles.value,
                { color: colors.secondary },
              ]}
            >
              {settings.distanceUnit}
            </Text>

            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.icon}
            />
          </View>
        </TouchableOpacity>

        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.left}>
            <View
              style={[
                styles.iconBox,
                { backgroundColor: isDark ? "#1F2937" : "#EEF2FF" },
              ]}
            >
              <Ionicons
                name="car-outline"
                size={21}
                color={colors.primary}
              />
            </View>

            <Text
              style={[
                styles.itemText,
                { color: colors.text },
              ]}
            >
              Traffic Updates
            </Text>
          </View>

          <Switch
            value={settings.traffic}
            trackColor={{ false: "#D1D5DB", true: colors.primary }}
            thumbColor="#FFFFFF"
            onValueChange={(value) =>
              updateSettings({
                traffic: value,
              })
            }
          />
        </View>

        {/* Advanced Navigation */}
        <Text
          style={[
            styles.section,
            { color: colors.secondary },
          ]}
        >
          Advanced Navigation
        </Text>

        {[
          ["avoidTolls", "cash-outline", "Avoid Toll Roads"],
          ["avoidHighways", "car-outline", "Avoid Highways"],
          ["avoidFerries", "boat-outline", "Avoid Ferries"],
        ].map(([key, icon, label]) => (
          <View
            key={key}
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.left}>
              <View
                style={[
                  styles.iconBox,
                  {
                    backgroundColor: isDark
                      ? "#1F2937"
                      : "#EEF2FF",
                  },
                ]}
              >
                <Ionicons
                  name={icon as any}
                  size={21}
                  color={colors.primary}
                />
              </View>

              <Text
                style={[
                  styles.itemText,
                  { color: colors.text },
                ]}
              >
                {label}
              </Text>
            </View>

            <Switch
              value={Boolean(settings[key as keyof Settings])}
              trackColor={{
                false: "#D1D5DB",
                true: colors.primary,
              }}
              thumbColor="#FFFFFF"
              onValueChange={(value) =>
                void updateSettings({
                  [key]: value,
                } as Partial<Settings>)
              }
            />
          </View>
        ))}

        <TouchableOpacity
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
          onPress={() =>
            chooseOption(
              "Voice Speed",
              `${settings.voiceSpeed.toFixed(1)}x`,
              ["0.7x", "0.8x", "0.9x", "1.0x", "1.1x", "1.2x"],
              (value) =>
                updateSettings({
                  voiceSpeed: Number(value.replace("x", "")),
                })
            )
          }
        >
          <View style={styles.left}>
            <View
              style={[
                styles.iconBox,
                {
                  backgroundColor: isDark
                    ? "#1F2937"
                    : "#EEF2FF",
                },
              ]}
            >
              <Ionicons
                name="volume-high-outline"
                size={21}
                color={colors.primary}
              />
            </View>

            <Text
              style={[
                styles.itemText,
                { color: colors.text },
              ]}
            >
              Voice Speed
            </Text>
          </View>

          <View style={styles.right}>
            <Text
              style={[
                styles.value,
                { color: colors.secondary },
              ]}
            >
              {settings.voiceSpeed.toFixed(1)}x
            </Text>

            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.icon}
            />
          </View>
        </TouchableOpacity>

        {/* Notifications */}
        <Text
          style={[
            styles.section,
            { color: colors.secondary },
          ]}
        >
          Notifications
        </Text>

        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.left}>
            <View
              style={[
                styles.iconBox,
                { backgroundColor: isDark ? "#1F2937" : "#EEF2FF" },
              ]}
            >
              <Ionicons
                name="notifications-outline"
                size={21}
                color={colors.primary}
              />
            </View>

            <Text
              style={[
                styles.itemText,
                { color: colors.text },
              ]}
            >
              Push Notifications
            </Text>
          </View>

          <Switch
            value={settings.notifications}
            trackColor={{ false: "#D1D5DB", true: colors.primary }}
            thumbColor="#FFFFFF"
            onValueChange={(value) =>
              updateSettings({
                notifications: value,
              })
            }
          />
        </View>

        {/* About */}
        <Text
          style={[
            styles.section,
            { color: colors.secondary },
          ]}
        >
          About
        </Text>

        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.left}>
            <View
              style={[
                styles.iconBox,
                { backgroundColor: isDark ? "#1F2937" : "#EEF2FF" },
              ]}
            >
              <Ionicons
                name="information-circle-outline"
                size={21}
                color={colors.primary}
              />
            </View>

            <Text
              style={[
                styles.itemText,
                { color: colors.text },
              ]}
            >
              App Version
            </Text>
          </View>

          <Text
            style={[
              styles.value,
              { color: colors.secondary },
            ]}
          >
            1.0.0
          </Text>
        </View>

        {/* Reset */}
        <TouchableOpacity
          style={styles.resetButton}
          onPress={resetSettings}
          activeOpacity={0.8}
        >
          <Ionicons
            name="refresh-outline"
            size={20}
            color="#EF4444"
          />

          <Text style={[styles.resetText, { color: "#EF4444" }]}>
            Reset Settings
          </Text>
        </TouchableOpacity>

        <Text
          style={[
            styles.footer,
            { color: colors.secondary },
          ]}
        >
          Smart Voice Navigation
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  scrollContent: {
    paddingBottom: 35,
  },

  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  loadingText: {
    fontSize: 15,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 20,
    marginBottom: 15,
  },

  backButton: {
    width: 34,
    height: 34,
    justifyContent: "center",
    alignItems: "center",
  },

  title: {
    fontSize: 30,
    fontWeight: "700",
    marginLeft: 6,
  },

  section: {
    marginHorizontal: 20,
    marginTop: 25,
    marginBottom: 10,
    fontSize: 15,
    fontWeight: "700",
  },

  card: {
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 15,
    minHeight: 68,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    elevation: 3,
  },

  left: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },

  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },

  itemText: {
    fontSize: 16,
    fontWeight: "600",
  },

  value: {
    marginRight: 6,
    fontSize: 14,
  },

  right: {
    flexDirection: "row",
    alignItems: "center",
    maxWidth: "52%",
  },

  resetButton: {
    marginHorizontal: 20,
    marginTop: 15,
    minHeight: 54,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },

  resetText: {
    color: "#EF4444",
    fontSize: 15,
    fontWeight: "700",
  },

  footer: {
    textAlign: "center",
    marginTop: 20,
    fontSize: 12,
  },
});