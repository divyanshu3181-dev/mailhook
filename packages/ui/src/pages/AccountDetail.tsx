import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { accountsApi, oauthApi, rulesApi, formatDate } from '../lib/api';
import type { Account, Rule } from '../lib/types';
import { ConnectionBadge } from '../components/StatusBadge';

export function AccountDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [account, setAccount] = useState<Account | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', watch_folder: '', is_active: true });

  const load = useCallback(async () => {
    try {
      const [a, r] = await Promise.all([accountsApi.get(id), rulesApi.list(id)]);
      setAccount(a);
      setRules(r);
      setForm({ name: a.name, watch_folder: a.watch_folder, is_active: a.is_active });
    } catch (err) {
      setError((err as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await accountsApi.update(id, {
        name: form.name,
        watch_folder: form.watch_folder,
        is_active: form.is_active,
      });
      setNotice('Saved.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setNotice(msg);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Delete this account and all its rules and logs?')) return;
    setBusy(true);
    try {
      await accountsApi.remove(id);
      navigate('/accounts');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const toggleRule = async (rule: Rule) => {
    await rulesApi.update(rule.id, { is_active: !rule.is_active });
    await load();
  };

  if (!account) {
    return <div className="text-slate-400">{error ?? 'Loading…'}</div>;
  }

  const isOAuth = account.provider === 'gmail' || account.provider === 'outlook';

  return (
    <div>
      <Link to="/accounts" className="text-sm text-brand-600 hover:underline">
        ← Accounts
      </Link>

      <div className="mt-3 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">{account.name}</h1>
          <p className="text-slate-500">{account.email_address}</p>
        </div>
        <ConnectionBadge status={account.connection_status} />
      </div>

      {notice && (
        <div className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</div>
      )}
      {error && <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      {account.last_error && (
        <div className="mt-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
          Last error: {account.last_error}
        </div>
      )}

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">Settings</h2>
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Name</span>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="input"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Watch folder</span>
              <input
                value={form.watch_folder}
                onChange={(e) => setForm((f) => ({ ...f, watch_folder: e.target.value }))}
                className="input"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              />
              Active
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={save}
              disabled={busy}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={() => act(() => accountsApi.reconnect(id), 'Reconnecting…')}
              disabled={busy}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Reconnect
            </button>
            {isOAuth && (
              <button
                onClick={() => act(() => oauthApi.refresh(id), 'Token refreshed.')}
                disabled={busy}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Refresh token
              </button>
            )}
            <button
              onClick={remove}
              disabled={busy}
              className="ml-auto rounded-lg px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">Connection</h2>
          <dl className="space-y-2 text-sm">
            <Row label="Provider" value={account.provider} />
            <Row label="IMAP host" value={account.imap_host ?? '—'} />
            <Row label="Port" value={String(account.imap_port ?? '—')} />
            <Row
              label="Credentials"
              value={account.credentials_configured ? 'configured' : 'missing'}
            />
            <Row label="Last connected" value={formatDate(account.last_connected_at)} />
            <Row label="Consecutive failures" value={String(account.consecutive_failures)} />
            {account.oauth_expires_at && (
              <Row label="Token expires" value={formatDate(account.oauth_expires_at)} />
            )}
          </dl>
        </div>
      </div>

      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Rules</h2>
          <Link
            to={`/rules/new?account_id=${id}`}
            className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600"
          >
            Add rule
          </Link>
        </div>
        {rules.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-slate-400">
            No rules for this account yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Webhook</th>
                  <th className="px-4 py-3">Active</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id} className="border-b border-slate-100">
                    <td className="px-4 py-3 font-medium">{rule.name}</td>
                    <td className="max-w-xs truncate px-4 py-3 text-slate-500">{rule.webhook_url}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleRule(rule)}
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          rule.is_active
                            ? 'bg-green-100 text-green-700'
                            : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {rule.is_active ? 'on' : 'off'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/rules/${rule.id}/edit`}
                        className="text-sm font-medium text-brand-600 hover:underline"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
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
