import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { accountsApi, rulesApi, truncateId } from '../lib/api';
import type { Account, Rule } from '../lib/types';

function filterSummary(rule: Rule): string {
  const parts: string[] = [];
  if (rule.filter_from) parts.push(`from:${rule.filter_from}`);
  if (rule.filter_to) parts.push(`to:${rule.filter_to}`);
  if (rule.filter_subject) parts.push(`subject:${rule.filter_subject}`);
  if (rule.filter_has_attachment === true) parts.push('has:attachment');
  if (rule.filter_has_attachment === false) parts.push('no:attachment');
  return parts.length ? parts.join(', ') : 'match all';
}

export function Rules() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountFilter, setAccountFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, a] = await Promise.all([rulesApi.list(), accountsApi.list()]);
      setRules(r);
      setAccounts(a);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const accountEmail = useMemo(() => {
    const map = new Map<string, string>();
    accounts.forEach((a) => map.set(a.id, a.email_address));
    return map;
  }, [accounts]);

  const filtered = rules.filter((r) => {
    if (accountFilter && r.account_id !== accountFilter) return false;
    if (activeFilter === 'active' && !r.is_active) return false;
    if (activeFilter === 'inactive' && r.is_active) return false;
    return true;
  });

  const toggle = async (rule: Rule) => {
    await rulesApi.update(rule.id, { is_active: !rule.is_active });
    await load();
  };

  const remove = async (rule: Rule) => {
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    await rulesApi.remove(rule.id);
    await load();
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-800">Rules</h1>
        <Link
          to="/rules/new"
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
        >
          Create rule
        </Link>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      <div className="mb-4 flex gap-3">
        <select
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
          className="input max-w-xs"
        >
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.email_address}
            </option>
          ))}
        </select>
        <select
          value={activeFilter}
          onChange={(e) => setActiveFilter(e.target.value)}
          className="input max-w-[10rem]"
        >
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-400">
          No rules.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Account</th>
                  <th className="px-4 py-3">Filters</th>
                  <th className="px-4 py-3">24h</th>
                  <th className="px-4 py-3">Active</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((rule) => (
                  <tr key={rule.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{rule.name}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {accountEmail.get(rule.account_id) ?? truncateId(rule.account_id)}
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-slate-500">
                      {filterSummary(rule)}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{rule.deliveries_24h ?? 0}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggle(rule)}
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
                        className="mr-3 text-sm font-medium text-brand-600 hover:underline"
                      >
                        Edit
                      </Link>
                      <button
                        onClick={() => remove(rule)}
                        className="text-sm font-medium text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
