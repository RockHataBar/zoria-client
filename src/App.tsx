import { AccountProvider, useAccount } from './app/account.tsx';
import { AppProvider, useApp, useNow, type Tab } from './app/context.tsx';
import { RegistrationProvider, useRegistration } from './app/registration.tsx';
import { msUntilOpen, registrationOpen, serverNowMs } from './core/ether.ts';
import { fmtDuration } from './core/time.ts';
import { AccessPanel } from './ui/AccessPanel.tsx';
import { Time } from './ui/common.tsx';
import { EtherPanel } from './ui/EtherPanel.tsx';
import { InboxPanel } from './ui/InboxPanel.tsx';
import { LoginModal } from './ui/LoginModal.tsx';
import { NewsPanel } from './ui/NewsPanel.tsx';
import { RegisterPanel } from './ui/RegisterPanel.tsx';
import { RollPanel } from './ui/RollPanel.tsx';
import { SettingsPanel } from './ui/SettingsPanel.tsx';
import { StackPanel } from './ui/StackPanel.tsx';
import { StagesPanel } from './ui/StagesPanel.tsx';

export function App() {
  return (
    <AppProvider>
      <RegistrationProvider>
        <AccountProvider>
          <Shell />
          <LoginModal />
        </AccountProvider>
      </RegistrationProvider>
    </AppProvider>
  );
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'ether', label: 'Ефір' },
  { id: 'register', label: 'Реєстрація' },
  { id: 'access', label: 'Доступ' },
  { id: 'inbox', label: 'Листи' },
  { id: 'news', label: 'Новини' },
  { id: 'stages', label: 'Частини' },
  { id: 'stack', label: 'Стек' },
  { id: 'roll', label: 'Журнал' },
  { id: 'settings', label: 'Налаштування' },
];

function PhasePill() {
  const { snap } = useApp();
  const now = useNow(1000);
  const s = snap.state;
  const until = msUntilOpen(s, now);
  let text = 'ефір: слухаємо…';
  if (s.phase === 'static') text = until !== null ? `шум · просвіт через ${fmtDuration(until)}` : 'шум · провісника немає';
  if (s.phase === 'window') text = 'ПРОСВІТ · реєстрація відкрита';
  if (s.phase === 'after') text = 'після просвіту';
  if (s.phase !== 'window' && registrationOpen(s)) text = 'реєстрація відкрита (config)';
  return <span className={`pill phase-${s.phase ?? 'unknown'}`}>{text}</span>;
}

function SessionBar() {
  const { session, snap, requireLogin, setTab } = useApp();
  const reg = useRegistration();
  const now = useNow(15_000);
  if (!session) {
    return (
      <div className="session">
        {reg.armed && <span className="pill armed">заявку заготовлено</span>}
        <button type="button" className="small" onClick={() => requireLogin()}>
          Увійти
        </button>
        <button type="button" className="small" onClick={() => setTab('register')}>
          Реєстрація
        </button>
      </div>
    );
  }
  const left = Date.parse(session.expiresAt) - serverNowMs(snap.state, now);
  return (
    <div className="session">
      <span>
        {session.user.username} · {session.user.displayName}
      </span>
      {left < 3600_000 && (
        <button type="button" className="small warn" onClick={() => requireLogin('Сесія скоро скінчиться - увійдіть знову.')}>
          Сесія спливає о <Time t={session.expiresAt} /> - увійти знову
        </button>
      )}
    </div>
  );
}

function Badge({ tab }: { tab: Tab }) {
  const acc = useAccount();
  if (tab === 'inbox' && acc.summary?.unread) return <span className="count">{acc.summary.unread}</span>;
  if (tab === 'access' && acc.repository?.accessStatus === 'needs-attention') return <span className="count">!</span>;
  if (tab === 'stages' && acc.summary && acc.summary.releasedStages > acc.summary.acknowledgedStages)
    return <span className="count">{acc.summary.releasedStages - acc.summary.acknowledgedStages}</span>;
  return null;
}

function Shell() {
  const { tab, setTab, server } = useApp();
  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          ЗОРЯ.НЕТ <span className={`server server-${server.id}`}>{server.id === 'prod' ? 'бойовий' : server.id === 'stand' ? 'стенд' : server.base}</span>
        </div>
        <PhasePill />
        <SessionBar />
      </header>
      <nav className="tabs" aria-label="Розділи">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={t.id === tab ? 'active' : ''} onClick={() => setTab(t.id)} aria-current={t.id === tab ? 'page' : undefined}>
            {t.label}
            <Badge tab={t.id} />
          </button>
        ))}
      </nav>
      <main>
        {tab === 'ether' && <EtherPanel />}
        {tab === 'register' && <RegisterPanel />}
        {tab === 'access' && <AccessPanel />}
        {tab === 'inbox' && <InboxPanel />}
        {tab === 'news' && <NewsPanel />}
        {tab === 'stages' && <StagesPanel />}
        {tab === 'stack' && <StackPanel />}
        {tab === 'roll' && <RollPanel />}
        {tab === 'settings' && <SettingsPanel />}
      </main>
    </div>
  );
}
