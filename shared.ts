export type AuthMode = 'password' | 'privateKey' | 'interactive';
export interface HostInput {
  name: string; address: string; port: number; username: string; group: string;
  identityId?: string | null; authMode?: AuthMode; jumpHostId?: string | null;
}
export interface Host extends HostInput { id: string }
export interface KnownHost { address: string; port: number; fingerprint: string; trustedAt: string }
export interface IdentitySummary {
  id: string; name: string; username: string; method: AuthMode;
  hasPassword: boolean; hasPassphrase: boolean; requiresPassphrase: boolean;
}
export type SecretChange = { action: 'keep' | 'clear' } | { action: 'replace'; value: string };
export type KeyChange = SecretChange | { action: 'import'; token: string };
export interface IdentityInput {
  id?: string; name: string; username: string; method: AuthMode;
  password: SecretChange; privateKey: KeyChange; passphrase: SecretChange;
}
export interface VaultStatus { state: 'new' | 'ready' | 'unavailable'; message: string }
export interface WorkspaceTab { id: string; hostId: string }
export interface WorkspaceState { tabs: WorkspaceTab[]; activeTabId: string | null; selectedHostId: string | null }
export interface UpdateCheck { currentVersion: string; latestVersion: string; status: 'available' | 'up-to-date' | 'unsupported'; checkedAt: number }
export interface ConnectRequest {
  tabId: string; hostId: string; password?: string; passphrase?: string; jumpPassword?: string; jumpPassphrase?: string; remember?: boolean; columns: number; rows: number;
}
export type AuthCredentials =
  | { method: 'password'; password: string }
  | { method: 'privateKey'; privateKey: string; passphrase: string }
  | { method: 'interactive' };
export interface JumpConnection { host: Host; auth: AuthCredentials }
export interface RemoteEntry { name: string; kind: 'directory' | 'file' | 'link' | 'other'; size: number; modified: number }
export interface ForwardInput { localPort: number; remoteHost: string; remotePort: number }
export interface Forward extends ForwardInput { id: string }
export interface Transfer { id: string; name: string; direction: 'upload' | 'download'; bytes: number; total: number; state: 'running' | 'completed' | 'cancelled' | 'failed'; message?: string }
export type ResourceRequest =
  | { method: 'list'; path: string }
  | { method: 'transfer'; id: string; direction: 'upload' | 'download'; localPath: string; remotePath: string; name: string }
  | { method: 'cancel'; id: string }
  | { method: 'forwards' }
  | { method: 'forwardStart'; input: ForwardInput }
  | { method: 'forwardStop'; id: string };
export interface AuthPrompt { prompt: string; echo: boolean }
export type SshEvent =
  | { type: 'status'; sessionId: string; state: 'connecting' | 'connected' | 'disconnected'; host?: Host }
  | { type: 'data'; sessionId: string; data: Uint8Array }
  | { type: 'error'; sessionId: string; message: string }
  | { type: 'hostkey'; sessionId: string; hostId?: string; fingerprint: string; address: string; port: number }
  | { type: 'interactive'; sessionId: string; hostName?: string; requestId: string; name: string; instructions: string; prompts: AuthPrompt[] }
  | { type: 'transfer'; sessionId: string; transfer: Transfer }
  | { type: 'forwards'; sessionId: string };
export type SessionEvent = SshEvent & { tabId: string };
export interface HarborAPI {
  setLocale(locale: 'zh-CN' | 'en-US'): Promise<void>;
  checkUpdates(): Promise<UpdateCheck>;
  openUpdatePage(): Promise<void>;
  listHosts(): Promise<Host[]>;
  saveHost(input: HostInput & { id?: string }): Promise<Host>;
  deleteHost(id: string): Promise<void>;
  listKnownHosts(): Promise<KnownHost[]>;
  forgetKnownHost(address: string, port: number): Promise<void>;
  vaultStatus(): Promise<VaultStatus>;
  unlockVault(): Promise<VaultStatus>;
  listIdentities(): Promise<IdentitySummary[]>;
  saveIdentity(input: IdentityInput): Promise<IdentitySummary>;
  deleteIdentity(id: string): Promise<void>;
  importPrivateKey(): Promise<{ token: string; fileName: string } | null>;
  listRemote(sessionId: string, path: string): Promise<{ path: string; entries: RemoteEntry[] }>;
  upload(sessionId: string, directory: string): Promise<{ id: string } | null>;
  download(sessionId: string, remotePath: string): Promise<{ id: string } | null>;
  cancelTransfer(sessionId: string, id: string): Promise<void>;
  listForwards(sessionId: string): Promise<Forward[]>;
  startForward(sessionId: string, input: ForwardInput): Promise<Forward>;
  stopForward(sessionId: string, id: string): Promise<void>;
  getWorkspace(): Promise<WorkspaceState>;
  saveWorkspace(input: WorkspaceState): Promise<void>;
  connect(request: ConnectRequest): Promise<string>;
  trust(sessionId: string, accept: boolean): Promise<void>;
  answerInteractive(sessionId: string, requestId: string, answers: string[] | null): Promise<void>;
  disconnect(sessionId: string): Promise<void>;
  sendInput(sessionId: string, data: string): void;
  resize(sessionId: string, columns: number, rows: number): void;
  acknowledge(sessionId: string): void;
  onSession(callback: (event: SessionEvent) => void): () => void;
}
