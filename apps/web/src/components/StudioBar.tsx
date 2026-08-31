import type { ReactNode } from "react";

const STEPS = [
  { id: 1, label: "选择主题" },
  { id: 2, label: "发布到 GitHub" },
] as const;

interface StudioBarProps {
  step: 1 | 2;
  actions: ReactNode;
}

export function StudioBar({ step, actions }: StudioBarProps) {
  const current = STEPS[step - 1];
  return (
    <header className="studio-bar" data-testid="studio-bar">
      <div className="studio-brand" aria-label="发布">
        <svg className="studio-brand-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect width="24" height="24" rx="6" fill="currentColor" />
          <path d="M6.5 7.4h11v1.7H6.5zM6.5 11.15h8v1.7h-8zM6.5 14.9h9.5v1.7H6.5z" fill="var(--paper)" />
        </svg>
        <h1>{current.label}</h1>
      </div>
      <ol className="studio-steps" aria-label="发布步骤">
        {STEPS.map((item, index) => (
          <li
            key={item.id}
            className={item.id === step ? "on" : item.id < step ? "done" : ""}
            aria-current={item.id === step ? "step" : undefined}
          >
            {index > 0 ? <span className="studio-step-line" aria-hidden="true" /> : null}
            <span className="studio-step-num">{item.id}</span>
            <span className="studio-step-label">{item.label}</span>
          </li>
        ))}
      </ol>
      <div className="studio-actions">{actions}</div>
    </header>
  );
}
