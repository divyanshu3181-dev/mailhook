import { useEffect, useState } from 'react';
import { systemApi } from '../lib/api';
import { supabase } from '../lib/supabase';
import type { SettingsInfo, HealthInfo } from '../lib/types';

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(' ');
}

export function Settings() {
  const [settings, setSettings] = useState<SettingsInfo | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<string>('');

  useEffect(() => {
    Promise.all([systemApi.settings(), systemApi.health()])
      .then(([s, h]) => {
        setSettings(s);
        setHealth(h);
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(() => {
    supabase?.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ''));
  }, []);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-slate-800">Settings</h1>
      {error && <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="System">
          <Row label="Version" value={settings?.version ?? '—'} />
          <Row label="Node" value={settings?.node_version ?? '—'} />
          <Row label="Uptime" value={settings ? formatUptime(settings.uptime) : '—'} />
          <Row label="Base URL" value={settings?.base_url ?? '—'} />
          <Row label="Database" value="Supabase (Postgres)" />
          <Row
            label="Encryption key"
            value={settings?.encryption_key_persistent ? 'set via env' : 'not set'}
          />
        </Card>

        <Card title="Connections">
          <Row label="Accounts" value={String(health?.accounts.total ?? '—')} />
          <Row label="Connected" value={String(health?.accounts.connected ?? '—')} />
          <Row label="Errored" value={String(health?.accounts.error ?? '—')} />
          <Row label="Queue pending" value={String(health?.queue.pending ?? '—')} />
          <Row label="Queue processing" value={String(health?.queue.processing ?? '—')} />
        </Card>

        <Card title="OAuth providers">
          <Row label="Google (Gmail)" value={settings?.providers.google ? 'configured' : 'not configured'} />
          <Row
            label="Microsoft (Outlook)"
            value={settings?.providers.microsoft ? 'configured' : 'not configured'}
          />
        </Card>

        <Card title="Signed in as">
          <Row label="Email" value={email || '—'} />
          <button
            type="button"
            onClick={() => void supabase?.auth.signOut()}
            className="mt-3 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Sign out
          </button>
          <p className="mt-2 text-xs text-slate-400">
            Authenticated via Supabase. Your session token authorizes every request.
          </p>
        </Card>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="mb-4 text-sm font-semibold text-slate-700">{title}</h2>
      <dl className="space-y-2 text-sm">{children}</dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-400">{label}</dt>
      <dd className="break-all text-right font-medium text-slate-700">{value}</dd>
    </div>
  );
}
