import React, { useEffect, useState } from "react";

import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";

import { Ionicons } from "@expo/vector-icons";

import { router } from "expo-router";

import * as Location from "expo-location";

import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  doc,
  getDoc,
} from "firebase/firestore";

import { auth, db } from "../../firebase";

// ==================================================
// HOME SCREEN
// ==================================================

export default function HomeScreen() {

  // ==================================================
  // USER NAME
  // Firebase Firestore se load hoga
  // ==================================================

  const [userName, setUserName] =
    useState("User");

  // ==================================================
  // CURRENT LOCATION
  // ==================================================

  const [currentLocation, setCurrentLocation] =
    useState({
      title: "Getting location...",
      subtitle: "Please wait...",
    });

  const [locationLoading, setLocationLoading] =
    useState(true);

  // ==================================================
  // SAVED HOME LOCATION
  // ==================================================

  const [homeLocation, setHomeLocation] =
    useState<{
      title: string;
      subtitle: string;
      latitude: number;
      longitude: number;
    } | null>(null);

  const [homeSaved, setHomeSaved] =
    useState(false);


  const reverseGeocodeSafe = async (
    latitude: number,
    longitude: number,
    retries = 2
  ) => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const addresses =
          await Location.reverseGeocodeAsync({
            latitude,
            longitude,
          });

        if (addresses.length > 0) {
          return addresses[0];
        }

        return null;
      } catch (error) {
        console.log(
          `[HomeScreen] Reverse geocoding attempt ${attempt + 1
          } failed`
        );

        if (attempt < retries) {
          await new Promise(resolve =>
            setTimeout(resolve, 1500)
          );
        }
      }
    }

    return null;
  };
  // ==================================================
  // LOAD USER NAME - LOCAL FIRST, FIREBASE FALLBACK
  // ==================================================

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const loadUserName = async () => {
      // 1. Pehle local storage se name immediately load karo
      //    Isse Firebase response ka wait nahi hoga.
      try {
        const localName =
          await AsyncStorage.getItem("userName");

        if (localName?.trim()) {
          setUserName(localName.trim());

          console.log(
            "[HomeScreen] User name loaded locally:",
            localName.trim()
          );
        }
      } catch (error) {
        console.log(
          "[HomeScreen] Local user name load failed:",
          error
        );
      }

      // 2. Firebase ko background mein fallback/update ke liye use karo
      unsubscribe = auth.onAuthStateChanged(
        async (currentUser) => {
          if (!currentUser) {
            // Agar local name already hai to usko replace mat karo
            const localName =
              await AsyncStorage.getItem("userName");

            if (!localName?.trim()) {
              setUserName("User");
            }
            return;
          }

          try {
            const userRef = doc(
              db,
              "users",
              currentUser.uid
            );

            const userSnap =
              await getDoc(userRef);

            let firebaseName = "";

            if (userSnap.exists()) {
              const data = userSnap.data();

              firebaseName =
                typeof data.name === "string"
                  ? data.name.trim()
                  : "";
            }

            const finalName =
              firebaseName ||
              currentUser.displayName?.trim() ||
              "";

            if (finalName) {
              // Firebase se milne wala latest name
              // local mein bhi save kar do.
              await AsyncStorage.setItem(
                "userName",
                finalName
              );

              setUserName(finalName);

              console.log(
                "[HomeScreen] User name synced:",
                finalName
              );
            }
          } catch (error) {
            // Firebase slow/offline hone par
            // local name already screen par rahega.
            console.log(
              "[HomeScreen] Firebase name sync skipped:",
              error
            );
          }
        }
      );
    };

    loadUserName();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  // ==================================================
  // LOAD SAVED HOME LOCATION
  // ==================================================

  useEffect(() => {

    const loadSavedHome =
      async () => {

        try {

          const savedHome =
            await AsyncStorage.getItem(
              "smartVoiceNavigation_homeLocation"
            );

          if (savedHome) {

            const parsed =
              JSON.parse(savedHome);

            if (
              parsed?.title &&
              parsed?.subtitle &&
              typeof parsed?.latitude ===
              "number" &&
              typeof parsed?.longitude ===
              "number"
            ) {

              setHomeLocation(
                parsed
              );

              setHomeSaved(true);
            }
          }

        } catch (error) {

          console.error(
            "[HomeScreen] Failed to load saved Home:",
            error
          );
        }
      };

    loadSavedHome();

  }, []);

  // ==================================================
  // CURRENT LOCATION
  // ==================================================

  useEffect(() => {

    let locationSubscription:
      | Location.LocationSubscription
      | null = null;

    // ----------------------------------------------
    // UPDATE ADDRESS
    // ----------------------------------------------

    const updateAddress = async (
      location: Location.LocationObject
    ) => {
      const {
        latitude,
        longitude,
      } = location.coords;

      console.log(
        "[HomeScreen] Current location:",
        latitude,
        longitude
      );

      const address =
        await reverseGeocodeSafe(
          latitude,
          longitude
        );

      if (address) {
        const title =
          address.street ||
          address.district ||
          address.subregion ||
          address.city ||
          "Current Location";

        const subtitle = [
          address.city ||
          address.subregion ||
          address.district,
          address.region,
          address.country,
        ]
          .filter(Boolean)
          .join(", ");

        setCurrentLocation({
          title,
          subtitle:
            subtitle ||
            `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
        });


      } else {
        // Reverse geocoding failed,
        // but GPS location is still valid.
        setCurrentLocation({
          title: "Current Location",
          subtitle: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
        });

        console.log(
          "[HomeScreen] Using coordinate fallback"
        );
      }
    };

    // ----------------------------------------------
    // GET CURRENT LOCATION
    // ----------------------------------------------

    const getCurrentLocation =
      async () => {

        try {

          setLocationLoading(true);

          // Location permission
          const {
            status,
          } =
            await Location.requestForegroundPermissionsAsync();

          if (
            status !== "granted"
          ) {

            setCurrentLocation({
              title:
                "Location permission denied",

              subtitle:
                "Please enable location permission",
            });

            setLocationLoading(false);

            return;
          }

          // Current GPS position
          const location =
            await Location.getCurrentPositionAsync({
              accuracy:
                Location.Accuracy.High,
            });

          await updateAddress(
            location
          );

          // Watch live location
          locationSubscription =
            await Location.watchPositionAsync(
              {
                accuracy:
                  Location.Accuracy.High,

                distanceInterval: 20,

                timeInterval: 5000,
              },

              async (
                newLocation
              ) => {

                await updateAddress(
                  newLocation
                );
              }
            );

        } catch (error) {

          console.error(
            "[HomeScreen] Location error:",
            error
          );

          setCurrentLocation({
            title:
              "Unable to get location",

            subtitle:
              "Please try again",
          });

        } finally {

          setLocationLoading(false);
        }
      };

    getCurrentLocation();

    // Cleanup
    return () => {

      if (
        locationSubscription
      ) {

        locationSubscription.remove();

        locationSubscription =
          null;
      }
    };

  }, []);

  // ==================================================
  // SAVE CURRENT LOCATION AS HOME
  // ==================================================

  const saveCurrentLocationAsHome =
    async () => {

      try {

        if (
          locationLoading
        ) {
          return;
        }

        const location =
          await Location.getCurrentPositionAsync({
            accuracy:
              Location.Accuracy.High,
          });

      

        const {
          latitude,
          longitude,
        } = location.coords;

        const address = await reverseGeocodeSafe(
          latitude,
          longitude
        );

        let title =
          currentLocation.title;

        let subtitle =
          currentLocation.subtitle;

        if (address) {
          title =
            address.street ||
            address.district ||
            address.subregion ||
            address.city ||
            currentLocation.title;

          subtitle = [
            address.city ||
            address.subregion ||
            address.district,
            address.region,
            address.country,
          ]
            .filter(Boolean)
            .join(", ");
        }

        const homeData = {
          title,

          subtitle:
            subtitle ||
            "Current location",

          latitude,

          longitude,
        };

        // Save local Home location
        await AsyncStorage.setItem(
          "smartVoiceNavigation_homeLocation",
          JSON.stringify(
            homeData
          )
        );

        setHomeLocation(
          homeData
        );

        setHomeSaved(true);

        console.log(
          "[HomeScreen] Home location saved:",
          homeData
        );

      } catch (error) {

        console.error(
          "[HomeScreen] Failed to save Home location:",
          error
        );
      }
    };

  // ==================================================
  // REMOVE SAVED HOME
  // ==================================================

  const removeSavedHome =
    async () => {

      try {

        await AsyncStorage.removeItem(
          "smartVoiceNavigation_homeLocation"
        );

        setHomeLocation(null);

        setHomeSaved(false);

        console.log(
          "[HomeScreen] Saved Home location removed."
        );

      } catch (error) {

        console.error(
          "[HomeScreen] Failed to remove saved Home:",
          error
        );
      }
    };

  // ==================================================
  // UI
  // ==================================================

  return (
    <SafeAreaView
      style={styles.container}
    >

      <ScrollView
        showsVerticalScrollIndicator={
          false
        }
        contentContainerStyle={
          styles.scrollContent
        }
      >

        {/* ==========================================
            HEADER
        ========================================== */}

        <View style={styles.header}>

          <View>

            <Text
              style={styles.greeting}
            >
              Hello, {userName} 👋
            </Text>

            <Text
              style={styles.subGreeting}
            >
              Where do you want to go?
            </Text>

          </View>

          <TouchableOpacity
            style={
              styles.notificationBtn
            }
          >

            <Ionicons
              name="notifications-outline"
              size={24}
              color="#374151"
            />

          </TouchableOpacity>

        </View>

        {/* ==========================================
            SEARCH BAR
        ========================================== */}

        <TouchableOpacity
          style={styles.searchBar}
          activeOpacity={0.8}
          onPress={() =>
            router.push(
              "/(tabs)/map"
            )
          }
        >

          <Ionicons
            name="search"
            size={20}
            color="#9CA3AF"
            style={
              styles.searchIcon
            }
          />

          <Text
            style={styles.searchText}
          >
            Search destination...
          </Text>

          <View
            style={styles.micBtn}
          >

            <Ionicons
              name="mic"
              size={18}
              color="#FFF"
            />

          </View>

        </TouchableOpacity>

        {/* ==========================================
            CURRENT LOCATION CARD
        ========================================== */}

        <TouchableOpacity
          style={
            styles.locationCard
          }
          activeOpacity={0.9}
          onPress={() =>
            router.push(
              "/(tabs)/map"
            )
          }
        >

          <View
            style={
              styles.locationIconBox
            }
          >

            <Ionicons
              name="location"
              size={24}
              color="#2563EB"
            />

          </View>

          <View
            style={
              styles.locationTextContainer
            }
          >

            <Text
              style={
                styles.currentLocLabel
              }
            >
              Current Location
            </Text>

            {locationLoading ? (

              <View
                style={
                  styles.loadingContainer
                }
              >

                <ActivityIndicator
                  size="small"
                  color="#FFFFFF"
                />

                <Text
                  style={
                    styles.loadingText
                  }
                >
                  Getting your location...
                </Text>

              </View>

            ) : (

              <>

                <Text
                  style={
                    styles.currentLocTitle
                  }
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {
                    currentLocation.title
                  }
                </Text>

                <Text
                  style={
                    styles.currentLocSubtitle
                  }
                  numberOfLines={2}
                  ellipsizeMode="tail"
                >
                  {
                    currentLocation.subtitle
                  }
                </Text>

              </>
            )}

          </View>

        </TouchableOpacity>

        {/* ==========================================
            QUICK ACTIONS
        ========================================== */}

        <Text
          style={styles.sectionTitle}
        >
          Quick Actions
        </Text>

        <View style={styles.row}>

          {/* HOME */}

          <TouchableOpacity
            style={
              styles.actionCard
            }
            activeOpacity={0.85}
            onPress={() =>
              router.push("/home")
            }
          >

            <View
              style={[
                styles.iconCircle,
                {
                  backgroundColor:
                    "#EEF2FF",
                },
              ]}
            >

              <Ionicons
                name="home"
                size={24}
                color="#4F46E5"
              />

            </View>

            <Text
              style={styles.actionTitle}
            >
              Home
            </Text>

            <Text
              style={
                styles.actionSubtitle
              }
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {homeLocation
                ? homeLocation.title
                : "Tap to set"}
            </Text>

          </TouchableOpacity>

          {/* WORK */}

          <TouchableOpacity
            style={
              styles.actionCard
            }
            onPress={() =>
              router.push("/work")
            }
          >

            <View
              style={[
                styles.iconCircle,
                {
                  backgroundColor:
                    "#EFF6FF",
                },
              ]}
            >

              <Ionicons
                name="briefcase"
                size={24}
                color="#2563EB"
              />

            </View>

            <Text
              style={styles.actionTitle}
            >
              Work
            </Text>

            <Text
              style={
                styles.actionSubtitle
              }
            >
              Tap to set
            </Text>

          </TouchableOpacity>

          {/* FAVORITES */}

          <TouchableOpacity
            style={
              styles.actionCard
            }
            onPress={() =>
              router.push(
                "/(tabs)/favorites"
              )
            }
          >

            <View
              style={[
                styles.iconCircle,
                {
                  backgroundColor:
                    "#FEF2F2",
                },
              ]}
            >

              <Ionicons
                name="heart"
                size={24}
                color="#EF4444"
              />

            </View>

            <Text
              style={styles.actionTitle}
            >
              Favorites
            </Text>

          </TouchableOpacity>

          {/* HISTORY */}

          <TouchableOpacity
            style={
              styles.actionCard
            }
            onPress={() =>
              router.push(
                "/history"
              )
            }
          >

            <View
              style={[
                styles.iconCircle,
                {
                  backgroundColor:
                    "#F3F4F6",
                },
              ]}
            >

              <Ionicons
                name="time"
                size={24}
                color="#6B7280"
              />

            </View>

            <Text
              style={styles.actionTitle}
            >
              History
            </Text>

          </TouchableOpacity>

        </View>

        {/* ==========================================
            NEARBY PLACES
        ========================================== */}

        <View
          style={
            styles.sectionHeader
          }
        >

          <Text
            style={styles.sectionTitle}
          >
            Nearby Places
          </Text>

          <TouchableOpacity
            onPress={() =>
              router.push(
                "/(tabs)/map"
              )
            }
          >

            <Text
              style={styles.seeAll}
            >
              See All
            </Text>

          </TouchableOpacity>

        </View>

        <View style={styles.row}>

          {/* PETROL */}

          <TouchableOpacity
            style={
              styles.placeCard
            }
            onPress={() =>
              router.push(
                "/(tabs)/map"
              )
            }
          >

            <View
              style={[
                styles.iconCircle,
                {
                  backgroundColor:
                    "#ECFDF5",
                },
              ]}
            >

              <Ionicons
                name="water"
                size={24}
                color="#10B981"
              />

            </View>

            <Text
              style={styles.actionTitle}
            >
              Petrol Pump
            </Text>

            <Text
              style={
                styles.actionSubtitle
              }
            >
              1.2 km
            </Text>

          </TouchableOpacity>

          {/* HOSPITAL */}

          <TouchableOpacity
            style={
              styles.placeCard
            }
            onPress={() =>
              router.push(
                "/(tabs)/map"
              )
            }
          >

            <View
              style={[
                styles.iconCircle,
                {
                  backgroundColor:
                    "#FEF2F2",
                },
              ]}
            >

              <Ionicons
                name="medkit"
                size={24}
                color="#EF4444"
              />

            </View>

            <Text
              style={styles.actionTitle}
            >
              Hospital
            </Text>

            <Text
              style={
                styles.actionSubtitle
              }
            >
              1.5 km
            </Text>

          </TouchableOpacity>

          {/* ATM */}

          <TouchableOpacity
            style={
              styles.placeCard
            }
            onPress={() =>
              router.push(
                "/(tabs)/map"
              )
            }
          >

            <View
              style={[
                styles.iconCircle,
                {
                  backgroundColor:
                    "#EEF2FF",
                },
              ]}
            >

              <Ionicons
                name="cash"
                size={24}
                color="#4F46E5"
              />

            </View>

            <Text
              style={styles.actionTitle}
            >
              ATM
            </Text>

            <Text
              style={
                styles.actionSubtitle
              }
            >
              0.8 km
            </Text>

          </TouchableOpacity>

          {/* RESTAURANT */}

          <TouchableOpacity
            style={
              styles.placeCard
            }
            onPress={() =>
              router.push(
                "/(tabs)/map"
              )
            }
          >

            <View
              style={[
                styles.iconCircle,
                {
                  backgroundColor:
                    "#FFF7ED",
                },
              ]}
            >

              <Ionicons
                name="restaurant"
                size={24}
                color="#F97316"
              />

            </View>

            <Text
              style={styles.actionTitle}
            >
              Restaurant
            </Text>

            <Text
              style={
                styles.actionSubtitle
              }
            >
              1.1 km
            </Text>

          </TouchableOpacity>

        </View>

      </ScrollView>

    </SafeAreaView>
  );
}

// ==================================================
// STYLES
// ==================================================

const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: "#F9FAFB",
  },

  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },

  // ==========================================
  // HEADER
  // ==========================================

  header: {
    flexDirection: "row",
    justifyContent:
      "space-between",
    alignItems: "center",
    marginBottom: 20,
  },

  greeting: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#111827",
  },

  subGreeting: {
    fontSize: 14,
    color: "#6B7280",
    marginTop: 4,
  },

  notificationBtn: {
    backgroundColor: "#F3F4F6",
    padding: 10,
    borderRadius: 50,
  },

  // ==========================================
  // SEARCH
  // ==========================================

  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingHorizontal: 15,
    paddingVertical: 12,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
    marginBottom: 20,
  },

  searchIcon: {
    marginRight: 10,
  },

  searchText: {
    flex: 1,
    color: "#9CA3AF",
    fontSize: 16,
  },

  micBtn: {
    backgroundColor: "#2563EB",
    padding: 8,
    borderRadius: 20,
  },

  // ==========================================
  // CURRENT LOCATION
  // ==========================================

  locationCard: {
    backgroundColor: "#3B82F6",
    borderRadius: 20,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 30,
    shadowColor: "#2563EB",
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },

  locationIconBox: {
    backgroundColor: "#FFFFFF",
    padding: 12,
    borderRadius: 50,
    marginRight: 15,
  },

  locationTextContainer: {
    flex: 1,
  },

  currentLocLabel: {
    color: "#DBEAFE",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 4,
  },

  currentLocTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "bold",
  },

  currentLocSubtitle: {
    color: "#DBEAFE",
    fontSize: 14,
    marginTop: 2,
  },

  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 5,
  },

  loadingText: {
    color: "#FFFFFF",
    fontSize: 14,
    marginLeft: 8,
  },

  // ==========================================
  // SECTION
  // ==========================================

  sectionHeader: {
    flexDirection: "row",
    justifyContent:
      "space-between",
    alignItems: "center",
    marginBottom: 15,
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#111827",
    marginBottom: 15,
  },

  seeAll: {
    color: "#2563EB",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 15,
  },

  // ==========================================
  // ROW
  // ==========================================

  row: {
    flexDirection: "row",
    justifyContent:
      "space-between",
    flexWrap: "wrap",
    marginBottom: 25,
  },

  // ==========================================
  // ACTION CARDS
  // ==========================================

  actionCard: {
    width: "23%",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },

  // ==========================================
  // NEARBY CARDS
  // ==========================================

  placeCard: {
    width: "23%",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },

  // ==========================================
  // ICON
  // ==========================================

  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent:
      "center",
    alignItems: "center",
    marginBottom: 10,
  },

  // ==========================================
  // TEXT
  // ==========================================

  actionTitle: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#374151",
    textAlign: "center",
  },

  actionSubtitle: {
    fontSize: 10,
    color: "#9CA3AF",
    marginTop: 4,
    textAlign: "center",
  },

});