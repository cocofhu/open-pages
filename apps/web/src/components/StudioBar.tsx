import type { ReactNode } from "react";

interface StudioBarProps {
  title: string;
  actions: ReactNode;
}

export function StudioBar({ title, actions }: StudioBarProps) {
  return (
    <header className="studio-bar" data-testid="studio-bar">
      <div className="studio-brand">
        <svg className="studio-brand-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect width="24" height="24" rx="6" fill="currentColor" />
          <path d="M6.5 7.4h11v1.7H6.5zM6.5 11.15h8v1.7h-8zM6.5 14.9h9.5v1.7H6.5z" fill="var(--paper)" />
        </svg>
        <h1>{title}</h1>
      </div>
      <div className="studio-actions">{actions}</div>
    </header>
  );
}
