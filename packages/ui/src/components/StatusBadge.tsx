import type { ConnectionStatus, DeliveryStatus } from '../lib/types';

const CONNECTION_STYLES: Record<ConnectionStatus, string> = {
  connected: 'bg-green-100 text-green-700',
  connecting: 'bg-amber-100 text-amber-700',
  error: 'bg-red-100 text-red-700',
  disconnected: 'bg-slate-200 text-slate-600',
};

const DELIVERY_STYLES: Record<DeliveryStatus, string> = {
  delivered: 'bg-green-100 text-green-700',
  retrying: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
  pending: 'bg-slate-200 text-slate-600',
};

export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${CONNECTION_STYLES[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

export function DeliveryBadge({ status }: { status: DeliveryStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${DELIVERY_STYLES[status]}`}
    >
      {status}
    </span>
  );
}
