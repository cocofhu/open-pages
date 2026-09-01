import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scaffoldSite, generateSite } from "./packages/hexo-runner/src/index.ts";
import {
  DEFAULT_SITE_CONFIG,
  THEMES,
  WELCOME_POST_PATH,
  welcomeMarkdown,
} from "./packages/shared/src/index.ts";

const root = await mkdtemp(join(tmpdir(), "open-pages-themes-"));
const failures: string[] = [];
const themes = process.env.THEME
  ? THEMES.filter((theme) => theme === process.env.THEME)
  : THEMES;

try {
  for (const theme of themes) {
    const siteDir = join(root, theme);
    const config = { ...DEFAULT_SITE_CONFIG, theme };
    try {
      await scaffoldSite({
        siteDir,
        config,
        files: [{ path: WELCOME_POST_PATH, content: welcomeMarkdown(), encoding: "utf8" }],
      });
      const result = await generateSite(siteDir, { rebaseRoot: `/preview/${theme}/` });
      const index = await readFile(join(result.publicDir, "index.html"), "utf8");
      if (!/<html[\s>]/i.test(index)) throw new Error("generated homepage is not HTML");
      console.log(`THEME_OK ${theme} ${result.elapsedMs}ms`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${theme}: ${message}`);
      console.error(`THEME_FAIL ${theme} ${message}`);
    }
  }
} finally {
  if (process.env.KEEP_THEME_WORKSPACES) console.log(`THEME_ROOT ${root}`);
  else await rm(root, { recursive: true, force: true });
}

if (failures.length) {
  throw new Error(`Theme verification failed:\n${failures.join("\n")}`);
}
