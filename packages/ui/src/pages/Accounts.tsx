import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { accountsApi, systemApi } from '../lib/api';
import type { Account, SettingsInfo } from '../lib/types';
import { AccountCard } from '../components/AccountCard';
import { AddAccountModal } from '../components/AddAccountModal';

export function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [settings, setSettings] = useState<SettingsInfo | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();

  const load = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([accountsApi.list(), systemApi.settings()]);
      setAccounts(a);
      setSettings(s);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  // Surface OAuth callback result passed back via query string.
  useEffect(() => {
    const oauth = params.get('oauth');
    if (oauth === 'success') setNotice('Account connected.');
    if (oauth === 'error') setError(params.get('message') ?? 'OAuth failed.');
    if (oauth) {
      params.delete('oauth');
      params.delete('message');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const reconnect = async (id: string) => {
    setBusyId(id);
    try {
      await accountsApi.reconnect(id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this account and all its rules and logs?')) return;
    setBusyId(id);
    try {
      await accountsApi.remove(id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-800">Accounts</h1>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
        >
          Add account
        </button>
      </div>

      {notice && (
        <div className="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</div>
      )}
      {error && <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      {accounts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-400">
          No accounts connected yet. Add one to start watching an inbox.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {accounts.map((a) => (
            <AccountCard
              key={a.id}
              account={a}
              onReconnect={reconnect}
              onDelete={remove}
              busy={busyId === a.id}
            />
          ))}
        </div>
      )}

      {showModal && (
        <AddAccountModal
          settings={settings}
          onClose={() => setShowModal(false)}
          onCreated={() => {
            setShowModal(false);
            setNotice('Account connected.');
            void load();
          }}
        />
      )}
    </div>
  );
}
