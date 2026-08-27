import { Link } from 'react-router-dom';
import type { Account } from '../lib/types';
import { ConnectionBadge } from './StatusBadge';
import { formatRelativeTime } from '../lib/api';

const PROVIDER_LABEL: Record<string, string> = {
  gmail: 'Gmail',
  outlook: 'Outlook',
  yahoo: 'Yahoo',
  custom: 'Custom IMAP',
};

interface AccountCardProps {
  account: Account;
  onReconnect: (id: string) => void;
  onDelete: (id: string) => void;
  busy?: boolean;
}

export function AccountCard({ account, onReconnect, onDelete, busy }: AccountCardProps) {
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
            {PROVIDER_LABEL[account.provider] ?? account.provider}
          </div>
          <Link
            to={`/accounts/${account.id}`}
            className="mt-0.5 block font-semibold text-slate-800 hover:text-brand-600"
          >
            {account.name}
          </Link>
          <div className="text-sm text-slate-500">{account.email_address}</div>
        </div>
        <ConnectionBadge status={account.connection_status} />
      </div>

      {account.last_error && (
        <div className="mt-3 rounded bg-red-50 px-2 py-1 text-xs text-red-600">
          {account.last_error}
        </div>
      )}

      <dl className="mt-4 flex gap-6 text-sm">
        <div>
          <dt className="text-xs text-slate-400">Rules</dt>
          <dd className="font-medium text-slate-700">{account.rule_count ?? 0}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">Folder</dt>
          <dd className="font-medium text-slate-700">{account.watch_folder}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">Last delivery</dt>
          <dd className="font-medium text-slate-700">
            {formatRelativeTime(account.last_delivery_at)}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex gap-2 border-t border-slate-100 pt-4">
        <button
          onClick={() => onReconnect(account.id)}
          disabled={busy}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          Reconnect
        </button>
        <Link
          to={`/accounts/${account.id}`}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          Edit
        </Link>
        <button
          onClick={() => onDelete(account.id)}
          disabled={busy}
          className="ml-auto rounded-md px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
