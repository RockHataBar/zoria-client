// Схеми контракту частини 1 (OpenAPI 3.1, версія 1.1.0). Незнайомі поля відповіді ігноруються.

export type Phase = 'static' | 'window' | 'after';
export type Lang = 'uk' | 'en';
export type AccessStatus = 'pending' | 'verified' | 'needs-attention';
export type ReasonCode = 'inviter-mismatch' | 'marker-found' | 'marker-other' | 'marker-absent' | 'organizer' | null;

export interface Envelope {
  frame: string;
  seal: string;
  key: string;
}

export interface FrameWindow {
  opensAt: string;
  closesAt: string;
}

export interface Harbinger {
  opensIn: number;
  text: { uk: string; en: string } | null;
}

export interface Fragment {
  n: number;
  of: number;
  text: string;
}

export interface RollEntry {
  n: number;
  at: string;
  sinceOpen: number;
  name: string;
}

export interface Frame {
  v: 1;
  kind: 'signal' | 'roll';
  station: 'zoria';
  at: string;
  phase: Phase;
  window: FrameWindow | null;
  harbinger: Harbinger | null;
  fragment: Fragment | null;
  onAir: number;
  roll?: RollEntry[];
}

export interface EtherKeyInfo {
  algorithm: 'Ed25519';
  key: string;
  publicKey: string;
  fingerprint: string;
}

export interface Config {
  apiVersion: 1;
  title: string;
  season: string;
  registrationOpen: boolean;
  inviteRequired: boolean;
  repositoryRequired: boolean;
  repositoryAccess: { githubUsername: string; permission: string; instructions: string } | null;
  webClient: boolean;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: 'participant' | 'admin';
  disabled: boolean;
  createdAt: string;
  lang: Lang;
}

export interface Session {
  token: string;
  sessionId: string;
  expiresAt: string;
  user: User;
}

export interface Repository {
  url: string;
  accessStatus: AccessStatus;
  checkedAt: string | null;
  reason: string | null;
  reasonCode: ReasonCode;
  updatedAt: string;
  verifiedElsewhere: boolean;
}

export interface Summary {
  unread: number;
  releasedStages: number;
  acknowledgedStages: number;
  latestNews: string | null;
  repositoryAt: string | null;
  serverTime: string;
}

export interface News {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
}

export interface RepositoryNotice {
  type: 'repository';
  url: string;
  accessStatus: AccessStatus;
  reason: string | null;
  reasonCode: ReasonCode;
}

export interface Message {
  id: string;
  messageId: string | null;
  stageId: string | null;
  kind: 'message' | 'stage' | string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  notice: ({ type: string } & Partial<Omit<RepositoryNotice, 'type'>>) | null;
}

export interface StageSummary {
  id: string;
  position: number;
  title: string;
  excerpt: string;
  publishedAt: string;
  releasedAt: string;
  acknowledgedAt: string | null;
  errataAt: string | null;
}

export interface Stage {
  id: string;
  position: number;
  title: string;
  body: string;
  publishedAt: string;
  releasedAt: string;
  acknowledgedAt: string | null;
  errata: string | null;
  errataAt: string | null;
}

export interface DeveloperCheck {
  apiVersion: 1;
  accountId: string;
  serverTime: string;
  echo: string;
  checks: { authenticated: boolean; json: boolean; utf8: boolean };
  summary: Summary;
}

export interface Page<T> {
  items: T[];
  nextOffset: number | null;
}
