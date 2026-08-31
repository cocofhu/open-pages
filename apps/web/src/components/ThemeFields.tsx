import type { ThemeSettingField, ThemeSettings } from "@open-pages/shared";

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
  value: string | boolean;
  onChange: (value: string | boolean) => void;
}) {
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

function groupFields(fields: ThemeSettingField[]): [string, ThemeSettingField[]][] {
  const groups: [string, ThemeSettingField[]][] = [];
  for (const field of fields) {
    const last = groups[groups.length - 1];
    if (last && last[0] === field.group) last[1].push(field);
    else groups.push([field.group, [field]]);
  }
  return groups;
}
