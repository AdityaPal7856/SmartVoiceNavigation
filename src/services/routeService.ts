import axios from "axios";

const GOOGLE_ROUTES_API =
  "https://routes.googleapis.com/directions/v2:computeRoutes";

const GOOGLE_MAPS_API_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

export interface TrafficRouteResult {
  distanceMeters: number;
  durationSeconds: number;
  staticDurationSeconds?: number;
  trafficDelaySeconds: number;
  trafficLevel: "LOW" | "MEDIUM" | "HIGH";
  durationText: string;
  delayText: string;
}

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);

  if (minutes < 60) {
    return `${minutes} minutes`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return `${hours} hour${hours > 1 ? "s" : ""}`;
  }

  return `${hours} hour${hours > 1 ? "s" : ""} ${remainingMinutes} minutes`;
}

function getTrafficLevel(delaySeconds: number): TrafficRouteResult["trafficLevel"] {
  const delayMinutes = delaySeconds / 60;

  if (delayMinutes <= 5) {
    return "LOW";
  }

  if (delayMinutes <= 15) {
    return "MEDIUM";
  }

  return "HIGH";
}

export async function getTrafficRoute(
  origin: {
    latitude: number;
    longitude: number;
  },
  destination: {
    latitude: number;
    longitude: number;
  }
): Promise<TrafficRouteResult> {
  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error(
      "Google Maps API key is missing. Add EXPO_PUBLIC_GOOGLE_MAPS_API_KEY to .env"
    );
  }

  const response = await axios.post(
    GOOGLE_ROUTES_API,
    {
      origin: {
        location: {
          latLng: {
            latitude: origin.latitude,
            longitude: origin.longitude,
          },
        },
      },

      destination: {
        location: {
          latLng: {
            latitude: destination.latitude,
            longitude: destination.longitude,
          },
        },
      },

      travelMode: "DRIVE",

      routingPreference: "TRAFFIC_AWARE",

      departureTime: new Date().toISOString(),

      computeAlternativeRoutes: false,

      languageCode: "en-US",

      units: "METRIC",
    },
    {
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,

        "X-Goog-FieldMask":
          "routes.duration,routes.staticDuration,routes.distanceMeters",
      },
    }
  );

  const route = response.data?.routes?.[0];

  if (!route) {
    throw new Error("No route found");
  }

  const durationSeconds = parseDuration(route.duration);

  const staticDurationSeconds = route.staticDuration
    ? parseDuration(route.staticDuration)
    : durationSeconds;

  const trafficDelaySeconds = Math.max(
    0,
    durationSeconds - staticDurationSeconds
  );

  const trafficLevel = getTrafficLevel(
    trafficDelaySeconds
  );

  return {
    distanceMeters: route.distanceMeters || 0,

    durationSeconds,

    staticDurationSeconds,

    trafficDelaySeconds,

    trafficLevel,

    durationText: formatDuration(
      durationSeconds
    ),

    delayText: formatDuration(
      trafficDelaySeconds
    ),
  };
}

function parseDuration(duration: string): number {
  if (!duration) {
    return 0;
  }

  // Google duration normally looks like "123s"
  const seconds = Number(
    duration.replace("s", "")
  );

  return Number.isFinite(seconds)
    ? seconds
    : 0;
}