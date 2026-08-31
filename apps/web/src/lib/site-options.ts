export interface SiteOption {
  value: string;
  label: string;
  hint?: string;
}

export const LANGUAGE_OPTIONS: SiteOption[] = [
  { value: "zh-CN", label: "简体中文", hint: "zh-CN" },
  { value: "zh-TW", label: "繁體中文", hint: "zh-TW" },
  { value: "en", label: "English", hint: "en" },
  { value: "ja", label: "日本語", hint: "ja" },
  { value: "ko", label: "한국어", hint: "ko" },
  { value: "fr", label: "Français", hint: "fr" },
  { value: "de", label: "Deutsch", hint: "de" },
  { value: "es", label: "Español", hint: "es" },
  { value: "ru", label: "Русский", hint: "ru" },
  { value: "pt", label: "Português", hint: "pt" },
  { value: "it", label: "Italiano", hint: "it" },
  { value: "vi", label: "Tiếng Việt", hint: "vi" },
];

const TIMEZONE_CITIES: { value: string; label: string }[] = [
  { value: "Asia/Shanghai", label: "中国（北京时间）" },
  { value: "Asia/Urumqi", label: "乌鲁木齐" },
  { value: "Asia/Hong_Kong", label: "香港" },
  { value: "Asia/Macau", label: "澳门" },
  { value: "Asia/Taipei", label: "台北" },
  { value: "Asia/Tokyo", label: "东京" },
  { value: "Asia/Seoul", label: "首尔" },
  { value: "Asia/Singapore", label: "新加坡" },
  { value: "Asia/Bangkok", label: "曼谷" },
  { value: "Asia/Jakarta", label: "雅加达" },
  { value: "Asia/Kolkata", label: "新德里" },
  { value: "Asia/Dubai", label: "迪拜" },
  { value: "UTC", label: "协调世界时" },
  { value: "Europe/London", label: "伦敦" },
  { value: "Europe/Paris", label: "巴黎" },
  { value: "Europe/Berlin", label: "柏林" },
  { value: "Europe/Moscow", label: "莫斯科" },
  { value: "America/New_York", label: "纽约" },
  { value: "America/Chicago", label: "芝加哥" },
  { value: "America/Denver", label: "丹佛" },
  { value: "America/Los_Angeles", label: "洛杉矶" },
  { value: "America/Toronto", label: "多伦多" },
  { value: "America/Sao_Paulo", label: "圣保罗" },
  { value: "Australia/Sydney", label: "悉尼" },
  { value: "Australia/Melbourne", label: "墨尔本" },
  { value: "Pacific/Auckland", label: "奥克兰" },
];

export function timezoneOptions(): SiteOption[] {
  return TIMEZONE_CITIES.map((item) => ({
    ...item,
    hint: timezoneOffset(item.value),
  }));
}

export const PERMALINK_PRESETS: SiteOption[] = [
  { value: ":year/:month/:day/:title/", label: "年月日", hint: ":year/:month/:day/:title/" },
  { value: ":year/:title/", label: "年 / 标题", hint: ":year/:title/" },
  { value: "post/:title/", label: "post 目录", hint: "post/:title/" },
  { value: ":title/", label: "仅标题", hint: ":title/" },
];

function timezoneOffset(zone: string): string {
  try {
    const name = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value;
    return name ?? zone;
  } catch {
    return zone;
  }
}
