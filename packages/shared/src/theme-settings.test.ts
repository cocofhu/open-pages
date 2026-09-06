import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseThemeSettings,
  serializeThemeSettings,
  type ThemeSettingField,
} from "./theme-settings.js";

const recentFields: ThemeSettingField[] = [
  {
    key: "recent_title",
    label: "标题",
    yamlPath: "recent.title",
    group: "最近在做",
    type: "text",
    default: "最近在做",
  },
  {
    key: "recent_lede",
    label: "副文案",
    yamlPath: "recent.lede",
    group: "最近在做",
    type: "text",
    default: "工程碎片",
  },
  {
    key: "recent_index_label",
    label: "右上角",
    yamlPath: "recent.index_label",
    group: "最近在做",
    type: "text",
    default: "01 NOTES",
  },
  {
    key: "recent_items",
    label: "条目",
    yamlPath: "recent.items",
    group: "最近在做",
    type: "list",
    maxItems: 12,
    itemFields: [
      { key: "date", label: "日期", type: "text", default: "" },
      { key: "title", label: "标题", type: "text", default: "" },
      { key: "tag", label: "标签", type: "text", default: "NOTE" },
      { key: "url", label: "链接", type: "text", default: "" },
      {
        key: "excerpt",
        label: "文案",
        type: "annotated-text",
        tipsKey: "hovers",
        default: "",
      },
    ],
    default: [],
  },
  {
    key: "writing_limit",
    label: "篇数",
    yamlPath: "writing_limit",
    group: "写作",
    type: "text",
    default: "4",
  },
];

test("serialize and parse recent items with hovers", () => {
  const values = {
    recent_title: "最近在做",
    recent_lede: "比项目卡短一点",
    recent_index_label: "01 NOTES",
    writing_limit: "4",
    recent_items: [
      {
        date: "2026 · 09",
        title: "Hello Open Pages",
        tag: "WELCOME",
        url: "",
        excerpt: "在这里用 Typora 式所见即所得写 Markdown。",
        hovers: [{ match: "Typora 式", tip: "对对对就是这样，太对了" }],
      },
    ],
  };
  const yaml = serializeThemeSettings("cocofhu", values, recentFields);
  assert.match(yaml, /recent:/);
  assert.match(yaml, /- date: "2026 · 09"/);
  assert.match(yaml, /hovers:/);
  assert.match(yaml, /match: "Typora 式"/);
  const parsed = parseThemeSettings("cocofhu", yaml, recentFields);
  assert.deepEqual(parsed.recent_items, values.recent_items);
  assert.equal(parsed.recent_title, "最近在做");
  assert.equal(parsed.writing_limit, "4");
});

test("fixed work items keep three slots and hovers", () => {
  const workFields: ThemeSettingField[] = [
    {
      key: "work_title",
      label: "标题",
      yamlPath: "work.title",
      group: "正在进行",
      type: "text",
      default: "正在进行",
    },
    {
      key: "work_items",
      label: "三段",
      yamlPath: "work.items",
      group: "正在进行",
      type: "list",
      minItems: 3,
      maxItems: 3,
      itemFields: [
        { key: "date", label: "日期", type: "text", default: "" },
        { key: "title", label: "标题", type: "text", default: "" },
        { key: "url", label: "链接", type: "text", default: "" },
        { key: "link", label: "按钮", type: "text", default: "" },
        { key: "excerpt", label: "文案", type: "annotated-text", tipsKey: "hovers", default: "" },
      ],
      default: [
        { date: "A", title: "一", url: "", link: "", excerpt: "aaa", hovers: [] },
        { date: "B", title: "二", url: "", link: "", excerpt: "bbb", hovers: [{ match: "bb", tip: "tip" }] },
        { date: "C", title: "三", url: "", link: "", excerpt: "ccc", hovers: [] },
      ],
    },
  ];
  const values = {
    work_title: "正在进行",
    work_items: [
      { date: "2026 · PRODUCT", title: "SkillHub", url: "https://skillhub.cn/", link: "打开", excerpt: "社区", hovers: [] },
      {
        date: "2026 · AI HARNESS",
        title: "AI Harness 提效",
        url: "https://github.com/cocofhu/approving",
        link: "打开 Approving",
        excerpt: "准确表达需求。\n\n开源实践见 Approving。",
        hovers: [{ match: "表达需求", tip: "对对对就是这样，太对了" }],
      },
      { date: "2026 · CREATION", title: "表达与创作", url: "", link: "", excerpt: "输出", hovers: [] },
    ],
  };
  const yaml = serializeThemeSettings("cocofhu", values, workFields);
  const parsed = parseThemeSettings("cocofhu", yaml, workFields);
  assert.equal((parsed.work_items as object[]).length, 3);
  assert.deepEqual(parsed.work_items, values.work_items);
  const empty = parseThemeSettings("cocofhu", "work:\n  items: []\n", workFields);
  assert.equal((empty.work_items as object[]).length, 3);
  assert.equal((empty.work_items as { title: string }[])[1].title, "二");
});

test("empty recent items serialize as [] and parse back", () => {
  const values = {
    recent_title: "最近在做",
    recent_lede: "",
    recent_index_label: "01 NOTES",
    writing_limit: "4",
    recent_items: [],
  };
  const yaml = serializeThemeSettings("cocofhu", values, recentFields);
  assert.match(yaml, /items: \[\]/);
  const parsed = parseThemeSettings("cocofhu", yaml, recentFields);
  assert.deepEqual(parsed.recent_items, []);
});
