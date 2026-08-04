// Static currency data: display info + country names for search.
// decimals follows common cash conventions (not strict ISO 4217).

export const CURRENCIES = {
  // --- Europe ---
  EUR: { name: "Euro", symbol: "€", decimals: 2, flag: "🇪🇺",
    countries: ["France", "Germany", "Netherlands", "Spain", "Italy", "Portugal", "Greece", "Austria", "Belgium", "Ireland", "Finland", "Croatia", "Slovakia", "Slovenia", "Estonia", "Latvia", "Lithuania", "Luxembourg", "Malta", "Cyprus"] },
  GBP: { name: "British Pound", symbol: "£", decimals: 2, flag: "🇬🇧", countries: ["United Kingdom", "England", "Scotland", "Wales"] },
  CHF: { name: "Swiss Franc", symbol: "Fr", decimals: 2, flag: "🇨🇭", countries: ["Switzerland", "Liechtenstein"] },
  CZK: { name: "Czech Koruna", symbol: "Kč", decimals: 2, flag: "🇨🇿", countries: ["Czech Republic", "Czechia"] },
  HUF: { name: "Hungarian Forint", symbol: "Ft", decimals: 0, flag: "🇭🇺", countries: ["Hungary"] },
  PLN: { name: "Polish Złoty", symbol: "zł", decimals: 2, flag: "🇵🇱", countries: ["Poland"] },
  RON: { name: "Romanian Leu", symbol: "lei", decimals: 2, flag: "🇷🇴", countries: ["Romania"] },
  BGN: { name: "Bulgarian Lev", symbol: "лв", decimals: 2, flag: "🇧🇬", countries: ["Bulgaria"] },
  SEK: { name: "Swedish Krona", symbol: "kr", decimals: 2, flag: "🇸🇪", countries: ["Sweden"] },
  NOK: { name: "Norwegian Krone", symbol: "kr", decimals: 2, flag: "🇳🇴", countries: ["Norway"] },
  DKK: { name: "Danish Krone", symbol: "kr", decimals: 2, flag: "🇩🇰", countries: ["Denmark"] },
  ISK: { name: "Icelandic Króna", symbol: "kr", decimals: 0, flag: "🇮🇸", countries: ["Iceland"] },
  TRY: { name: "Turkish Lira", symbol: "₺", decimals: 2, flag: "🇹🇷", countries: ["Turkey", "Türkiye"] },
  RSD: { name: "Serbian Dinar", symbol: "дин", decimals: 0, flag: "🇷🇸", countries: ["Serbia"] },
  ALL: { name: "Albanian Lek", symbol: "L", decimals: 0, flag: "🇦🇱", countries: ["Albania"] },
  BAM: { name: "Bosnian Mark", symbol: "KM", decimals: 2, flag: "🇧🇦", countries: ["Bosnia and Herzegovina"] },
  GEL: { name: "Georgian Lari", symbol: "₾", decimals: 2, flag: "🇬🇪", countries: ["Georgia"] },
  RUB: { name: "Russian Ruble", symbol: "₽", decimals: 2, flag: "🇷🇺", countries: ["Russia"] },

  // --- South & Central Asia ---
  INR: { name: "Indian Rupee", symbol: "₹", decimals: 2, flag: "🇮🇳", countries: ["India"] },
  LKR: { name: "Sri Lankan Rupee", symbol: "Rs", decimals: 2, flag: "🇱🇰", countries: ["Sri Lanka"] },
  NPR: { name: "Nepalese Rupee", symbol: "Rs", decimals: 2, flag: "🇳🇵", countries: ["Nepal"] },
  BDT: { name: "Bangladeshi Taka", symbol: "৳", decimals: 2, flag: "🇧🇩", countries: ["Bangladesh"] },
  PKR: { name: "Pakistani Rupee", symbol: "Rs", decimals: 2, flag: "🇵🇰", countries: ["Pakistan"] },
  MVR: { name: "Maldivian Rufiyaa", symbol: "Rf", decimals: 2, flag: "🇲🇻", countries: ["Maldives"] },
  KZT: { name: "Kazakhstani Tenge", symbol: "₸", decimals: 0, flag: "🇰🇿", countries: ["Kazakhstan"] },
  UZS: { name: "Uzbekistani Som", symbol: "so'm", decimals: 0, flag: "🇺🇿", countries: ["Uzbekistan"] },
  AMD: { name: "Armenian Dram", symbol: "֏", decimals: 0, flag: "🇦🇲", countries: ["Armenia"] },
  AZN: { name: "Azerbaijani Manat", symbol: "₼", decimals: 2, flag: "🇦🇿", countries: ["Azerbaijan"] },

  // --- East & Southeast Asia ---
  JPY: { name: "Japanese Yen", symbol: "¥", decimals: 0, flag: "🇯🇵", countries: ["Japan"] },
  CNY: { name: "Chinese Yuan", symbol: "¥", decimals: 2, flag: "🇨🇳", countries: ["China"] },
  HKD: { name: "Hong Kong Dollar", symbol: "HK$", decimals: 2, flag: "🇭🇰", countries: ["Hong Kong"] },
  TWD: { name: "New Taiwan Dollar", symbol: "NT$", decimals: 0, flag: "🇹🇼", countries: ["Taiwan"] },
  KRW: { name: "South Korean Won", symbol: "₩", decimals: 0, flag: "🇰🇷", countries: ["South Korea", "Korea"] },
  THB: { name: "Thai Baht", symbol: "฿", decimals: 2, flag: "🇹🇭", countries: ["Thailand"] },
  VND: { name: "Vietnamese Dong", symbol: "₫", decimals: 0, flag: "🇻🇳", countries: ["Vietnam"] },
  IDR: { name: "Indonesian Rupiah", symbol: "Rp", decimals: 0, flag: "🇮🇩", countries: ["Indonesia", "Bali"] },
  MYR: { name: "Malaysian Ringgit", symbol: "RM", decimals: 2, flag: "🇲🇾", countries: ["Malaysia"] },
  SGD: { name: "Singapore Dollar", symbol: "S$", decimals: 2, flag: "🇸🇬", countries: ["Singapore"] },
  PHP: { name: "Philippine Peso", symbol: "₱", decimals: 2, flag: "🇵🇭", countries: ["Philippines"] },
  KHR: { name: "Cambodian Riel", symbol: "៛", decimals: 0, flag: "🇰🇭", countries: ["Cambodia"] },
  LAK: { name: "Lao Kip", symbol: "₭", decimals: 0, flag: "🇱🇦", countries: ["Laos"] },
  MMK: { name: "Myanmar Kyat", symbol: "K", decimals: 0, flag: "🇲🇲", countries: ["Myanmar", "Burma"] },
  MNT: { name: "Mongolian Tögrög", symbol: "₮", decimals: 0, flag: "🇲🇳", countries: ["Mongolia"] },

  // --- Middle East ---
  AED: { name: "UAE Dirham", symbol: "د.إ", decimals: 2, flag: "🇦🇪", countries: ["United Arab Emirates", "Dubai", "Abu Dhabi"] },
  SAR: { name: "Saudi Riyal", symbol: "﷼", decimals: 2, flag: "🇸🇦", countries: ["Saudi Arabia"] },
  QAR: { name: "Qatari Riyal", symbol: "﷼", decimals: 2, flag: "🇶🇦", countries: ["Qatar"] },
  OMR: { name: "Omani Rial", symbol: "﷼", decimals: 3, flag: "🇴🇲", countries: ["Oman"] },
  BHD: { name: "Bahraini Dinar", symbol: "BD", decimals: 3, flag: "🇧🇭", countries: ["Bahrain"] },
  KWD: { name: "Kuwaiti Dinar", symbol: "KD", decimals: 3, flag: "🇰🇼", countries: ["Kuwait"] },
  JOD: { name: "Jordanian Dinar", symbol: "JD", decimals: 3, flag: "🇯🇴", countries: ["Jordan"] },
  ILS: { name: "Israeli New Shekel", symbol: "₪", decimals: 2, flag: "🇮🇱", countries: ["Israel"] },

  // --- Africa ---
  EGP: { name: "Egyptian Pound", symbol: "E£", decimals: 2, flag: "🇪🇬", countries: ["Egypt"] },
  MAD: { name: "Moroccan Dirham", symbol: "DH", decimals: 2, flag: "🇲🇦", countries: ["Morocco"] },
  TND: { name: "Tunisian Dinar", symbol: "DT", decimals: 3, flag: "🇹🇳", countries: ["Tunisia"] },
  ZAR: { name: "South African Rand", symbol: "R", decimals: 2, flag: "🇿🇦", countries: ["South Africa"] },
  KES: { name: "Kenyan Shilling", symbol: "KSh", decimals: 0, flag: "🇰🇪", countries: ["Kenya"] },
  TZS: { name: "Tanzanian Shilling", symbol: "TSh", decimals: 0, flag: "🇹🇿", countries: ["Tanzania", "Zanzibar"] },
  MUR: { name: "Mauritian Rupee", symbol: "Rs", decimals: 2, flag: "🇲🇺", countries: ["Mauritius"] },
  SCR: { name: "Seychellois Rupee", symbol: "Rs", decimals: 2, flag: "🇸🇨", countries: ["Seychelles"] },

  // --- Americas ---
  USD: { name: "US Dollar", symbol: "$", decimals: 2, flag: "🇺🇸", countries: ["United States", "America", "Ecuador", "Panama"] },
  CAD: { name: "Canadian Dollar", symbol: "C$", decimals: 2, flag: "🇨🇦", countries: ["Canada"] },
  MXN: { name: "Mexican Peso", symbol: "Mex$", decimals: 2, flag: "🇲🇽", countries: ["Mexico"] },
  BRL: { name: "Brazilian Real", symbol: "R$", decimals: 2, flag: "🇧🇷", countries: ["Brazil"] },
  ARS: { name: "Argentine Peso", symbol: "AR$", decimals: 2, flag: "🇦🇷", countries: ["Argentina"] },
  CLP: { name: "Chilean Peso", symbol: "CL$", decimals: 0, flag: "🇨🇱", countries: ["Chile"] },
  COP: { name: "Colombian Peso", symbol: "CO$", decimals: 0, flag: "🇨🇴", countries: ["Colombia"] },
  PEN: { name: "Peruvian Sol", symbol: "S/", decimals: 2, flag: "🇵🇪", countries: ["Peru"] },

  // --- Oceania ---
  AUD: { name: "Australian Dollar", symbol: "A$", decimals: 2, flag: "🇦🇺", countries: ["Australia"] },
  NZD: { name: "New Zealand Dollar", symbol: "NZ$", decimals: 2, flag: "🇳🇿", countries: ["New Zealand"] },
  FJD: { name: "Fijian Dollar", symbol: "FJ$", decimals: 2, flag: "🇫🇯", countries: ["Fiji"] },
};

export const ALL_CODES = Object.keys(CURRENCIES);

// Case-insensitive search across code, currency name, and country names.
// Returns codes ordered: code prefix match first, then name/country matches.
export function searchCurrencies(query) {
  const q = query.trim().toLowerCase();
  if (!q) return ALL_CODES;
  const starts = [], contains = [];
  for (const code of ALL_CODES) {
    const c = CURRENCIES[code];
    const haystacks = [code, c.name, ...c.countries].map((s) => s.toLowerCase());
    if (haystacks.some((s) => s.startsWith(q))) starts.push(code);
    else if (haystacks.some((s) => s.includes(q))) contains.push(code);
  }
  return [...starts, ...contains];
}
