import { useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

/**
 * Email + password sign-in via Supabase Auth. Named ApiKeyGate for import
 * compatibility; it no longer uses an API key. On success the session is stored
 * by supabase-js and App re-checks auth via the onAuthStateChange listener.
 */
export function ApiKeyGate({ onAuthed }: { onAuthed: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) {
      setError('Authentication is not configured on this deployment.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    onAuthed();
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

        {!isSupabaseConfigured && (
          <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            This deployment was built without Supabase auth env vars
            (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
          </div>
        )}

        <label className="mb-1 block text-sm font-medium text-slate-600">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="input"
          autoFocus
          autoComplete="email"
        />

        <label className="mb-1 mt-4 block text-sm font-medium text-slate-600">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="input"
          autoComplete="current-password"
        />

        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}

        <button
          type="submit"
          disabled={busy || !email.trim() || !password}
          className="mt-4 w-full rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="mt-4 text-xs text-slate-400">
          Access is limited to authorized accounts. Contact your administrator to be added.
        </p>
      </form>
    </div>
  );
}
