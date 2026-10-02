import axios from "axios";

const API_KEY = process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY;

export const getWeatherByCoordinates = async (latitude, longitude) => {
  if (!API_KEY) {
    throw new Error("Weather API key missing");
  }

  const response = await axios.get(
    "https://api.openweathermap.org/data/2.5/weather",
    {
      params: {
        lat: latitude,
        lon: longitude,
        appid: API_KEY,
        units: "metric",
      },
    }
  );

  const data = response.data;

  return {
    city: data.name,
    temperature: Math.round(data.main.temp),
    feelsLike: Math.round(data.main.feels_like),
    humidity: data.main.humidity,
    description: data.weather?.[0]?.description || "Unknown",
  };
};