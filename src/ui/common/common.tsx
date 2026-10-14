import type { ReactNode } from 'react';

/** "How is this calculated?" disclosure placed next to a group of calculated figures (NFR-9). */
export function Explain({ title = 'How is this calculated?', children }: { title?: string; children: ReactNode }) {
  return (
    <details className="explain">
      <summary>{title}</summary>
      <div className="explain-body">{children}</div>
    </details>
  );
}

/** A wide table inside a keyboard-focusable, labeled scroll region (no page-level horizontal scroll). */
export function TableRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    // tabIndex lets keyboard users scroll the region; it is a labeled landmark-like group.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

export function Notice({ tone = 'info', children, live = false }: { tone?: 'info' | 'warning' | 'success'; children: ReactNode; live?: boolean }) {
  return (
    <div className={`notice notice--${tone}`} role={live ? 'status' : undefined}>
      {tone === 'warning' && <span className="notice-icon" aria-hidden="true">!</span>}
      <div className="notice-body">{children}</div>
    </div>
  );
}

export function Metric({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd>
        <span className="metric-value">{value}</span>
        {detail && <span className="metric-detail">{detail}</span>}
      </dd>
    </div>
  );
}
