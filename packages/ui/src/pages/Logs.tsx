import { useCallback, useEffect, useState } from 'react';
import { accountsApi, logsApi, type LogFilters } from '../lib/api';
import type { Account, DeliveryLog, Pagination } from '../lib/types';
import { LogTable } from '../components/LogTable';

export function Logs() {
  const [logs, setLogs] = useState<DeliveryLog[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [filters, setFilters] = useState<LogFilters>({ page: 1, limit: 25 });
  // Raw values of the date inputs (YYYY-MM-DD); converted to full-day ISO
  // bounds before being sent to the API so Postgres timestamptz comparisons
  // include the entire selected day.
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [purgeDays, setPurgeDays] = useState(30);

  const load = useCallback(async () => {
    try {
      const res = await logsApi.list(filters);
      setLogs(res.data);
      setPagination(res.pagination);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    accountsApi.list().then(setAccounts).catch(() => undefined);
  }, []);

  const setFilter = (patch: Partial<LogFilters>) =>
    setFilters((f) => ({ ...f, ...patch, page: 1 }));

  const onFromChange = (value: string) => {
    setDateFrom(value);
    setFilter({ from: value ? `${value}T00:00:00.000Z` : undefined });
  };

  const onToChange = (value: string) => {
    setDateTo(value);
    setFilter({ to: value ? `${value}T23:59:59.999Z` : undefined });
  };

  const purge = async () => {
    if (!confirm(`Delete all logs older than ${purgeDays} days?`)) return;
    try {
      const res = await logsApi.purge(purgeDays);
      setError(null);
      await load();
      alert(`Purged ${res.purged} log entries.`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-800">Delivery logs</h1>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={purgeDays}
            onChange={(e) => setPurgeDays(Number(e.target.value))}
            className="input w-20"
          />
          <button
            onClick={purge}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            Purge old logs
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      <div className="mb-4 flex flex-wrap gap-3">
        <select
          value={filters.status ?? ''}
          onChange={(e) => setFilter({ status: e.target.value || undefined })}
          className="input max-w-[10rem]"
        >
          <option value="">All statuses</option>
          <option value="delivered">Delivered</option>
          <option value="failed">Failed</option>
          <option value="retrying">Retrying</option>
          <option value="pending">Pending</option>
        </select>
        <select
          value={filters.account_id ?? ''}
          onChange={(e) => setFilter({ account_id: e.target.value || undefined })}
          className="input max-w-xs"
        >
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.email_address}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => onFromChange(e.target.value)}
          className="input max-w-[12rem]"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => onToChange(e.target.value)}
          className="input max-w-[12rem]"
        />
      </div>

      <LogTable logs={logs} onChanged={load} />

      {pagination && pagination.pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <span>
            Page {pagination.page} of {pagination.pages} · {pagination.total} total
          </span>
          <div className="flex gap-2">
            <button
              disabled={pagination.page <= 1}
              onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
              className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={pagination.page >= pagination.pages}
              onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
              className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
