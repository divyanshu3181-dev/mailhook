import { useState } from 'react';
import type { Account, Rule } from '../lib/types';

export interface RuleFormValues {
  account_id: string;
  name: string;
  webhook_url: string;
  filter_from: string;
  filter_to: string;
  filter_subject: string;
  filter_has_attachment: '' | '0' | '1';
  filter_label: string;
  filter_unseen_only: boolean;
  is_active: boolean;
}

export function ruleToForm(rule: Rule): RuleFormValues {
  return {
    account_id: rule.account_id,
    name: rule.name,
    webhook_url: rule.webhook_url,
    filter_from: rule.filter_from ?? '',
    filter_to: rule.filter_to ?? '',
    filter_subject: rule.filter_subject ?? '',
    filter_has_attachment:
      rule.filter_has_attachment === null || rule.filter_has_attachment === undefined
        ? ''
        : rule.filter_has_attachment
          ? '1'
          : '0',
    filter_label: rule.filter_label ?? '',
    filter_unseen_only: rule.filter_unseen_only,
    is_active: rule.is_active,
  };
}

export function emptyForm(accountId = ''): RuleFormValues {
  return {
    account_id: accountId,
    name: '',
    webhook_url: '',
    filter_from: '',
    filter_to: '',
    filter_subject: '',
    filter_has_attachment: '',
    filter_label: '',
    filter_unseen_only: true,
    is_active: true,
  };
}

/** Converts the form to the API request body (nulls for empty filters). */
export function formToPayload(v: RuleFormValues): Record<string, unknown> {
  return {
    account_id: v.account_id,
    name: v.name,
    webhook_url: v.webhook_url,
    filter_from: v.filter_from.trim() || null,
    filter_to: v.filter_to.trim() || null,
    filter_subject: v.filter_subject.trim() || null,
    filter_has_attachment:
      v.filter_has_attachment === '' ? null : v.filter_has_attachment === '1',
    filter_label: v.filter_label.trim() || null,
    filter_unseen_only: v.filter_unseen_only,
    is_active: v.is_active,
  };
}

interface RuleEditorProps {
  accounts: Account[];
  initial: RuleFormValues;
  lockAccount?: boolean;
  onSubmit: (values: RuleFormValues) => Promise<void>;
  onTest?: (values: RuleFormValues) => Promise<void>;
  submitLabel: string;
}

export function RuleEditor({
  accounts,
  initial,
  lockAccount,
  onSubmit,
  onTest,
  submitLabel,
}: RuleEditorProps) {
  const [v, setV] = useState<RuleFormValues>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof RuleFormValues>(key: K, value: RuleFormValues[K]) =>
    setV((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(v);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!onTest) return;
    setBusy(true);
    setError(null);
    try {
      await onTest(v);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const valid = v.account_id && v.name && v.webhook_url;

  return (
    <div className="space-y-5">
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Account">
            <select
              value={v.account_id}
              disabled={lockAccount}
              onChange={(e) => set('account_id', e.target.value)}
              className="input disabled:bg-slate-100"
            >
              <option value="">Select account…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.email_address}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rule name">
            <input value={v.name} onChange={(e) => set('name', e.target.value)} className="input" />
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Webhook URL">
            <input
              value={v.webhook_url}
              onChange={(e) => set('webhook_url', e.target.value)}
              placeholder="https://n8n.example.com/webhook/..."
              className="input"
            />
          </Field>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-700">Filters</h3>
        <p className="mb-4 mt-1 text-xs text-slate-400">
          Leave all empty to match every email. Use <code>/regex/</code> for regex, otherwise a
          case-insensitive "contains" match.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="From">
            <input
              value={v.filter_from}
              onChange={(e) => set('filter_from', e.target.value)}
              placeholder="sender@example.com or /.*@lead\.com/"
              className="input"
            />
          </Field>
          <Field label="To">
            <input
              value={v.filter_to}
              onChange={(e) => set('filter_to', e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Subject">
            <input
              value={v.filter_subject}
              onChange={(e) => set('filter_subject', e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Has attachment">
            <select
              value={v.filter_has_attachment}
              onChange={(e) =>
                set('filter_has_attachment', e.target.value as '' | '0' | '1')
              }
              className="input"
            >
              <option value="">Any</option>
              <option value="1">Yes</option>
              <option value="0">No</option>
            </select>
          </Field>
        </div>
        <div className="mt-4 flex gap-6">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={v.filter_unseen_only}
              onChange={(e) => set('filter_unseen_only', e.target.checked)}
            />
            Unseen only
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={v.is_active}
              onChange={(e) => set('is_active', e.target.checked)}
            />
            Active
          </label>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={busy || !valid}
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {submitLabel}
        </button>
        {onTest && (
          <button
            onClick={test}
            disabled={busy || !v.webhook_url}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Test webhook
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}
