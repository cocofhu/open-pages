import type { ThemeId } from "./index.js";

export type ThemeHoverTip = { match: string; tip: string };
export type ThemeListItem = Record<string, string | ThemeHoverTip[]>;
export type ThemeSettingValue = string | boolean | ThemeListItem[];
export type ThemeSettings = Record<string, ThemeSettingValue>;

type FieldBase = {
  key: string;
  label: string;
  hint?: string;
  yamlPath: string;
  group: string;
};

export type ThemeListItemField =
  | {
      key: string;
      label: string;
      type: "text";
      placeholder?: string;
      default?: string;
    }
  | {
      key: string;
      label: string;
      type: "annotated-text";
      tipsKey: string;
      placeholder?: string;
      default?: string;
    };

export type ThemeSettingField =
  | (FieldBase & {
      type: "choice";
      options: { value: string; label: string }[];
      default: string;
    })
  | (FieldBase & { type: "toggle"; default: boolean })
  | (FieldBase & { type: "text"; placeholder?: string; default: string })
  | (FieldBase & {
      type: "swatch";
      options: { value: string; label: string; color: string }[];
      default: string;
    })
  | (FieldBase & {
      type: "list";
      itemLabel?: string;
      minItems?: number;
      maxItems?: number;
      itemFields: ThemeListItemField[];
      default: ThemeListItem[];
    });

export function themeConfigPath(theme: ThemeId): string {
  return `_config.${theme}.yml`;
}

export function pluginConfigPath(plugin: string): string {
  return `_config.plugin.${plugin}.yml`;
}

export function isThemeConfigPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return (
    /^_config\.[a-z][a-z0-9-]{0,79}\.yml$/.test(normalized) ||
    /^_config\.plugin\.[a-z][a-z0-9-]{0,79}\.yml$/.test(normalized)
  );
}

const FIELDS: Record<string, ThemeSettingField[]> = {
  landscape: [
    {
      key: "sidebar",
      label: "侧栏位置",
      yamlPath: "sidebar",
      group: "外观",
      type: "choice",
      default: "right",
      options: [
        { value: "right", label: "右侧" },
        { value: "left", label: "左侧" },
        { value: "false", label: "关闭" },
      ],
    },
    {
      key: "fancybox",
      label: "图片灯箱",
      hint: "点击文章图片放大查看",
      yamlPath: "fancybox",
      group: "阅读",
      type: "toggle",
      default: true,
    },
    {
      key: "excerpt_link",
      label: "阅读更多",
      yamlPath: "excerpt_link",
      group: "阅读",
      type: "text",
      default: "继续阅读",
      placeholder: "首页摘要后的按钮文案",
    },
    {
      key: "show_count",
      label: "显示篇数",
      yamlPath: "show_count",
      group: "阅读",
      type: "toggle",
      default: false,
    },
  ],
  cactus: [
    {
      key: "colorscheme",
      label: "配色",
      yamlPath: "colorscheme",
      group: "外观",
      type: "choice",
      default: "dark",
      options: [
        { value: "dark", label: "深色" },
        { value: "light", label: "浅色" },
        { value: "classic", label: "经典" },
        { value: "white", label: "纯白" },
      ],
    },
    {
      key: "direction",
      label: "文字方向",
      yamlPath: "direction",
      group: "外观",
      type: "choice",
      default: "ltr",
      options: [
        { value: "ltr", label: "从左到右" },
        { value: "rtl", label: "从右到左" },
      ],
    },
    {
      key: "tags_overview",
      label: "首页标签云",
      yamlPath: "tags_overview",
      group: "阅读",
      type: "toggle",
      default: false,
    },
  ],
  next: [
    {
      key: "scheme",
      label: "布局方案",
      hint: "四种经典 NexT 骨架",
      yamlPath: "scheme",
      group: "外观",
      type: "choice",
      default: "Gemini",
      options: [
        { value: "Muse", label: "Muse" },
        { value: "Mist", label: "Mist" },
        { value: "Pisces", label: "Pisces" },
        { value: "Gemini", label: "Gemini" },
      ],
    },
    {
      key: "color_scheme",
      label: "明暗",
      hint: "深色会直接套用暗色，不只跟随系统",
      yamlPath: "op_color_scheme",
      group: "外观",
      type: "choice",
      default: "dark",
      options: [
        { value: "light", label: "浅色" },
        { value: "dark", label: "深色" },
        { value: "auto", label: "跟随系统" },
      ],
    },
    {
      key: "sidebar_position",
      label: "侧栏位置",
      yamlPath: "sidebar.position",
      group: "侧栏",
      type: "choice",
      default: "left",
      options: [
        { value: "left", label: "左侧" },
        { value: "right", label: "右侧" },
      ],
    },
    {
      key: "sidebar_display",
      label: "侧栏展开",
      yamlPath: "sidebar.display",
      group: "侧栏",
      type: "choice",
      default: "post",
      options: [
        { value: "post", label: "文章页" },
        { value: "always", label: "始终" },
        { value: "hide", label: "收起" },
        { value: "remove", label: "隐藏" },
      ],
    },
    {
      key: "excerpt_description",
      label: "摘要作描述",
      yamlPath: "excerpt_description",
      group: "阅读",
      type: "toggle",
      default: true,
    },
    {
      key: "site_state",
      label: "站点统计",
      hint: "文章 / 分类 / 标签数量",
      yamlPath: "site_state",
      group: "阅读",
      type: "toggle",
      default: true,
    },
  ],
  kaze: [
    {
      key: "link_color",
      label: "链接颜色",
      yamlPath: "color.link-color",
      group: "外观",
      type: "swatch",
      default: "#3273dc",
      options: [
        { value: "#3273dc", label: "晴空", color: "#3273dc" },
        { value: "#c0392b", label: "朱红", color: "#c0392b" },
        { value: "#1a7f64", label: "松绿", color: "#1a7f64" },
        { value: "#2f3d4e", label: "墨色", color: "#2f3d4e" },
      ],
    },
    {
      key: "author_description",
      label: "作者简介",
      yamlPath: "author_description",
      group: "作者",
      type: "text",
      default: "写给下一次打开的人",
      placeholder: "侧栏里的一句话",
    },
    {
      key: "scrollUpAnimation",
      label: "滚动动画",
      yamlPath: "scrollUpAnimation",
      group: "阅读",
      type: "toggle",
      default: true,
    },
    {
      key: "lazyload",
      label: "图片懒加载",
      yamlPath: "lazyload.enable",
      group: "阅读",
      type: "toggle",
      default: true,
    },
  ],
  stellar: [
    {
      key: "prefers_theme",
      label: "明暗",
      yamlPath: "style.prefers_theme",
      group: "外观",
      type: "choice",
      default: "auto",
      options: [
        { value: "auto", label: "跟随系统" },
        { value: "light", label: "浅色" },
        { value: "dark", label: "深色" },
      ],
    },
    {
      key: "theme_color",
      label: "主题色",
      yamlPath: "style.color.theme",
      group: "外观",
      type: "swatch",
      default: "hsl(192 98% 55%)",
      options: [
        { value: "hsl(192 98% 55%)", label: "青", color: "#1bcdfc" },
        { value: "hsl(262 80% 58%)", label: "紫", color: "#7c4dff" },
        { value: "hsl(24 95% 53%)", label: "橙", color: "#f76707" },
        { value: "hsl(152 60% 40%)", label: "绿", color: "#2b8a5a" },
      ],
    },
    {
      key: "text_align",
      label: "正文对齐",
      yamlPath: "style.text-align",
      group: "阅读",
      type: "choice",
      default: "left",
      options: [
        { value: "left", label: "左齐" },
        { value: "justify", label: "两端" },
      ],
    },
  ],
  reimu: [
    {
      key: "toc",
      label: "文章目录",
      yamlPath: "toc",
      group: "阅读",
      type: "toggle",
      default: true,
    },
    {
      key: "reimu_cursor",
      label: "灵梦光标",
      hint: "自定义鼠标指针",
      yamlPath: "reimu_cursor.enable",
      group: "外观",
      type: "toggle",
      default: true,
    },
    {
      key: "typing",
      label: "打字机副标题",
      yamlPath: "subtitle.typing.enable",
      group: "外观",
      type: "toggle",
      default: false,
    },
  ],
  particlex: [
    {
      key: "card",
      label: "侧栏名片",
      yamlPath: "card.enable",
      group: "侧栏",
      type: "toggle",
      default: true,
    },
    {
      key: "card_description",
      label: "名片简介",
      yamlPath: "card.description",
      group: "侧栏",
      type: "text",
      default: "粒子与文字同在。",
      placeholder: "侧栏里的自我介绍",
    },
    {
      key: "footer_since",
      label: "页脚起始年",
      yamlPath: "footer.since",
      group: "页脚",
      type: "text",
      default: "2024",
      placeholder: "2024",
    },
  ],
  stun: [
    {
      key: "night_mode",
      label: "夜间模式按钮",
      hint: "在站点里显示切换按钮",
      yamlPath: "night_mode.enable",
      group: "外观",
      type: "toggle",
      default: true,
    },
    {
      key: "index_subtitle",
      label: "首页副标题",
      yamlPath: "index_subtitle",
      group: "阅读",
      type: "toggle",
      default: false,
    },
  ],
  white: [
    {
      key: "description",
      label: "站点说明",
      yamlPath: "description",
      group: "文案",
      type: "text",
      default: "Simple, concise blog theme for Hexo.",
      placeholder: "页头附近的一句话",
    },
    {
      key: "copyright_name",
      label: "版权署名",
      yamlPath: "copyright.name",
      group: "页脚",
      type: "text",
      default: "",
      placeholder: "页脚显示的名字",
    },
  ],
  tranquility: [
    {
      key: "color_mode",
      label: "明暗",
      yamlPath: "color_mode",
      group: "外观",
      type: "choice",
      default: "light",
      options: [
        { value: "light", label: "浅色" },
        { value: "dark", label: "深色" },
        { value: "auto", label: "跟随系统" },
        { value: "time", label: "按时段" },
      ],
    },
    {
      key: "homepage_mode",
      label: "首页形态",
      yamlPath: "homepage_mode",
      group: "外观",
      type: "choice",
      default: "blog",
      options: [
        { value: "blog", label: "博客" },
        { value: "landing", label: "个人主页" },
      ],
    },
    {
      key: "slogan",
      label: "标语",
      yamlPath: "slogan",
      group: "文案",
      type: "text",
      default: "宁静致远",
      placeholder: "首页大字",
    },
    {
      key: "slogan_hitokoto",
      label: "随机一言",
      hint: "用一言接口替换固定标语",
      yamlPath: "slogan_hitokoto",
      group: "文案",
      type: "toggle",
      default: false,
    },
  ],
  async: [
    {
      key: "theme_default",
      label: "默认外观",
      yamlPath: "theme.default",
      group: "外观",
      type: "choice",
      default: "style-light",
      options: [
        { value: "style-light", label: "浅色" },
        { value: "style-dark", label: "深色" },
        { value: "auto", label: "跟随系统" },
      ],
    },
    {
      key: "theme_switch",
      label: "切换按钮",
      yamlPath: "theme.switch",
      group: "外观",
      type: "toggle",
      default: true,
    },
    {
      key: "wordcount",
      label: "字数统计",
      yamlPath: "wordcount.enable",
      group: "阅读",
      type: "toggle",
      default: false,
    },
  ],
  apollo: [
    {
      key: "startyear",
      label: "页脚起始年",
      yamlPath: "startyear",
      group: "页脚",
      type: "text",
      default: "2024",
      placeholder: "2024",
    },
  ],
  inside: [
    {
      key: "accent_color",
      label: "强调色",
      yamlPath: "appearance.accent_color",
      group: "外观",
      type: "swatch",
      default: "#2a2b33",
      options: [
        { value: "#2a2b33", label: "墨", color: "#2a2b33" },
        { value: "#539bf5", label: "蓝", color: "#539bf5" },
        { value: "#c0392b", label: "红", color: "#c0392b" },
        { value: "#1a7f64", label: "绿", color: "#1a7f64" },
      ],
    },
  ],
};

export function themeSettingFields(theme: ThemeId): ThemeSettingField[] {
  return FIELDS[theme] ?? [];
}

export function defaultThemeSettings(theme: ThemeId): ThemeSettings {
  return defaultSettingsForFields(themeSettingFields(theme));
}

export function defaultSettingsForFields(fields: ThemeSettingField[]): ThemeSettings {
  const values: ThemeSettings = {};
  for (const field of fields) values[field.key] = cloneThemeSettingValue(field.default);
  return values;
}

export function emptyThemeListItem(itemFields: ThemeListItemField[]): ThemeListItem {
  return normalizeThemeListItem(itemFields, {});
}

export function cloneThemeSettingValue(value: ThemeSettingValue): ThemeSettingValue {
  if (!Array.isArray(value)) return value;
  return value.map((item) => cloneListItem(item));
}

function cloneListItem(item: ThemeListItem): ThemeListItem {
  const next: ThemeListItem = {};
  for (const [key, val] of Object.entries(item)) {
    next[key] = Array.isArray(val) ? val.map((tip) => ({ match: tip.match, tip: tip.tip })) : val;
  }
  return next;
}

export function listFieldMaxItems(field: Extract<ThemeSettingField, { type: "list" }>): number {
  return Math.min(24, Math.max(1, field.maxItems ?? 12));
}

export function listFieldMinItems(field: Extract<ThemeSettingField, { type: "list" }>): number {
  return Math.min(listFieldMaxItems(field), Math.max(0, Math.floor(field.minItems ?? 0)));
}

export function normalizeThemeListItems(
  itemFields: ThemeListItemField[],
  value: unknown,
  maxItems = 12,
  minItems = 0,
): ThemeListItem[] {
  const items = Array.isArray(value)
    ? value.slice(0, maxItems).map((item) => normalizeThemeListItem(itemFields, item))
    : [];
  while (items.length < minItems && items.length < maxItems) {
    items.push(emptyThemeListItem(itemFields));
  }
  return items;
}

export function normalizeThemeListItem(
  itemFields: ThemeListItemField[],
  value: unknown,
): ThemeListItem {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const item: ThemeListItem = {};
  for (const field of itemFields) {
    const found = raw[field.key];
    item[field.key] = typeof found === "string" ? found : (field.default ?? "");
    if (field.type === "annotated-text") {
      const tips = raw[field.tipsKey];
      item[field.tipsKey] = Array.isArray(tips)
        ? tips
            .map((tip) => {
              if (!tip || typeof tip !== "object") return null;
              const match = String((tip as { match?: unknown }).match ?? "");
              const note = String((tip as { tip?: unknown }).tip ?? "");
              return match ? { match, tip: note } : null;
            })
            .filter((tip): tip is ThemeHoverTip => tip !== null)
            .slice(0, 8)
        : [];
    }
  }
  return item;
}

export function serializeThemeSettings(
  theme: ThemeId,
  values: ThemeSettings,
  fields = themeSettingFields(theme),
): string {
  const tree: YamlMap = {};
  for (const field of fields) {
    const raw = values[field.key] ?? field.default;
    setYamlPath(tree, field.yamlPath, coerceFieldValue(field, raw));
  }
  if (theme === "next") {
    const scheme = resolvedColorScheme(theme, values);
    setYamlPath(tree, "darkmode", scheme !== "light");
  }
  // ParticleX pulls a polyfill bundle from a China-only mirror of the retired
  // polyfill.io service, as a parser-blocking script in <head>. Where that host
  // is unreachable the document never reaches <body>, so the whole site stays
  // blank instead of degrading. Nothing the theme uses needs it.
  if (theme === "particlex") {
    setYamlPath(tree, "polyfill.enable", false);
  }
  return [`# Open Pages · ${theme}`, serializeYaml(tree), ""].join("\n");
}

export function parseThemeSettings(
  theme: ThemeId,
  yaml: string,
  fields = themeSettingFields(theme),
): ThemeSettings {
  const tree = parseSimpleYaml(yaml);
  const values = defaultSettingsForFields(fields);
  for (const field of fields) {
    const found = getYamlPath(tree, field.yamlPath);
    if (found === undefined) continue;
    values[field.key] = coerceFieldValue(field, found);
  }
  if (theme === "next" && getYamlPath(tree, "op_color_scheme") === undefined) {
    const darkmode = getYamlPath(tree, "darkmode");
    values.color_scheme = darkmode === false || darkmode === "false" ? "light" : "dark";
  }
  return values;
}

export function resolvedColorScheme(
  theme: ThemeId,
  values: ThemeSettings,
): "dark" | "light" | "auto" | null {
  if (theme === "next") {
    const value = String(values.color_scheme ?? "dark");
    if (value === "light" || value === "dark" || value === "auto") return value;
    return "dark";
  }
  if (theme === "stellar") {
    const value = String(values.prefers_theme ?? "auto");
    if (value === "light" || value === "dark" || value === "auto") return value;
    return "auto";
  }
  if (theme === "tranquility") {
    const value = String(values.color_mode ?? "light");
    if (value === "light" || value === "dark" || value === "auto") return value;
    return "light";
  }
  if (theme === "async") {
    const value = String(values.theme_default ?? "style-light");
    if (value === "style-dark") return "dark";
    if (value === "auto") return "auto";
    return "light";
  }
  if (theme === "cactus") {
    return String(values.colorscheme ?? "dark") === "dark" ? "dark" : "light";
  }
  return null;
}

type YamlScalar = string | boolean | number;
type YamlMap = { [key: string]: YamlValue };
type YamlValue = YamlScalar | YamlMap | YamlValue[];

function coerceFieldValue(field: ThemeSettingField, value: unknown): ThemeSettingValue {
  if (field.type === "list") {
    if (!Array.isArray(value) || (value.length === 0 && field.default.length > 0 && listFieldMinItems(field) > 0)) {
      return cloneThemeSettingValue(field.default);
    }
    return normalizeThemeListItems(
      field.itemFields,
      value,
      listFieldMaxItems(field),
      listFieldMinItems(field),
    );
  }
  if (field.type === "toggle") {
    if (typeof value === "boolean") return value;
    if (value === "true" || value === "yes" || value === 1) return true;
    if (value === "false" || value === "no" || value === 0) return false;
    return field.default;
  }
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return field.default;
}

function setYamlPath(tree: YamlMap, path: string, value: ThemeSettingValue): void {
  const parts = path.split(".");
  let current: YamlMap = tree;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) current[part] = {};
    current = current[part] as YamlMap;
  }
  current[parts[parts.length - 1]!] = value;
}

function getYamlPath(tree: YamlMap, path: string): unknown {
  let current: unknown = tree;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as YamlMap)[part];
  }
  return current;
}

function serializeYaml(node: YamlMap, indent = 0): string {
  return Object.entries(node)
    .flatMap(([key, value]) => serializeEntry(key, value, indent))
    .join("\n");
}

function serializeEntry(key: string, value: YamlValue, indent: number): string[] {
  const pad = "  ".repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return [`${pad}${key}: []`];
    return [`${pad}${key}:`, ...serializeSeq(value, indent + 1)];
  }
  if (value && typeof value === "object") {
    const nested = serializeYaml(value, indent + 1);
    return nested ? [`${pad}${key}:`, nested] : [`${pad}${key}: {}`];
  }
  return [`${pad}${key}: ${yamlScalar(value)}`];
}

function serializeSeq(items: YamlValue[], indent: number): string[] {
  const pad = "  ".repeat(indent);
  const lines: string[] = [];
  for (const item of items) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const entries = Object.entries(item);
      if (!entries.length) {
        lines.push(`${pad}- {}`);
        continue;
      }
      const [firstKey, firstVal] = entries[0]!;
      if (Array.isArray(firstVal)) {
        if (!firstVal.length) lines.push(`${pad}- ${firstKey}: []`);
        else {
          lines.push(`${pad}- ${firstKey}:`);
          lines.push(...serializeSeq(firstVal, indent + 2));
        }
      } else if (firstVal && typeof firstVal === "object") {
        const nested = serializeYaml(firstVal, indent + 2);
        lines.push(`${pad}- ${firstKey}:`);
        if (nested) lines.push(nested);
      } else {
        lines.push(`${pad}- ${firstKey}: ${yamlScalar(firstVal)}`);
      }
      for (const [key, val] of entries.slice(1)) {
        lines.push(...serializeEntry(key, val, indent + 1));
      }
      continue;
    }
    if (Array.isArray(item)) {
      lines.push(`${pad}-`);
      lines.push(...serializeSeq(item, indent + 1));
      continue;
    }
    lines.push(`${pad}- ${yamlScalar(item)}`);
  }
  return lines;
}

function yamlScalar(value: YamlScalar): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (
    value === "" ||
    /^(?:~|null|true|false|yes|no|on|off|auto|default|undefined)$/i.test(value) ||
    /[:#{}[\],&*?|<>=!%@`]/.test(value) ||
    /\s/.test(value) ||
    value.startsWith("#")
  ) {
    return JSON.stringify(value);
  }
  return value;
}

function parseSimpleYaml(text: string): YamlMap {
  const root: YamlMap = {};
  type Frame =
    | { indent: number; kind: "map"; map: YamlMap }
    | { indent: number; kind: "seq"; seq: YamlValue[] };
  const stack: Frame[] = [{ indent: -1, kind: "map", map: root }];
  const lines = text.split("\n");

  const peekSeq = (from: number, parentIndent: number): boolean => {
    for (let i = from + 1; i < lines.length; i += 1) {
      const next = stripYamlComment(lines[i]!);
      if (!next.trim() || next.trim().startsWith("#")) continue;
      const indent = next.match(/^(\s*)/)?.[1].length ?? 0;
      if (indent <= parentIndent) return false;
      return /^\s*- /.test(next) || /^\s*-$/.test(next);
    }
    return false;
  };

  const pushValue = (indent: number, value: YamlValue, empty: boolean): void => {
    if (empty && typeof value === "object" && !Array.isArray(value)) {
      stack.push({ indent, kind: "map", map: value });
    } else if (empty && Array.isArray(value)) {
      stack.push({ indent, kind: "seq", seq: value });
    }
  };

  const assignKey = (indent: number, key: string, value: YamlValue, empty: boolean): void => {
    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) stack.pop();
    const parent = stack[stack.length - 1]!;
    if (parent.kind === "map") {
      parent.map[key] = value;
      pushValue(indent, value, empty);
      return;
    }
    const last = parent.seq[parent.seq.length - 1];
    if (last && typeof last === "object" && !Array.isArray(last)) {
      last[key] = value;
      pushValue(indent, value, empty);
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = stripYamlComment(lines[i]!);
    if (!trimmed.trim() || trimmed.trim().startsWith("#")) continue;
    const indent = trimmed.match(/^(\s*)/)?.[1].length ?? 0;
    const seq = trimmed.match(/^(\s*)- (.*)$/) ?? (trimmed.match(/^(\s*)-$/) ? [trimmed, trimmed.match(/^(\s*)/)?.[1] ?? "", ""] : null);

    if (seq) {
      const rest = (seq[2] ?? "").trim();
      while (stack.length > 1 && indent < stack[stack.length - 1]!.indent) stack.pop();
      let parent = stack[stack.length - 1]!;
      if (parent.kind !== "seq" || indent !== parent.indent) {
        while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) stack.pop();
        parent = stack[stack.length - 1]!;
      }
      if (parent.kind !== "seq") continue;

      if (!rest) {
        const child: YamlMap = {};
        parent.seq.push(child);
        stack.push({ indent: indent + 2, kind: "map", map: child });
        continue;
      }
      const keyed = rest.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
      if (!keyed) {
        parent.seq.push(parseYamlScalar(rest));
        continue;
      }
      const key = keyed[1]!;
      const after = keyed[2] ?? "";
      const item: YamlMap = {};
      parent.seq.push(item);
      stack.push({ indent: indent + 2, kind: "map", map: item });
      if (after === "[]") {
        item[key] = [];
      } else if (after === "") {
        const child = peekSeq(i, indent + 2) ? ([] as YamlValue[]) : {};
        item[key] = child;
        pushValue(indent + 2, child, true);
      } else {
        item[key] = parseYamlScalar(after);
      }
      continue;
    }

    const match = trimmed.match(/^(\s*)([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[2]!;
    const rest = match[3] ?? "";
    if (rest === "[]") {
      assignKey(indent, key, [], false);
    } else if (rest === "") {
      const child = peekSeq(i, indent) ? ([] as YamlValue[]) : {};
      assignKey(indent, key, child, true);
    } else {
      assignKey(indent, key, parseYamlScalar(rest), false);
    }
  }
  return root;
}

function stripYamlComment(raw: string): string {
  if (raw.includes("#") && !/['"]/.test(raw)) return raw.replace(/\s+#.*$/, "");
  return raw;
}

function parseYamlScalar(raw: string): YamlScalar {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}
