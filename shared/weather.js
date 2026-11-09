const weatherCache = new Map();
const weatherCacheDuration = 10 * 60 * 1000;

export async function getWeatherForecast(latitude, longitude, key) {
  const cacheKey = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
  const cached = weatherCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const endpoint = new URL('https://api.weatherapi.com/v1/forecast.json');
  endpoint.search = new URLSearchParams({
    key,
    q: `${latitude},${longitude}`,
    days: '3',
    aqi: 'no',
    alerts: 'no',
    lang: 'pt'
  }).toString();
  let providerResponse;
  try {
    providerResponse = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
  } catch (error) {
    console.error('WeatherAPI request failed', { message: error.message });
    throw Object.assign(new Error('O serviço de previsão do tempo está indisponível. Tente novamente mais tarde.'), { statusCode: 502 });
  }
  if (!providerResponse.ok) {
    console.error('WeatherAPI rejected request', { status: providerResponse.status });
    throw Object.assign(new Error('Não foi possível obter a previsão do tempo. Confira a chave e a cota do WeatherAPI.'), { statusCode: 502 });
  }

  let providerData;
  try {
    providerData = await providerResponse.json();
  } catch (error) {
    console.error('WeatherAPI returned invalid JSON', { message: error.message });
    throw Object.assign(new Error('O serviço de previsão retornou dados inválidos.'), { statusCode: 502 });
  }
  if (!providerData.location || !providerData.current || !Array.isArray(providerData.forecast?.forecastday)) {
    console.error('WeatherAPI returned an invalid forecast response');
    throw Object.assign(new Error('O serviço de previsão retornou dados inválidos.'), { statusCode: 502 });
  }

  const data = {
    location: providerData.location.name,
    current: {
      temperatureC: providerData.current.temp_c,
      condition: providerData.current.condition?.text || ''
    },
    days: providerData.forecast.forecastday.map(day => ({
      date: day.date,
      minC: day.day?.mintemp_c,
      maxC: day.day?.maxtemp_c,
      condition: day.day?.condition?.text || '',
      rainChance: day.day?.daily_chance_of_rain,
      precipitationMm: day.day?.totalprecip_mm
    }))
  };
  weatherCache.set(cacheKey, { data, expiresAt: Date.now() + weatherCacheDuration });
  return data;
}
