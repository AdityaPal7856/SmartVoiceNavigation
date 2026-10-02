import React, { useEffect, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ScrollView,
  ActivityIndicator,
  Linking,
} from "react-native";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

import { auth, db } from "../firebase";

const EMERGENCY_CONTACTS_CACHE_KEY = "@smart_voice_navigation_emergency_contacts";

type Contact = {
  id: string;
  name: string;
  relation: string;
  phone: string;
};

export default function EmergencyContacts() {
  const [user, setUser] = useState<any>(null);

  const [contacts, setContacts] =
    useState<Contact[]>([]);

  const [name, setName] = useState("");
  const [relation, setRelation] =
    useState("");
  const [phone, setPhone] = useState("");

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  // ==========================================
  // LOAD CONTACTS
  // ==========================================

  useEffect(() => {
    let mounted = true;

    const loadContacts = async () => {
      // Cache-first: contacts remain visible even when Firebase is temporarily offline.
      try {
        const cached = await AsyncStorage.getItem(
          EMERGENCY_CONTACTS_CACHE_KEY
        );
        if (cached && mounted) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) {
            setContacts(parsed);
          }
        }
      } catch (error) {
        console.log("[Emergency] Local cache load error:", error);
      }

      const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
        if (!mounted) return;

        setUser(currentUser);

        if (!currentUser) {
          setLoading(false);
          return;
        }

        try {
          const ref = doc(db, "users", currentUser.uid);
          const snap = await getDoc(ref);

          if (!snap.exists()) {
            setLoading(false);
            return;
          }

          const data = snap.data();
          let nextContacts: Contact[] | null = null;

          if (Array.isArray(data.emergencyContacts)) {
            nextContacts = data.emergencyContacts as Contact[];
          } else if (data.emergencyContact) {
            // Backward compatibility with the old single-contact format.
            nextContacts = [
              {
                id: "default",
                name: data.emergencyContact.name || "",
                relation:
                  data.emergencyContact.relation || "Emergency Contact",
                phone: data.emergencyContact.phone || "",
              },
            ];
          }

          if (nextContacts && mounted) {
            setContacts(nextContacts);
            await AsyncStorage.setItem(
              EMERGENCY_CONTACTS_CACHE_KEY,
              JSON.stringify(nextContacts)
            );
          }
        } catch (error) {
          console.log("[Emergency] Firebase load error:", error);
        } finally {
          if (mounted) setLoading(false);
        }
      });

      return unsubscribe;
    };

    let unsubscribe: (() => void) | undefined;

    void loadContacts().then((cleanup) => {
      unsubscribe = cleanup;
    });

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  // ==========================================
  // SAVE CONTACTS
  // ==========================================

  async function saveContacts(
    nextContacts: Contact[]
  ) {
    if (!user) return;

    // Update UI and local cache immediately.
    setContacts(nextContacts);

    try {
      await AsyncStorage.setItem(
        EMERGENCY_CONTACTS_CACHE_KEY,
        JSON.stringify(nextContacts)
      );
    } catch (error) {
      console.warn("[Emergency] Local cache save failed:", error);
    }

    try {
      // Save to Firebase in the background.
      await setDoc(
        doc(db, "users", user.uid),
        {
          emergencyContacts:
            nextContacts,

          updatedAt:
            serverTimestamp(),
        },
        {
          merge: true,
        }
      );

      console.log(
        "[Emergency] Contacts saved successfully"
      );
    } catch (error) {
      console.error(
        "[Emergency] Firebase save failed:",
        error
      );

      Alert.alert(
        "Save Failed",
        "Contact could not be saved to Firebase. Please check your internet connection and try again."
      );
    }
  }

  // ==========================================
  // CALL / SMS CONTACT
  // ==========================================

  async function callContact(contact: Contact) {
    const url = `tel:${contact.phone}`;

    try {
      const supported = await Linking.canOpenURL(url);

      if (!supported) {
        Alert.alert(
          "Call Unavailable",
          "Your device cannot open the phone dialer."
        );
        return;
      }

      await Linking.openURL(url);
    } catch (error) {
      console.error("[Emergency] Call error:", error);
      Alert.alert("Error", "Unable to open the phone dialer.");
    }
  }

  async function messageContact(contact: Contact) {
    const body =
      "Emergency: I may need help. Please contact me as soon as possible.";

    const url =
      `sms:${contact.phone}?body=${encodeURIComponent(body)}`;

    try {
      const supported = await Linking.canOpenURL(url);

      if (!supported) {
        Alert.alert(
          "SMS Unavailable",
          "Your device cannot open the SMS application."
        );
        return;
      }

      await Linking.openURL(url);
    } catch (error) {
      console.error("[Emergency] SMS error:", error);
      Alert.alert("Error", "Unable to open the SMS application.");
    }
  }

  // ==========================================
  // ADD CONTACT
  // ==========================================

  async function addContact() {
    if (!name.trim()) {
      Alert.alert(
        "Name Required",
        "Please enter contact name."
      );
      return;
    }

    const cleanedPhone =
      phone.replace(/[\s-]/g, "");

    let normalizedPhone = "";

    if (
      /^\+91\d{10}$/.test(
        cleanedPhone
      )
    ) {
      normalizedPhone =
        cleanedPhone;
    } else if (
      /^91\d{10}$/.test(
        cleanedPhone
      )
    ) {
      normalizedPhone =
        `+${cleanedPhone}`;
    } else if (
      /^\d{10}$/.test(
        cleanedPhone
      )
    ) {
      normalizedPhone =
        `+91${cleanedPhone}`;
    } else {
      Alert.alert(
        "Invalid Number",
        "Please enter a valid 10 digit mobile number."
      );
      return;
    }

    setSaving(true);

    try {
      const newContact: Contact = {
        id:
          Date.now().toString(),

        name: name.trim(),

        relation:
          relation.trim() ||
          "Emergency Contact",

        phone: normalizedPhone,
      };

      const nextContacts = [
        ...contacts,
        newContact,
      ];

      await saveContacts(
        nextContacts
      );

      setName("");
      setRelation("");
      setPhone("");

      Alert.alert(
        "Success",
        "Emergency contact added."
      );
    } catch (error: any) {
      console.error(
        "[Emergency] Add error:",
        error
      );

      Alert.alert(
        "Error",
        error?.message ||
          "Unable to save contact."
      );
    } finally {
      setSaving(false);
    }
  }

  // ==========================================
  // DELETE CONTACT
  // ==========================================

  function deleteContact(
    contact: Contact
  ) {
    Alert.alert(
      "Delete Contact",
      `Remove ${contact.name} from emergency contacts?`,
      [
        {
          text: "Cancel",
          style: "cancel",
        },

        {
          text: "Delete",
          style: "destructive",

          onPress: async () => {
            try {
              const nextContacts =
                contacts.filter(
                  (item) =>
                    item.id !==
                    contact.id
                );

              await saveContacts(
                nextContacts
              );
            } catch (error: any) {
              Alert.alert(
                "Error",
                error?.message ||
                  "Unable to delete contact."
              );
            }
          },
        },
      ]
    );
  }

  // ==========================================
  // LOADING
  // ==========================================

  if (loading) {
    return (
      <SafeAreaView
        style={styles.center}
      >
        <ActivityIndicator
          size="large"
          color="#2874F0"
        />

        <Text style={styles.loadingText}>
          Loading contacts...
        </Text>
      </SafeAreaView>
    );
  }

  // ==========================================
  // SCREEN
  // ==========================================

  return (
    <SafeAreaView
      style={styles.container}
    >

      {/* HEADER */}

      <View style={styles.header}>

        <TouchableOpacity
          onPress={() =>
            router.back()
          }
        >
          <Ionicons
            name="chevron-back"
            size={28}
            color="#111827"
          />
        </TouchableOpacity>

        <Text style={styles.title}>
          Emergency Contacts
        </Text>

        <View
          style={{ width: 28 }}
        />

      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={
          styles.form
        }
      >

        {/* INFO */}

        <View style={styles.infoCard}>

          <View
            style={styles.infoIcon}
          >
            <Ionicons
              name="shield-checkmark-outline"
              size={27}
              color="#EF4444"
            />
          </View>

          <Text style={styles.infoText}>
            Add trusted people who can
            be called or messaged
            during an emergency.
          </Text>

        </View>

        {/* EXISTING CONTACTS */}

        {contacts.length > 0 && (
          <>
            <Text
              style={styles.sectionTitle}
            >
              Your Emergency Contacts
            </Text>

            {contacts.map(
              (contact) => (
                <View
                  key={contact.id}
                  style={styles.contactCard}
                >

                  <View
                    style={styles.contactAvatar}
                  >
                    <Ionicons
                      name="person"
                      size={22}
                      color="#2874F0"
                    />
                  </View>

                  <View
                    style={
                      styles.contactInfo
                    }
                  >

                    <Text
                      style={
                        styles.contactName
                      }
                    >
                      {contact.name}
                    </Text>

                    <Text
                      style={
                        styles.contactRelation
                      }
                    >
                      {contact.relation}
                    </Text>

                    <Text
                      style={
                        styles.contactPhone
                      }
                    >
                      {contact.phone}
                    </Text>

                  </View>

                  <View style={styles.contactActions}>
                    <TouchableOpacity
                      onPress={() => callContact(contact)}
                      style={styles.actionButton}
                      accessibilityLabel={`Call ${contact.name}`}
                    >
                      <Ionicons
                        name="call-outline"
                        size={20}
                        color="#16A34A"
                      />
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => messageContact(contact)}
                      style={styles.actionButton}
                      accessibilityLabel={`Message ${contact.name}`}
                    >
                      <Ionicons
                        name="chatbubble-outline"
                        size={20}
                        color="#2874F0"
                      />
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => editContact(contact)}
                      style={styles.actionButton}
                      accessibilityLabel={`Edit ${contact.name}`}
                    >
                      <Ionicons
                        name="create-outline"
                        size={20}
                        color="#F59E0B"
                      />
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => deleteContact(contact)}
                      style={styles.actionButton}
                      accessibilityLabel={`Delete ${contact.name}`}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={20}
                        color="#EF4444"
                      />
                    </TouchableOpacity>
                  </View>

                </View>
              )
            )}
          </>
        )}

        {/* ADD CONTACT */}

        <Text
          style={styles.sectionTitle}
        >
          Add Emergency Contact
        </Text>

        <Field
          label="Contact Name"
          icon="person-outline"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Father"
        />

        <Field
          label="Relation"
          icon="people-outline"
          value={relation}
          onChangeText={setRelation}
          placeholder="e.g. Father, Mother"
        />

        <Field
          label="Mobile Number"
          icon="call-outline"
          value={phone}
          onChangeText={setPhone}
          placeholder="10 digit mobile number"
          keyboardType="phone-pad"
        />

        {/* ADD BUTTON */}

        <TouchableOpacity
          style={styles.addButton}
          onPress={addContact}
          disabled={saving}
          activeOpacity={0.8}
        >

          {saving ? (
            <ActivityIndicator
              color="#FFFFFF"
            />
          ) : (
            <>
              <Ionicons
                name="add"
                size={22}
                color="#FFFFFF"
              />

              <Text
                style={styles.addButtonText}
              >
                Add Contact
              </Text>
            </>
          )}

        </TouchableOpacity>

      </ScrollView>

    </SafeAreaView>
  );
}

// ==========================================
// INPUT FIELD
// ==========================================

function Field({
  label,
  icon,
  value,
  onChangeText,
  placeholder,
  keyboardType,
}: any) {
  return (
    <View style={styles.field}>

      <Text style={styles.label}>
        {label}
      </Text>

      <View
        style={styles.inputBox}
      >

        <Ionicons
          name={icon}
          size={20}
          color="#6B7280"
        />

        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#9CA3AF"
          keyboardType={keyboardType}
        />

      </View>

    </View>
  );
}

// ==========================================
// STYLES
// ==========================================

const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: "#F7F8FA",
  },

  center: {
    flex: 1,
    backgroundColor: "#F7F8FA",
    justifyContent: "center",
    alignItems: "center",
  },

  loadingText: {
    marginTop: 10,
    color: "#6B7280",
  },

  header: {
    height: 66,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  title: {
    fontSize: 21,
    fontWeight: "700",
    color: "#111827",
  },

  form: {
    padding: 20,
    paddingBottom: 45,
  },

  infoCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 17,
    padding: 17,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 22,
    elevation: 2,
  },

  infoIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#FFF0F0",
    justifyContent: "center",
    alignItems: "center",
  },

  infoText: {
    flex: 1,
    marginLeft: 13,
    fontSize: 14,
    lineHeight: 20,
    color: "#6B7280",
  },

  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 11,
    marginTop: 5,
  },

  contactCard: {
    minHeight: 82,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    elevation: 2,
  },

  contactAvatar: {
    width: 47,
    height: 47,
    borderRadius: 24,
    backgroundColor: "#EAF2FF",
    justifyContent: "center",
    alignItems: "center",
  },

  contactInfo: {
    flex: 1,
    marginLeft: 12,
  },

  contactName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
  },

  contactRelation: {
    fontSize: 13,
    color: "#6B7280",
    marginTop: 3,
  },

  contactPhone: {
    fontSize: 13,
    color: "#6B7280",
    marginTop: 2,
  },

  contactActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },

  actionButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F7F8FA",
  },

  field: {
    marginBottom: 15,
  },

  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 8,
  },

  inputBox: {
    minHeight: 53,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
  },

  input: {
    flex: 1,
    fontSize: 15,
    marginLeft: 11,
    color: "#111827",
  },

  addButton: {
    minHeight: 53,
    borderRadius: 14,
    backgroundColor: "#2874F0",
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    marginTop: 5,
  },

  addButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },

});