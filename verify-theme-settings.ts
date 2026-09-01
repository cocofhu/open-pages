import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateSite, scaffoldSite } from "./packages/hexo-runner/src/index.ts";
import {
  DEFAULT_SITE_CONFIG,
  THEMES,
  WELCOME_POST_PATH,
  defaultThemeSettings,
  serializeThemeSettings,
  themeConfigPath,
  themeSettingFields,
  welcomeMarkdown,
  type ThemeId,
  type ThemeSettings,
} from "./packages/shared/src/index.ts";

type SettingCase = { name: string; values: ThemeSettings };

const root = await mkdtemp(join(tmpdir(), "open-pages-theme-settings-"));
const selected = process.env.THEME
  ? THEMES.filter((theme) => theme === process.env.THEME)
  : THEMES;
const failures: string[] = [];

try {
  for (const theme of selected) {
    const siteDir = join(root, theme);
    await scaffoldSite({
      siteDir,
      config: { ...DEFAULT_SITE_CONFIG, theme },
      files: [{ path: WELCOME_POST_PATH, content: welcomeMarkdown(), encoding: "utf8" }],
    });

    for (const testCase of casesFor(theme)) {
      try {
        await writeFile(
          join(siteDir, themeConfigPath(theme)),
          serializeThemeSettings(theme, testCase.values),
        );
        const result = await generateSite(siteDir, { rebaseRoot: `/preview/${theme}/` });
        const html = await readFile(join(result.publicDir, "index.html"), "utf8");
        if (!/<html[\s>]/i.test(html)) throw new Error("generated homepage is not HTML");
        if (!/stylesheet/i.test(html)) throw new Error("generated homepage has no stylesheet");
        console.log(`SETTING_OK ${theme} ${testCase.name} ${result.elapsedMs}ms`);
      } catch (error) {
        const yaml = serializeThemeSettings(theme, testCase.values);
        const detail = error instanceof Error ? error.stack || error.message : String(error);
        failures.push(`${theme}/${testCase.name}`);
        console.error(`SETTING_FAIL ${theme} ${testCase.name}\n${yaml}\n${detail}`);
      }
    }
  }
} finally {
  if (process.env.KEEP_THEME_WORKSPACES) console.log(`SETTING_ROOT ${root}`);
  else await rm(root, { recursive: true, force: true });
}

if (failures.length) {
  throw new Error(`Theme setting verification failed:\n${failures.join("\n")}`);
}

function casesFor(theme: ThemeId): SettingCase[] {
  const defaults = defaultThemeSettings(theme);
  const cases: SettingCase[] = [{ name: "defaults", values: defaults }];

  for (const field of themeSettingFields(theme)) {
    if (field.type === "choice" || field.type === "swatch") {
      for (const option of field.options) {
        cases.push({
          name: `${field.key}=${option.value}`,
          values: { ...defaults, [field.key]: option.value },
        });
      }
    } else if (field.type === "toggle") {
      for (const value of [false, true]) {
        cases.push({ name: `${field.key}=${value}`, values: { ...defaults, [field.key]: value } });
      }
    } else {
      for (const [label, value] of [
        ["empty", ""],
        ["special", "Open Pages: #1"],
      ] as const) {
        cases.push({ name: `${field.key}=${label}`, values: { ...defaults, [field.key]: value } });
      }
    }
  }

  if (theme === "next" && process.env.FULL_MATRIX === "1") {
    for (const scheme of ["Muse", "Mist", "Pisces", "Gemini"]) {
      for (const color of ["light", "dark", "auto"]) {
        for (const position of ["left", "right"]) {
          for (const display of ["post", "always", "hide", "remove"]) {
            cases.push({
              name: `matrix-${scheme}-${color}-${position}-${display}`,
              values: {
                ...defaults,
                scheme,
                color_scheme: color,
                sidebar_position: position,
                sidebar_display: display,
              },
            });
          }
        }
      }
    }
  }
  return dedupe(cases);
}

function dedupe(cases: SettingCase[]): SettingCase[] {
  const seen = new Set<string>();
  return cases.filter((item) => {
    const key = JSON.stringify(item.values);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
