// Static currency data: display info + country and major-city names for
// search. decimals follows common cash conventions (not strict ISO 4217).
// City names are stored unaccented to match what people actually type.

export const CURRENCIES = {
  // --- Europe ---
  EUR: { name: "Euro", symbol: "€", decimals: 2, flag: "🇪🇺",
    countries: ["France", "Germany", "Netherlands", "Spain", "Italy", "Portugal", "Greece", "Austria", "Belgium", "Ireland", "Finland", "Croatia", "Slovakia", "Slovenia", "Estonia", "Latvia", "Lithuania", "Luxembourg", "Malta", "Cyprus"],
    cities: ["Paris", "Amsterdam", "Berlin", "Rome", "Madrid", "Barcelona", "Lisbon", "Athens", "Vienna", "Dublin", "Brussels", "Milan", "Venice", "Florence", "Munich", "Nice", "Santorini", "Helsinki", "Dubrovnik", "Porto", "Seville"] },
  GBP: { name: "British Pound", symbol: "£", decimals: 2, flag: "🇬🇧", countries: ["United Kingdom", "England", "Scotland", "Wales"],
    cities: ["London", "Edinburgh", "Manchester", "Glasgow", "Liverpool"] },
  CHF: { name: "Swiss Franc", symbol: "Fr", decimals: 2, flag: "🇨🇭", countries: ["Switzerland", "Liechtenstein"],
    cities: ["Zurich", "Geneva", "Interlaken", "Zermatt", "Lucerne", "Basel"] },
  CZK: { name: "Czech Koruna", symbol: "Kč", decimals: 2, flag: "🇨🇿", countries: ["Czech Republic", "Czechia"],
    cities: ["Prague", "Brno", "Cesky Krumlov"] },
  HUF: { name: "Hungarian Forint", symbol: "Ft", decimals: 0, flag: "🇭🇺", countries: ["Hungary"],
    cities: ["Budapest"] },
  PLN: { name: "Polish Złoty", symbol: "zł", decimals: 2, flag: "🇵🇱", countries: ["Poland"],
    cities: ["Warsaw", "Krakow", "Gdansk", "Wroclaw", "Zakopane"] },
  RON: { name: "Romanian Leu", symbol: "lei", decimals: 2, flag: "🇷🇴", countries: ["Romania"],
    cities: ["Bucharest", "Brasov", "Cluj", "Transylvania"] },
  BGN: { name: "Bulgarian Lev", symbol: "лв", decimals: 2, flag: "🇧🇬", countries: ["Bulgaria"],
    cities: ["Sofia", "Plovdiv", "Varna"] },
  SEK: { name: "Swedish Krona", symbol: "kr", decimals: 2, flag: "🇸🇪", countries: ["Sweden"],
    cities: ["Stockholm", "Gothenburg", "Malmo"] },
  NOK: { name: "Norwegian Krone", symbol: "kr", decimals: 2, flag: "🇳🇴", countries: ["Norway"],
    cities: ["Oslo", "Bergen", "Tromso", "Lofoten"] },
  DKK: { name: "Danish Krone", symbol: "kr", decimals: 2, flag: "🇩🇰", countries: ["Denmark"],
    cities: ["Copenhagen", "Aarhus"] },
  ISK: { name: "Icelandic Króna", symbol: "kr", decimals: 0, flag: "🇮🇸", countries: ["Iceland"],
    cities: ["Reykjavik"] },
  TRY: { name: "Turkish Lira", symbol: "₺", decimals: 2, flag: "🇹🇷", countries: ["Turkey", "Türkiye"],
    cities: ["Istanbul", "Antalya", "Cappadocia", "Ankara", "Izmir", "Bodrum"] },
  RSD: { name: "Serbian Dinar", symbol: "дин", decimals: 0, flag: "🇷🇸", countries: ["Serbia"],
    cities: ["Belgrade", "Novi Sad"] },
  ALL: { name: "Albanian Lek", symbol: "L", decimals: 0, flag: "🇦🇱", countries: ["Albania"],
    cities: ["Tirana", "Saranda"] },
  BAM: { name: "Bosnian Mark", symbol: "KM", decimals: 2, flag: "🇧🇦", countries: ["Bosnia and Herzegovina"],
    cities: ["Sarajevo", "Mostar"] },
  GEL: { name: "Georgian Lari", symbol: "₾", decimals: 2, flag: "🇬🇪", countries: ["Georgia"],
    cities: ["Tbilisi", "Batumi"] },
  RUB: { name: "Russian Ruble", symbol: "₽", decimals: 2, flag: "🇷🇺", countries: ["Russia"],
    cities: ["Moscow", "Saint Petersburg"] },

  // --- South & Central Asia ---
  INR: { name: "Indian Rupee", symbol: "₹", decimals: 2, flag: "🇮🇳", countries: ["India"],
    cities: ["Delhi", "Mumbai", "Goa", "Jaipur", "Bangalore", "Kolkata", "Chennai", "Udaipur", "Varanasi"] },
  LKR: { name: "Sri Lankan Rupee", symbol: "Rs", decimals: 2, flag: "🇱🇰", countries: ["Sri Lanka"],
    cities: ["Colombo", "Kandy", "Galle", "Ella", "Sigiriya"] },
  NPR: { name: "Nepalese Rupee", symbol: "Rs", decimals: 2, flag: "🇳🇵", countries: ["Nepal"],
    cities: ["Kathmandu", "Pokhara"] },
  BDT: { name: "Bangladeshi Taka", symbol: "৳", decimals: 2, flag: "🇧🇩", countries: ["Bangladesh"],
    cities: ["Dhaka"] },
  PKR: { name: "Pakistani Rupee", symbol: "Rs", decimals: 2, flag: "🇵🇰", countries: ["Pakistan"],
    cities: ["Karachi", "Lahore", "Islamabad"] },
  MVR: { name: "Maldivian Rufiyaa", symbol: "Rf", decimals: 2, flag: "🇲🇻", countries: ["Maldives"],
    cities: ["Male"] },
  KZT: { name: "Kazakhstani Tenge", symbol: "₸", decimals: 0, flag: "🇰🇿", countries: ["Kazakhstan"],
    cities: ["Almaty", "Astana"] },
  UZS: { name: "Uzbekistani Som", symbol: "so'm", decimals: 0, flag: "🇺🇿", countries: ["Uzbekistan"],
    cities: ["Tashkent", "Samarkand", "Bukhara"] },
  AMD: { name: "Armenian Dram", symbol: "֏", decimals: 0, flag: "🇦🇲", countries: ["Armenia"],
    cities: ["Yerevan"] },
  AZN: { name: "Azerbaijani Manat", symbol: "₼", decimals: 2, flag: "🇦🇿", countries: ["Azerbaijan"],
    cities: ["Baku"] },

  // --- East & Southeast Asia ---
  JPY: { name: "Japanese Yen", symbol: "¥", decimals: 0, flag: "🇯🇵", countries: ["Japan"],
    cities: ["Tokyo", "Osaka", "Kyoto", "Sapporo", "Fukuoka", "Nara", "Hiroshima", "Okinawa"] },
  CNY: { name: "Chinese Yuan", symbol: "¥", decimals: 2, flag: "🇨🇳", countries: ["China"],
    cities: ["Beijing", "Shanghai", "Guangzhou", "Shenzhen", "Chengdu", "Xian"] },
  HKD: { name: "Hong Kong Dollar", symbol: "HK$", decimals: 2, flag: "🇭🇰", countries: ["Hong Kong"],
    cities: ["Kowloon"] },
  TWD: { name: "New Taiwan Dollar", symbol: "NT$", decimals: 0, flag: "🇹🇼", countries: ["Taiwan"],
    cities: ["Taipei", "Kaohsiung"] },
  KRW: { name: "South Korean Won", symbol: "₩", decimals: 0, flag: "🇰🇷", countries: ["South Korea", "Korea"],
    cities: ["Seoul", "Busan", "Jeju"] },
  THB: { name: "Thai Baht", symbol: "฿", decimals: 2, flag: "🇹🇭", countries: ["Thailand"],
    cities: ["Bangkok", "Phuket", "Chiang Mai", "Pattaya", "Krabi", "Koh Samui", "Koh Phangan"] },
  VND: { name: "Vietnamese Dong", symbol: "₫", decimals: 0, flag: "🇻🇳", countries: ["Vietnam"],
    cities: ["Hanoi", "Ho Chi Minh City", "Saigon", "Da Nang", "Hoi An", "Nha Trang", "Phu Quoc"] },
  IDR: { name: "Indonesian Rupiah", symbol: "Rp", decimals: 0, flag: "🇮🇩", countries: ["Indonesia", "Bali"],
    cities: ["Jakarta", "Ubud", "Kuta", "Yogyakarta", "Lombok", "Canggu", "Seminyak"] },
  MYR: { name: "Malaysian Ringgit", symbol: "RM", decimals: 2, flag: "🇲🇾", countries: ["Malaysia"],
    cities: ["Kuala Lumpur", "Penang", "Langkawi", "Kota Kinabalu", "Malacca"] },
  SGD: { name: "Singapore Dollar", symbol: "S$", decimals: 2, flag: "🇸🇬", countries: ["Singapore"] },
  PHP: { name: "Philippine Peso", symbol: "₱", decimals: 2, flag: "🇵🇭", countries: ["Philippines"],
    cities: ["Manila", "Cebu", "Boracay", "Palawan", "El Nido", "Siargao"] },
  KHR: { name: "Cambodian Riel", symbol: "៛", decimals: 0, flag: "🇰🇭", countries: ["Cambodia"],
    cities: ["Phnom Penh", "Siem Reap", "Angkor"] },
  LAK: { name: "Lao Kip", symbol: "₭", decimals: 0, flag: "🇱🇦", countries: ["Laos"],
    cities: ["Vientiane", "Luang Prabang", "Vang Vieng"] },
  MMK: { name: "Myanmar Kyat", symbol: "K", decimals: 0, flag: "🇲🇲", countries: ["Myanmar", "Burma"],
    cities: ["Yangon", "Mandalay", "Bagan"] },
  MNT: { name: "Mongolian Tögrög", symbol: "₮", decimals: 0, flag: "🇲🇳", countries: ["Mongolia"],
    cities: ["Ulaanbaatar"] },

  // --- Middle East ---
  AED: { name: "UAE Dirham", symbol: "د.إ", decimals: 2, flag: "🇦🇪", countries: ["United Arab Emirates", "Dubai", "Abu Dhabi"],
    cities: ["Sharjah", "Ras Al Khaimah"] },
  SAR: { name: "Saudi Riyal", symbol: "﷼", decimals: 2, flag: "🇸🇦", countries: ["Saudi Arabia"],
    cities: ["Riyadh", "Jeddah", "Mecca", "Medina"] },
  QAR: { name: "Qatari Riyal", symbol: "﷼", decimals: 2, flag: "🇶🇦", countries: ["Qatar"],
    cities: ["Doha"] },
  OMR: { name: "Omani Rial", symbol: "﷼", decimals: 3, flag: "🇴🇲", countries: ["Oman"],
    cities: ["Muscat", "Salalah"] },
  BHD: { name: "Bahraini Dinar", symbol: "BD", decimals: 3, flag: "🇧🇭", countries: ["Bahrain"],
    cities: ["Manama"] },
  KWD: { name: "Kuwaiti Dinar", symbol: "KD", decimals: 3, flag: "🇰🇼", countries: ["Kuwait"],
    cities: ["Kuwait City"] },
  JOD: { name: "Jordanian Dinar", symbol: "JD", decimals: 3, flag: "🇯🇴", countries: ["Jordan"],
    cities: ["Amman", "Petra", "Aqaba", "Wadi Rum"] },
  ILS: { name: "Israeli New Shekel", symbol: "₪", decimals: 2, flag: "🇮🇱", countries: ["Israel"],
    cities: ["Tel Aviv", "Jerusalem", "Eilat"] },

  // --- Africa ---
  EGP: { name: "Egyptian Pound", symbol: "E£", decimals: 2, flag: "🇪🇬", countries: ["Egypt"],
    cities: ["Cairo", "Luxor", "Aswan", "Sharm El Sheikh", "Hurghada", "Alexandria"] },
  MAD: { name: "Moroccan Dirham", symbol: "DH", decimals: 2, flag: "🇲🇦", countries: ["Morocco"],
    cities: ["Marrakech", "Casablanca", "Fes", "Tangier", "Chefchaouen"] },
  TND: { name: "Tunisian Dinar", symbol: "DT", decimals: 3, flag: "🇹🇳", countries: ["Tunisia"],
    cities: ["Tunis", "Sousse"] },
  ZAR: { name: "South African Rand", symbol: "R", decimals: 2, flag: "🇿🇦", countries: ["South Africa"],
    cities: ["Cape Town", "Johannesburg", "Durban", "Kruger"] },
  KES: { name: "Kenyan Shilling", symbol: "KSh", decimals: 0, flag: "🇰🇪", countries: ["Kenya"],
    cities: ["Nairobi", "Mombasa", "Masai Mara"] },
  TZS: { name: "Tanzanian Shilling", symbol: "TSh", decimals: 0, flag: "🇹🇿", countries: ["Tanzania", "Zanzibar"],
    cities: ["Dar es Salaam", "Arusha", "Kilimanjaro", "Serengeti"] },
  MUR: { name: "Mauritian Rupee", symbol: "Rs", decimals: 2, flag: "🇲🇺", countries: ["Mauritius"],
    cities: ["Port Louis"] },
  SCR: { name: "Seychellois Rupee", symbol: "Rs", decimals: 2, flag: "🇸🇨", countries: ["Seychelles"],
    cities: ["Mahe", "Praslin"] },

  // --- Americas ---
  USD: { name: "US Dollar", symbol: "$", decimals: 2, flag: "🇺🇸", countries: ["United States", "America", "Ecuador", "Panama"],
    cities: ["New York", "Los Angeles", "San Francisco", "Las Vegas", "Miami", "Chicago", "Hawaii", "Orlando", "Seattle", "Boston", "Washington"] },
  CAD: { name: "Canadian Dollar", symbol: "C$", decimals: 2, flag: "🇨🇦", countries: ["Canada"],
    cities: ["Toronto", "Vancouver", "Montreal", "Quebec City", "Calgary", "Banff"] },
  MXN: { name: "Mexican Peso", symbol: "Mex$", decimals: 2, flag: "🇲🇽", countries: ["Mexico"],
    cities: ["Mexico City", "Cancun", "Tulum", "Guadalajara", "Playa del Carmen", "Oaxaca"] },
  BRL: { name: "Brazilian Real", symbol: "R$", decimals: 2, flag: "🇧🇷", countries: ["Brazil"],
    cities: ["Rio de Janeiro", "Sao Paulo", "Salvador", "Iguazu"] },
  ARS: { name: "Argentine Peso", symbol: "AR$", decimals: 2, flag: "🇦🇷", countries: ["Argentina"],
    cities: ["Buenos Aires", "Mendoza", "Bariloche", "Ushuaia"] },
  CLP: { name: "Chilean Peso", symbol: "CL$", decimals: 0, flag: "🇨🇱", countries: ["Chile"],
    cities: ["Santiago", "Valparaiso", "Atacama"] },
  COP: { name: "Colombian Peso", symbol: "CO$", decimals: 0, flag: "🇨🇴", countries: ["Colombia"],
    cities: ["Bogota", "Medellin", "Cartagena"] },
  PEN: { name: "Peruvian Sol", symbol: "S/", decimals: 2, flag: "🇵🇪", countries: ["Peru"],
    cities: ["Lima", "Cusco", "Machu Picchu", "Arequipa"] },

  // --- Oceania ---
  AUD: { name: "Australian Dollar", symbol: "A$", decimals: 2, flag: "🇦🇺", countries: ["Australia"],
    cities: ["Sydney", "Melbourne", "Brisbane", "Perth", "Gold Coast", "Cairns", "Adelaide"] },
  NZD: { name: "New Zealand Dollar", symbol: "NZ$", decimals: 2, flag: "🇳🇿", countries: ["New Zealand"],
    cities: ["Auckland", "Queenstown", "Wellington", "Christchurch", "Rotorua"] },
  FJD: { name: "Fijian Dollar", symbol: "FJ$", decimals: 2, flag: "🇫🇯", countries: ["Fiji"],
    cities: ["Suva", "Nadi"] },
};

export const ALL_CODES = Object.keys(CURRENCIES);

// ISO 3166-1 alpha-2 → the currency people actually spend there.
//
// It exists because the app opened in INR for everybody on earth: that
// was the default in the stored settings and nothing anywhere derived a
// better one. A country code is the one thing a locale tag reliably
// carries, so this is the first signal a first launch asks (js/insights.js).
//
// Two rules, both held by tests/currencies.test.mjs rather than by
// anybody remembering them: every value here must be a currency the app
// can actually show, and every currency the app ships must be reachable
// from at least one region — a code no region names is a code this
// feature can never choose.
//
// Dependencies and non-members are included where the currency is what
// you hand over in a shop, not where a peg exists on paper.
export const REGION_CURRENCY = {
  // --- Europe ---
  AT: "EUR", BE: "EUR", HR: "EUR", CY: "EUR", EE: "EUR", FI: "EUR", FR: "EUR",
  DE: "EUR", GR: "EUR", IE: "EUR", IT: "EUR", LV: "EUR", LT: "EUR", LU: "EUR",
  MT: "EUR", NL: "EUR", PT: "EUR", SK: "EUR", SI: "EUR", ES: "EUR",
  AD: "EUR", MC: "EUR", SM: "EUR", VA: "EUR", ME: "EUR",
  GB: "GBP", IM: "GBP", JE: "GBP", GG: "GBP",
  CH: "CHF", LI: "CHF",
  CZ: "CZK", HU: "HUF", PL: "PLN", RO: "RON", BG: "BGN",
  SE: "SEK", NO: "NOK", SJ: "NOK", DK: "DKK", FO: "DKK", GL: "DKK", IS: "ISK",
  TR: "TRY", RS: "RSD", AL: "ALL", BA: "BAM", GE: "GEL", RU: "RUB",

  // --- South & Central Asia ---
  IN: "INR", LK: "LKR", NP: "NPR", BD: "BDT", PK: "PKR", MV: "MVR",
  KZ: "KZT", UZ: "UZS", AM: "AMD", AZ: "AZN",

  // --- East & Southeast Asia ---
  JP: "JPY", CN: "CNY", HK: "HKD", MO: "HKD", TW: "TWD", KR: "KRW",
  TH: "THB", VN: "VND", ID: "IDR", MY: "MYR", SG: "SGD", PH: "PHP",
  KH: "KHR", LA: "LAK", MM: "MMK", MN: "MNT",

  // --- Middle East ---
  AE: "AED", SA: "SAR", QA: "QAR", OM: "OMR", BH: "BHD", KW: "KWD",
  JO: "JOD", IL: "ILS", PS: "ILS",

  // --- Africa ---
  EG: "EGP", MA: "MAD", TN: "TND", ZA: "ZAR", KE: "KES", TZ: "TZS",
  MU: "MUR", SC: "SCR",

  // --- Americas ---
  US: "USD", PR: "USD", GU: "USD", VI: "USD", EC: "USD", PA: "USD",
  SV: "USD", TL: "USD",
  CA: "CAD", MX: "MXN", BR: "BRL", AR: "ARS", CL: "CLP", CO: "COP", PE: "PEN",

  // --- Oceania ---
  AU: "AUD", NR: "AUD", TV: "AUD", KI: "AUD", CX: "AUD", CC: "AUD", NF: "AUD",
  NZ: "NZD", CK: "NZD", NU: "NZD", TK: "NZD", PN: "NZD",
  FJ: "FJD",
};

// null, never a guess: the caller has a fallback, and an answer it cannot
// tell from a right one is worse than no answer at all. Case-insensitive
// because a locale tag's region subtag is uppercase by the spec and
// lowercase in plenty of real ones.
export function currencyForRegion(region) {
  if (typeof region !== "string" || !region) return null;
  return REGION_CURRENCY[region.toUpperCase()] ?? null;
}

// Case-insensitive search across code, currency name, country, and city
// names. Returns codes ordered: prefix matches first, then substring matches.
export function searchCurrencies(query) {
  const q = query.trim().toLowerCase();
  if (!q) return ALL_CODES;
  const starts = [], contains = [];
  for (const code of ALL_CODES) {
    const c = CURRENCIES[code];
    const haystacks = [code, c.name, ...c.countries, ...(c.cities ?? [])].map((s) => s.toLowerCase());
    if (haystacks.some((s) => s.startsWith(q))) starts.push(code);
    else if (haystacks.some((s) => s.includes(q))) contains.push(code);
  }
  return [...starts, ...contains];
}

// Does a trip match a search query? Matches the trip's name, its currency
// codes and names, its members (when trips have them), and — via the
// currency data — the countries and cities those currencies belong to,
// so "prague" finds a trip containing CZK.
export function tripMatchesQuery(trip, query) {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return true;
  if (trip.name?.toLowerCase().includes(q)) return true;
  for (const member of trip.members ?? []) {
    const name = typeof member === "string" ? member : member?.name;
    if (name?.toLowerCase().includes(q)) return true;
  }
  for (const code of trip.currencies ?? []) {
    if (code.toLowerCase().includes(q)) return true;
    const c = CURRENCIES[code];
    if (!c) continue;
    if (c.name.toLowerCase().includes(q)) return true;
    if ([...c.countries, ...(c.cities ?? [])].some((p) => p.toLowerCase().includes(q))) return true;
  }
  return false;
}

// The city/country/name that best explains why `code` matched `query`
// (used by the picker to show e.g. "Paris" when you searched a city).
export function matchLabel(code, query) {
  const q = query.trim().toLowerCase();
  const c = CURRENCIES[code];
  if (!q || !c) return null;
  const places = [...c.countries, ...(c.cities ?? [])];
  return (
    places.find((p) => p.toLowerCase().startsWith(q)) ??
    places.find((p) => p.toLowerCase().includes(q)) ??
    null
  );
}
