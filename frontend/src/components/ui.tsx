import { ReactNode } from 'react';
import { Icon } from './Icon';

export function Alert({ kind, children }: { kind: 'error' | 'ok' | 'info'; children: ReactNode }) {
  return (
    <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon name={kind === 'error' ? 'alert' : kind === 'ok' ? 'check' : 'info'} />
      <span>{children}</span>
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <Icon name="inbox" />
      <strong>{title}</strong>
      {hint && <p className="muted">{hint}</p>}
    </div>
  );
}
