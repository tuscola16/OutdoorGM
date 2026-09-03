import type { ReactNode } from 'react';

export function Modal({
  title,
  onClose,
  children,
  maxWidth = 420,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Widen the shell for form-dense content (e.g. the runbook entry editor). */
  maxWidth?: number;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 50,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{
          width: '100%', maxWidth, display: 'flex', flexDirection: 'column', gap: 16,
          maxHeight: 'calc(100vh - 48px)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, flexShrink: 0 }}>{title}</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto', minHeight: 0 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
