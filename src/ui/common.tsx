import { useState, type ReactNode } from 'react';
import { parseMarkdown, type Block, type Inline } from '../core/markdown.ts';
import { fmtLocal, zoneName } from '../core/time.ts';
import type { AccessStatus } from '../core/types.ts';
import type { Problem } from '../app/account.tsx';

/** Час у місцевій зоні пристрою (CL-38); повний UTC - у підказці. */
export function Time({ t, empty = '—' }: { t: string | number | null | undefined; empty?: string }) {
  const s = fmtLocal(t);
  if (!s) return <>{empty}</>;
  const iso = new Date(t as string | number).toISOString();
  return (
    <time dateTime={iso} title={`${iso} (UTC)`}>
      {s}
    </time>
  );
}

export function Zone() {
  return <span className="muted">Час показано в зоні {zoneName()}.</span>;
}

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return <span key={i}>{n.v}</span>;
      case 'b':
        return <strong key={i}>{renderInline(n.c)}</strong>;
      case 'code':
        return <code key={i}>{n.v}</code>;
      case 'a':
        return (
          <a key={i} href={n.href} target="_blank" rel="noopener noreferrer nofollow">
            {renderInline(n.c)}
          </a>
        );
    }
  });
}

function renderBlock(b: Block, i: number): ReactNode {
  switch (b.t) {
    case 'h': {
      const H = (['h3', 'h4', 'h5', 'h6'] as const)[b.level - 1];
      return <H key={i}>{renderInline(b.c)}</H>;
    }
    case 'p':
      return <p key={i}>{renderInline(b.c)}</p>;
    case 'ul':
      return (
        <ul key={i}>
          {b.items.map((it, j) => (
            <li key={j}>{renderInline(it)}</li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol key={i} start={b.start}>
          {b.items.map((it, j) => (
            <li key={j}>{renderInline(it)}</li>
          ))}
        </ol>
      );
    case 'pre':
      return (
        <pre key={i}>
          <code>{b.v}</code>
        </pre>
      );
  }
}

/** Безпечний показ тексту сервера (CL-30): тільки підмножина Markdown, HTML не виконується. */
export function Markdown({ text }: { text: string }) {
  return <div className="md">{parseMarkdown(text).map(renderBlock)}</div>;
}

export function CopyButton({ text, label = 'Копіювати' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="small"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          },
          () => setDone(false),
        );
      }}
    >
      {done ? 'Скопійовано' : label}
    </button>
  );
}

export function ProblemLine({ p }: { p: Problem | null }) {
  if (!p) return null;
  return (
    <div className="problem" role="status">
      {p.text}
      {p.requestId && (
        <>
          {' '}
          X-Request-Id: <code>{p.requestId}</code> - додайте до повідомлення про збій.
        </>
      )}
    </div>
  );
}

const STATUS_TEXT: Record<AccessStatus, string> = {
  pending: 'очікує (pending)',
  verified: 'підтверджено (verified)',
  'needs-attention': 'потребує уваги (needs-attention)',
};

export function StatusBadge({ status }: { status: AccessStatus }) {
  return <span className={`badge st-${status}`}>{STATUS_TEXT[status]}</span>;
}

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className={`field${error ? ' has-error' : ''}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}
