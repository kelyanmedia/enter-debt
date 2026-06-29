export type ClientGeoOption = {
  code: string
  name: string
  lat: number
  lng: number
}

export const DEFAULT_CLIENT_GEO = 'UZ'

export const CLIENT_GEO_OPTIONS: ClientGeoOption[] = [
  { code: 'UZ', name: 'Узбекистан', lat: 41.38, lng: 64.59 },
  { code: 'KZ', name: 'Казахстан', lat: 48.02, lng: 66.92 },
  { code: 'RU', name: 'Россия', lat: 55.76, lng: 37.62 },
  { code: 'KG', name: 'Кыргызстан', lat: 41.20, lng: 74.77 },
  { code: 'TJ', name: 'Таджикистан', lat: 38.86, lng: 71.28 },
  { code: 'TM', name: 'Туркменистан', lat: 37.96, lng: 58.33 },
  { code: 'AZ', name: 'Азербайджан', lat: 40.41, lng: 49.87 },
  { code: 'TR', name: 'Турция', lat: 39.93, lng: 32.86 },
  { code: 'AE', name: 'ОАЭ', lat: 23.42, lng: 53.85 },
  { code: 'SA', name: 'Саудовская Аравия', lat: 23.89, lng: 45.08 },
  { code: 'DE', name: 'Германия', lat: 51.17, lng: 10.45 },
  { code: 'US', name: 'США', lat: 37.09, lng: -95.71 },
  { code: 'CA', name: 'Канада', lat: 56.13, lng: -106.35 },
  { code: 'AU', name: 'Австралия', lat: -25.27, lng: 133.78 },
  { code: 'NP', name: 'Непал', lat: 28.39, lng: 84.12 },
  { code: 'CN', name: 'Китай', lat: 35.86, lng: 104.20 },
  { code: 'IN', name: 'Индия', lat: 20.59, lng: 78.96 },
  { code: 'GB', name: 'Великобритания', lat: 55.38, lng: -3.44 },
  { code: 'FR', name: 'Франция', lat: 46.23, lng: 2.21 },
  { code: 'OTHER', name: 'Другое', lat: 20, lng: 0 },
]

const geoByCode = new Map(CLIENT_GEO_OPTIONS.map((g) => [g.code, g]))

export function clientGeoName(code: string | null | undefined) {
  if (!code) return 'Узбекистан'
  return geoByCode.get(code)?.name || code
}

export function projectGeo(lat: number, lng: number, w = 360, h = 180) {
  return {
    x: ((lng + 180) / 360) * w,
    y: ((90 - lat) / 180) * h,
  }
}
