import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addonInstalledVersion,
  addonVersionLabel,
  type AddonManifest,
} from "./index.ts";

function plugin(partial: Partial<AddonManifest> & Pick<AddonManifest, "source">): AddonManifest {
  return {
    id: "demo",
    kind: "plugin",
    packageName: "hexo-demo",
    label: "demo",
    description: "demo plugin",
    settings: [],
    builtin: false,
    ...partial,
  };
}

test("addonVersionLabel prefers installedVersion", () => {
  const addon = plugin({
    installedVersion: "2.1.0",
    source: { type: "npm", packageName: "hexo-demo", version: "1.0.0" },
  });
  assert.equal(addonInstalledVersion(addon), "2.1.0");
  assert.equal(addonVersionLabel(addon), "v2.1.0");
});

test("addonVersionLabel reads npm source.version when installedVersion missing", () => {
  const addon = plugin({
    source: { type: "npm", packageName: "hexo-demo", version: "3.4.5" },
  });
  assert.equal(addonVersionLabel(addon), "v3.4.5");
});

test("addonVersionLabel reads github source.version", () => {
  const addon = plugin({
    source: {
      type: "github",
      packageName: "hexo-demo",
      repo: "owner/hexo-demo",
      version: "6.0.1",
    },
  });
  assert.equal(addonVersionLabel(addon), "v6.0.1");
});

test("addonVersionLabel falls back to 未知版本", () => {
  const addon = plugin({
    source: { type: "builtin", packageName: "hexo-demo", version: "" },
  });
  assert.equal(addonInstalledVersion(addon), "");
  assert.equal(addonVersionLabel(addon), "未知版本");
});

test("addonVersionLabel keeps leading v", () => {
  const addon = plugin({
    installedVersion: "v9.9.9",
    source: { type: "npm", packageName: "hexo-demo", version: "latest" },
  });
  assert.equal(addonVersionLabel(addon), "v9.9.9");
});
