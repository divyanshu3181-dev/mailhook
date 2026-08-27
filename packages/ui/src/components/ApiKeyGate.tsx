import { useState } from 'react';
import { setApiKey, systemApi } from '../lib/api';

export function ApiKeyGate({ onAuthed }: { onAuthed: () => void }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setApiKey(key.trim());
    try {
      await systemApi.health(); // validates the key
      onAuthed();
    } catch {
      setError('Invalid API key.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"
      >
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
            M
          </div>
          <span className="text-xl font-semibold text-slate-800">MailHook</span>
        </div>
        <label className="mb-1 block text-sm font-medium text-slate-600">API key</label>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Enter your API_KEY"
          className="input"
          autoFocus
        />
        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
        <button
          type="submit"
          disabled={busy || !key.trim()}
          className="mt-4 w-full rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Sign in'}
        </button>
        <p className="mt-4 text-xs text-slate-400">
          This is the <code>API_KEY</code> from your server environment.
        </p>
      </form>
    </div>
  );
}
