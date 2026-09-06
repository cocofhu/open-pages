import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  emptyThemeListItem,
  listFieldMaxItems,
  listFieldMinItems,
  type ThemeHoverTip,
  type ThemeListItem,
  type ThemeListItemField,
  type ThemeSettingField,
  type ThemeSettingValue,
  type ThemeSettings,
} from "@open-pages/shared";

export function ThemeSettingsForm({
  fields,
  settings,
  onChange,
}: {
  fields: ThemeSettingField[];
  settings: ThemeSettings;
  onChange: (settings: ThemeSettings) => void;
}) {
  const groups = groupFields(fields);
  return (
    <>
      {groups.map(([group, groupFields]) => (
        <section key={group} className="settings-theme-group">
          <h4>{group}</h4>
          {groupFields.map((field) => (
            <ThemeField
              key={field.key}
              field={field}
              value={settings[field.key] ?? field.default}
              onChange={(value) => onChange({ ...settings, [field.key]: value })}
            />
          ))}
        </section>
      ))}
    </>
  );
}

function ThemeField({
  field,
  value,
  onChange,
}: {
  field: ThemeSettingField;
  value: ThemeSettingValue;
  onChange: (value: ThemeSettingValue) => void;
}) {
  if (field.type === "list") {
    return (
      <ListField
        field={field}
        value={Array.isArray(value) ? value : field.default}
        onChange={onChange}
      />
    );
  }

  if (field.type === "toggle") {
    const on = Boolean(value);
    return (
      <div className="studio-toggle-row">
        <div>
          <strong>{field.label}</strong>
          {field.hint ? <span>{field.hint}</span> : null}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          className={on ? "studio-switch on" : "studio-switch"}
          data-testid={`theme-setting-${field.key}`}
          onClick={() => onChange(!on)}
        >
          <i />
        </button>
      </div>
    );
  }

  if (field.type === "choice") {
    return (
      <div className="studio-field" data-testid={`theme-setting-${field.key}`}>
        <span>{field.label}</span>
        {field.hint ? <em className="hint">{field.hint}</em> : null}
        <div className="studio-chips" role="radiogroup" aria-label={field.label}>
          {field.options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={String(value) === option.value}
              className={String(value) === option.value ? "studio-chip on" : "studio-chip"}
              data-testid={`theme-setting-${field.key}-${option.value}`}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (field.type === "swatch") {
    return (
      <div className="studio-field" data-testid={`theme-setting-${field.key}`}>
        <span>{field.label}</span>
        <div className="studio-swatches" role="radiogroup" aria-label={field.label}>
          {field.options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={String(value) === option.value}
              className={String(value) === option.value ? "studio-swatch on" : "studio-swatch"}
              data-testid={`theme-setting-${field.key}-${option.value}`}
              title={option.label}
              onClick={() => onChange(option.value)}
            >
              <i style={{ background: option.color }} />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <label className="studio-field">
      {field.label}
      <input
        data-testid={`theme-setting-${field.key}`}
        value={String(value)}
        placeholder={field.placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function ListField({
  field,
  value,
  onChange,
}: {
  field: Extract<ThemeSettingField, { type: "list" }>;
  value: ThemeListItem[];
  onChange: (value: ThemeListItem[]) => void;
}) {
  const maxItems = listFieldMaxItems(field);
  const minItems = listFieldMinItems(field);
  const fixed = minItems > 0 && minItems === maxItems;
  const update = (index: number, next: ThemeListItem) => {
    onChange(value.map((item, i) => (i === index ? next : item)));
  };
  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= value.length) return;
    const next = value.slice();
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item!);
    onChange(next);
  };

  return (
    <div className="studio-list" data-testid={`theme-setting-${field.key}`}>
      <div className="studio-list-head">
        <span>{field.label}</span>
        {field.hint ? <em className="hint">{field.hint}</em> : null}
      </div>
      {value.map((item, index) => (
        <article key={`${field.key}-${index}`} className="studio-list-card">
          <header>
            <strong>
              {typeof item.title === "string" && item.title
                ? item.title
                : `${field.itemLabel ?? "条目"} ${index + 1}`}
            </strong>
            {fixed ? null : (
            <div className="studio-list-actions">
              <button type="button" disabled={index === 0} onClick={() => move(index, -1)}>
                上移
              </button>
              <button
                type="button"
                disabled={index === value.length - 1}
                onClick={() => move(index, 1)}
              >
                下移
              </button>
              <button
                type="button"
                disabled={value.length <= minItems}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                删除
              </button>
            </div>
            )}
          </header>
          {field.itemFields.map((itemField) => (
            <ListItemField
              key={itemField.key}
              field={itemField}
              item={item}
              testId={`${field.key}-${index}-${itemField.key}`}
              onChange={(next) => update(index, next)}
            />
          ))}
        </article>
      ))}
      {fixed ? null : (
      <button
        type="button"
        className="studio-list-add"
        disabled={value.length >= maxItems}
        data-testid={`theme-setting-${field.key}-add`}
        onClick={() => onChange([...value, emptyThemeListItem(field.itemFields)])}
      >
        + 添加{field.itemLabel ?? "条目"}
      </button>
      )}
    </div>
  );
}

function ListItemField({
  field,
  item,
  testId,
  onChange,
}: {
  field: ThemeListItemField;
  item: ThemeListItem;
  testId: string;
  onChange: (item: ThemeListItem) => void;
}) {
  const text = typeof item[field.key] === "string" ? (item[field.key] as string) : "";
  if (field.type === "annotated-text") {
    const tips = Array.isArray(item[field.tipsKey])
      ? (item[field.tipsKey] as ThemeHoverTip[])
      : [];
    return (
      <AnnotatedTextField
        label={field.label}
        placeholder={field.placeholder}
        text={text}
        tips={tips}
        testId={testId}
        onChange={(nextText, nextTips) =>
          onChange({ ...item, [field.key]: nextText, [field.tipsKey]: nextTips })
        }
      />
    );
  }
  return (
    <label className="studio-field">
      {field.label}
      <input
        data-testid={`theme-setting-${testId}`}
        value={text}
        placeholder={field.placeholder}
        onChange={(event) => onChange({ ...item, [field.key]: event.target.value })}
      />
    </label>
  );
}

function AnnotatedTextField({
  label,
  placeholder,
  text,
  tips,
  testId,
  onChange,
}: {
  label: string;
  placeholder?: string;
  text: string;
  tips: ThemeHoverTip[];
  testId: string;
  onChange: (text: string, tips: ThemeHoverTip[]) => void;
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [draftTip, setDraftTip] = useState("");
  const [selection, setSelection] = useState("");

  const captureSelection = () => {
    const area = areaRef.current;
    if (!area) return;
    const next = area.value.slice(area.selectionStart, area.selectionEnd);
    setSelection(next);
  };

  const addTip = () => {
    const match = selection.trim();
    const tip = draftTip.trim();
    if (!match || !tip || !text.includes(match)) return;
    const next = tips.some((item) => item.match === match)
      ? tips.map((item) => (item.match === match ? { match, tip } : item))
      : [...tips, { match, tip }];
    onChange(text, next);
    setDraftTip("");
    setSelection("");
  };

  const updateTip = (index: number, patch: Partial<ThemeHoverTip>) => {
    onChange(
      text,
      tips.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  };

  return (
    <div className="studio-annotated" data-testid={`theme-setting-${testId}`}>
      <label className="studio-field">
        {label}
        <textarea
          ref={areaRef}
          data-testid={`theme-setting-${testId}-text`}
          value={text}
          placeholder={placeholder}
          rows={4}
          onSelect={captureSelection}
          onKeyUp={captureSelection}
          onMouseUp={captureSelection}
          onChange={(event) => {
            const next = event.target.value;
            onChange(
              next,
              tips.filter((item) => next.includes(item.match)),
            );
          }}
        />
      </label>
      {text ? (
        <p className="studio-annotated-preview" aria-hidden="true">
          {previewAnnotated(text, tips)}
        </p>
      ) : null}
      <div className="studio-annotated-add">
        <input
          data-testid={`theme-setting-${testId}-tip`}
          value={draftTip}
          placeholder={selection.trim() ? `给「${selection.trim()}」加说明` : "先在文案里选中要 hover 的词"}
          disabled={!selection.trim()}
          onChange={(event) => setDraftTip(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addTip();
            }
          }}
        />
        <button
          type="button"
          data-testid={`theme-setting-${testId}-add-tip`}
          disabled={!selection.trim() || !draftTip.trim()}
          onClick={addTip}
        >
          {tips.some((item) => item.match === selection.trim()) ? "改说明" : "加说明"}
        </button>
      </div>
      {tips.length ? (
        <ul className="studio-annotated-tips">
          {tips.map((item, index) => (
            <TipRow
              key={index}
              match={item.match}
              tip={item.tip}
              testId={testId}
              index={index}
              onCommit={(next) => updateTip(index, next)}
              onDelete={() => onChange(text, tips.filter((_, i) => i !== index))}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TipRow({
  match,
  tip,
  testId,
  index,
  onCommit,
  onDelete,
}: {
  match: string;
  tip: string;
  testId: string;
  index: number;
  onCommit: (next: ThemeHoverTip) => void;
  onDelete: () => void;
}) {
  const [draftMatch, setDraftMatch] = useState(match);
  const [draftTip, setDraftTip] = useState(tip);

  useEffect(() => {
    setDraftMatch(match);
    setDraftTip(tip);
  }, [match, tip]);

  const commit = () => {
    if (draftMatch === match && draftTip === tip) return;
    onCommit({ match: draftMatch, tip: draftTip });
  };

  return (
    <li>
      <input
        aria-label="hover 词"
        data-testid={`theme-setting-${testId}-match-${index}`}
        value={draftMatch}
        onChange={(event) => setDraftMatch(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
      />
      <input
        aria-label="hover 说明"
        data-testid={`theme-setting-${testId}-tip-${index}`}
        value={draftTip}
        onChange={(event) => setDraftTip(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
      />
      <button type="button" onClick={onDelete}>
        删除
      </button>
    </li>
  );
}

function previewAnnotated(text: string, tips: ThemeHoverTip[]) {
  const ranges = tips
    .map((tip) => {
      const start = text.indexOf(tip.match);
      return start < 0 ? null : { start, end: start + tip.match.length };
    })
    .filter((range): range is { start: number; end: number } => range !== null)
    .sort((a, b) => a.start - b.start);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start < cursor) return;
    if (range.start > cursor) nodes.push(text.slice(cursor, range.start));
    nodes.push(
      <mark key={`${range.start}-${index}`}>{text.slice(range.start, range.end)}</mark>,
    );
    cursor = range.end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function groupFields(fields: ThemeSettingField[]): [string, ThemeSettingField[]][] {
  const groups: [string, ThemeSettingField[]][] = [];
  for (const field of fields) {
    const last = groups[groups.length - 1];
    if (last && last[0] === field.group) last[1].push(field);
    else groups.push([field.group, [field]]);
  }
  return groups;
}
