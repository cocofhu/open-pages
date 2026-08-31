import type { ThemeId } from "./index.js";

export type ThemeSettingValue = string | boolean;
export type ThemeSettings = Record<string, ThemeSettingValue>;

type FieldBase = {
  key: string;
  label: string;
  hint?: string;
  yamlPath: string;
  group: string;
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
    });

export function themeConfigPath(theme: ThemeId): string {
  return `_config.${theme}.yml`;
}

export function isThemeConfigPath(path: string): boolean {
  const match = path.replaceAll("\\", "/").match(/^_config\.([a-z0-9]+)\.yml$/);
  return Boolean(match && match[1] in FIELDS);
}

const FIELDS: Record<ThemeId, ThemeSettingField[]> = {
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
  return FIELDS[theme];
}

export function defaultThemeSettings(theme: ThemeId): ThemeSettings {
  const values: ThemeSettings = {};
  for (const field of FIELDS[theme]) values[field.key] = field.default;
  return values;
}

export function serializeThemeSettings(theme: ThemeId, values: ThemeSettings): string {
  const tree: YamlNode = {};
  for (const field of FIELDS[theme]) {
    const raw = values[field.key] ?? field.default;
    setYamlPath(tree, field.yamlPath, coerceFieldValue(field, raw));
  }
  if (theme === "next") {
    const scheme = resolvedColorScheme(theme, values);
    setYamlPath(tree, "darkmode", scheme !== "light");
  }
  return [`# Open Pages · ${theme}`, serializeYaml(tree), ""].join("\n");
}

export function parseThemeSettings(theme: ThemeId, yaml: string): ThemeSettings {
  const tree = parseSimpleYaml(yaml);
  const values = defaultThemeSettings(theme);
  for (const field of FIELDS[theme]) {
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

type YamlNode = { [key: string]: YamlScalar | YamlNode };
type YamlScalar = string | boolean | number;

function coerceFieldValue(field: ThemeSettingField, value: unknown): ThemeSettingValue {
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

function setYamlPath(tree: YamlNode, path: string, value: ThemeSettingValue): void {
  const parts = path.split(".");
  let current: YamlNode = tree;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!next || typeof next !== "object") current[part] = {};
    current = current[part] as YamlNode;
  }
  current[parts[parts.length - 1]!] = value;
}

function getYamlPath(tree: YamlNode, path: string): unknown {
  let current: unknown = tree;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as YamlNode)[part];
  }
  return current;
}

function serializeYaml(node: YamlNode, indent = 0): string {
  const pad = "  ".repeat(indent);
  const lines: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (value && typeof value === "object") {
      lines.push(`${pad}${key}:`);
      lines.push(serializeYaml(value, indent + 1));
      continue;
    }
    lines.push(`${pad}${key}: ${yamlScalar(value)}`);
  }
  return lines.join("\n");
}

function yamlScalar(value: YamlScalar): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (value === "true" || value === "false") return value;
  if (value === "" || /[:#{}[\],&*?|<>=!%@`]/.test(value) || /\s/.test(value) || value.startsWith("#")) {
    return JSON.stringify(value);
  }
  return value;
}

function parseSimpleYaml(text: string): YamlNode {
  const root: YamlNode = {};
  const stack: { indent: number; node: YamlNode }[] = [{ indent: -1, node: root }];
  for (const raw of text.split("\n")) {
    const trimmed = raw.replace(/\s+#.*$/, "");
    if (!trimmed.trim() || trimmed.trim().startsWith("#")) continue;
    const match = trimmed.match(/^(\s*)([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!match) continue;
    const indent = match[1].length;
    const key = match[2]!;
    const rest = match[3] ?? "";
    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) stack.pop();
    const parent = stack[stack.length - 1]!.node;
    if (rest === "") {
      const child: YamlNode = {};
      parent[key] = child;
      stack.push({ indent, node: child });
    } else {
      parent[key] = parseYamlScalar(rest);
    }
  }
  return root;
}

function parseYamlScalar(raw: string): YamlScalar {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
