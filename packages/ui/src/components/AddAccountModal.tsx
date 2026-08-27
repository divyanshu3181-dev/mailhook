import { useState } from 'react';
import { accountsApi, oauthApi } from '../lib/api';
import type { SettingsInfo } from '../lib/types';

const PRESETS: Record<string, { host: string; port: number; tls: boolean; label: string }> = {
  gmail: { host: 'imap.gmail.com', port: 993, tls: true, label: 'Gmail (app pw)' },
  yahoo: { host: 'imap.mail.yahoo.com', port: 993, tls: true, label: 'Yahoo' },
  zoho: { host: 'imap.zoho.com', port: 993, tls: true, label: 'Zoho' },
  icloud: { host: 'imap.mail.me.com', port: 993, tls: true, label: 'iCloud' },
  fastmail: { host: 'imap.fastmail.com', port: 993, tls: true, label: 'FastMail' },
  gmx: { host: 'imap.gmx.net', port: 993, tls: true, label: 'GMX' },
  aol: { host: 'imap.aol.com', port: 993, tls: true, label: 'AOL' },
  custom: { host: '', port: 993, tls: true, label: 'Custom IMAP' },
};

interface AddAccountModalProps {
  settings: SettingsInfo | null;
  onClose: () => void;
  onCreated: () => void;
}

type Mode = 'pick' | 'imap';

export function AddAccountModal({ settings, onClose, onCreated }: AddAccountModalProps) {
  const [mode, setMode] = useState<Mode>('pick');
  const [preset, setPreset] = useState('gmail');
  const [form, setForm] = useState({
    name: '',
    email_address: '',
    imap_host: PRESETS.gmail.host,
    imap_port: 993,
    imap_user: '',
    imap_pass: '',
    imap_tls: true,
    watch_folder: 'INBOX',
  });
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testOk, setTestOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startOAuth = async (provider: 'google' | 'microsoft') => {
    setError(null);
    try {
      const { url } =
        provider === 'google' ? await oauthApi.googleUrl() : await oauthApi.microsoftUrl();
      window.location.href = url;
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const choosePreset = (key: string) => {
    setPreset(key);
    const p = PRESETS[key];
    setForm((f) => ({ ...f, imap_host: p.host, imap_port: p.port, imap_tls: p.tls }));
    setMode('imap');
  };

  const set = (key: keyof typeof form, value: string | number | boolean) => {
    setForm((f) => ({ ...f, [key]: value }));
    setTestOk(false);
    setTestResult(null);
  };

  const testConnection = async () => {
    setBusy(true);
    setTestResult(null);
    try {
      const res = await accountsApi.test({
        email_address: form.email_address,
        imap_host: form.imap_host,
        imap_port: form.imap_port,
        imap_user: form.imap_user || form.email_address,
        imap_pass: form.imap_pass,
        imap_tls: form.imap_tls,
        watch_folder: form.watch_folder,
      });
      setTestOk(res.ok);
      setTestResult(res.ok ? 'Connection successful' : res.error ?? 'Connection failed');
    } catch (err) {
      setTestOk(false);
      setTestResult((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await accountsApi.createCustom({
        name: form.name || form.email_address,
        provider: preset === 'yahoo' ? 'yahoo' : 'custom',
        email_address: form.email_address,
        imap_host: form.imap_host,
        imap_port: form.imap_port,
        imap_user: form.imap_user || form.email_address,
        imap_pass: form.imap_pass,
        imap_tls: form.imap_tls,
        watch_folder: form.watch_folder,
      });
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Add account</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
        )}

        {mode === 'pick' && (
          <div className="mt-5 space-y-3">
            <button
              onClick={() => startOAuth('google')}
              disabled={!settings?.providers.google}
              className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-4 py-3 text-left hover:bg-slate-50 disabled:opacity-50"
            >
              <span className="font-medium text-slate-700">Connect Gmail</span>
              <span className="text-xs text-slate-400">
                {settings?.providers.google ? 'OAuth' : 'not configured'}
              </span>
            </button>
            <button
              onClick={() => startOAuth('microsoft')}
              disabled={!settings?.providers.microsoft}
              className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-4 py-3 text-left hover:bg-slate-50 disabled:opacity-50"
            >
              <span className="font-medium text-slate-700">Connect Outlook</span>
              <span className="text-xs text-slate-400">
                {settings?.providers.microsoft ? 'OAuth' : 'not configured'}
              </span>
            </button>

            <div className="pt-2 text-xs font-medium uppercase tracking-wide text-slate-400">
              Or connect via IMAP
            </div>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(PRESETS).map(([key, p]) => (
                <button
                  key={key}
                  onClick={() => choosePreset(key)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {mode === 'imap' && (
          <div className="mt-5 space-y-3">
            <Field label="Name">
              <input
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="My Inbox"
                className="input"
              />
            </Field>
            <Field label="Email address">
              <input
                value={form.email_address}
                onChange={(e) => set('email_address', e.target.value)}
                placeholder="you@example.com"
                className="input"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="IMAP host">
                <input
                  value={form.imap_host}
                  onChange={(e) => set('imap_host', e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Port">
                <input
                  type="number"
                  value={form.imap_port}
                  onChange={(e) => set('imap_port', Number(e.target.value))}
                  className="input"
                />
              </Field>
            </div>
            <Field label="Username">
              <input
                value={form.imap_user}
                onChange={(e) => set('imap_user', e.target.value)}
                placeholder="defaults to email address"
                className="input"
              />
            </Field>
            <Field label="Password / App password">
              <input
                type="password"
                value={form.imap_pass}
                onChange={(e) => set('imap_pass', e.target.value)}
                className="input"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Watch folder">
                <input
                  value={form.watch_folder}
                  onChange={(e) => set('watch_folder', e.target.value)}
                  className="input"
                />
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={form.imap_tls}
                  onChange={(e) => set('imap_tls', e.target.checked)}
                />
                Use TLS
              </label>
            </div>

            {testResult && (
              <div
                className={`rounded-lg px-3 py-2 text-sm ${
                  testOk ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                }`}
              >
                {testResult}
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => setMode('pick')}
                className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100"
              >
                Back
              </button>
              <button
                onClick={testConnection}
                disabled={busy || !form.imap_host || !form.imap_pass}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Test connection
              </button>
              <button
                onClick={save}
                disabled={busy || !testOk || !form.email_address}
                className="ml-auto rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
              >
                Save &amp; connect
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}
