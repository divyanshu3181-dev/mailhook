import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { systemApi, logsApi } from '../lib/api';
import type { Stats, DeliveryLog } from '../lib/types';
import { StatsCard } from '../components/StatsCard';
import { LogTable } from '../components/LogTable';

export function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [logs, setLogs] = useState<DeliveryLog[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const [s, l] = await Promise.all([systemApi.stats(), logsApi.list({ limit: 20 })]);
      setStats(s);
      setLogs(l.data);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    void load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-800">Dashboard</h1>
        <Link
          to="/accounts"
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
        >
          Add account
        </Link>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <StatsCard label="Connected" value={stats?.active_connections ?? '—'} hint={`of ${stats?.total_accounts ?? 0} accounts`} accent="green" />
        <StatsCard label="Active rules" value={stats?.total_rules ?? '—'} />
        <StatsCard label="Delivered today" value={stats?.deliveries_today ?? '—'} />
        <StatsCard label="Failed today" value={stats?.failed_today ?? '—'} accent={stats && stats.failed_today > 0 ? 'red' : 'default'} />
        <StatsCard label="7-day success" value={stats ? `${stats.success_rate_7d}%` : '—'} accent="green" />
        <StatsCard
          label="Avg latency"
          value={stats?.avg_processing_time_ms != null ? `${stats.avg_processing_time_ms}ms` : '—'}
        />
      </div>

      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Recent deliveries</h2>
          <Link to="/logs" className="text-sm font-medium text-brand-600 hover:underline">
            View all logs →
          </Link>
        </div>
        <LogTable logs={logs} onChanged={load} />
      </div>
    </div>
  );
}
