import { Fragment, useState } from 'react';
import type { DeliveryLog } from '../lib/types';
import { DeliveryBadge } from './StatusBadge';
import { logsApi, formatDate, truncateId } from '../lib/api';

interface LogTableProps {
  logs: DeliveryLog[];
  onChanged?: () => void;
  showAccount?: boolean;
}

export function LogTable({ logs, onChanged, showAccount = true }: LogTableProps) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [retrying, setRetrying] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const retry = async (id: number) => {
    setRetrying(id);
    setError(null);
    try {
      await logsApi.retry(id);
      onChanged?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRetrying(null);
    }
  };

  if (logs.length === 0) {
    return <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-400">No deliveries yet.</div>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      {error && <div className="bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">From</th>
              <th className="px-4 py-3">Subject</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Time (ms)</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <Fragment key={log.id}>
                <tr
                  className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                  onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                >
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                    {formatDate(log.created_at)}
                  </td>
                  <td className="px-4 py-3">{log.from_address}</td>
                  <td className="max-w-xs truncate px-4 py-3">{log.subject || '(no subject)'}</td>
                  <td className="px-4 py-3">
                    <DeliveryBadge status={log.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-500">{log.response_code ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{log.processing_time_ms ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    {log.status === 'failed' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void retry(log.id);
                        }}
                        disabled={retrying === log.id}
                        className="rounded-md bg-brand-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                      >
                        {retrying === log.id ? '…' : 'Retry'}
                      </button>
                    )}
                  </td>
                </tr>
                {expanded === log.id && (
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <td colSpan={7} className="px-4 py-4">
                      <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs md:grid-cols-3">
                        <Detail label="To" value={log.to_address ?? '—'} />
                        <Detail label="Message-ID" value={log.message_id ?? '—'} />
                        <Detail label="Email UID" value={log.email_uid ?? '—'} />
                        <Detail label="Attempts" value={`${log.attempts}/${log.max_attempts}`} />
                        <Detail label="Payload size" value={log.payload_size ? `${log.payload_size} B` : '—'} />
                        <Detail label="Next retry" value={formatDate(log.next_retry_at)} />
                        {showAccount && <Detail label="Account" value={truncateId(log.account_id)} />}
                        <Detail label="Rule" value={truncateId(log.rule_id)} />
                        <Detail label="Delivered at" value={formatDate(log.delivered_at)} />
                      </dl>
                      {log.error_message && (
                        <div className="mt-3">
                          <div className="text-xs font-semibold uppercase text-slate-500">Error</div>
                          <pre className="mt-1 overflow-x-auto rounded bg-red-50 p-2 text-xs text-red-700">
                            {log.error_message}
                          </pre>
                        </div>
                      )}
                      {log.response_body && (
                        <div className="mt-3">
                          <div className="text-xs font-semibold uppercase text-slate-500">Response body</div>
                          <pre className="mt-1 overflow-x-auto rounded bg-slate-100 p-2 text-xs text-slate-700">
                            {log.response_body}
                          </pre>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-semibold uppercase text-slate-400">{label}</dt>
      <dd className="mt-0.5 break-all text-slate-700">{value}</dd>
    </div>
  );
}
