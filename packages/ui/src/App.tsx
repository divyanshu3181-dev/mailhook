import { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ApiKeyGate } from './components/ApiKeyGate';
import { getApiKey, systemApi } from './lib/api';
import { Dashboard } from './pages/Dashboard';
import { Accounts } from './pages/Accounts';
import { AccountDetail } from './pages/AccountDetail';
import { Rules } from './pages/Rules';
import { RuleForm } from './pages/RuleForm';
import { Logs } from './pages/Logs';
import { Settings } from './pages/Settings';

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    if (!getApiKey()) {
      setAuthed(false);
      return;
    }
    systemApi
      .health()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null) {
    return <div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>;
  }

  if (!authed) {
    return <ApiKeyGate onAuthed={() => setAuthed(true)} />;
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/accounts/:id" element={<AccountDetail />} />
        <Route path="/rules" element={<Rules />} />
        <Route path="/rules/new" element={<RuleForm />} />
        <Route path="/rules/:id/edit" element={<RuleForm />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
