import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { accountsApi, rulesApi } from '../lib/api';
import type { Account, Rule } from '../lib/types';
import {
  RuleEditor,
  emptyForm,
  formToPayload,
  ruleToForm,
  type RuleFormValues,
} from '../components/RuleEditor';

export function RuleForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [rule, setRule] = useState<Rule | null>(null);
  const [initial, setInitial] = useState<RuleFormValues | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const a = await accountsApi.list();
      setAccounts(a);
      if (isEdit && id) {
        const r = await rulesApi.get(id);
        setRule(r);
        setInitial(ruleToForm(r));
      } else {
        setInitial(emptyForm(params.get('account_id') ?? ''));
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, [id, isEdit, params]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (values: RuleFormValues) => {
    const payload = formToPayload(values);
    if (isEdit && id) {
      // account_id can't be changed on update; strip it.
      delete payload.account_id;
      await rulesApi.update(id, payload);
      setNotice('Rule saved.');
      await load();
    } else {
      const created = await rulesApi.create(payload);
      navigate(`/rules/${created.id}/edit`);
    }
  };

  const test = async (values: RuleFormValues) => {
    if (!isEdit || !id) {
      setError('Save the rule first, then use Test webhook.');
      return;
    }
    void values;
    const res = await rulesApi.test(id);
    setNotice(
      res.ok
        ? `Test delivered (HTTP ${res.response_code}).`
        : `Test failed: ${res.error_message ?? res.response_code}`
    );
  };

  const regenerate = async () => {
    if (!id) return;
    if (!confirm('Regenerate the signing secret? Existing consumers must be updated.')) return;
    const res = await rulesApi.regenerateSecret(id);
    setRule((r) => (r ? { ...r, secret: res.secret } : r));
    setNotice('Secret regenerated.');
  };

  if (!initial) {
    return <div className="text-slate-400">{error ?? 'Loading…'}</div>;
  }

  return (
    <div>
      <Link to="/rules" className="text-sm text-brand-600 hover:underline">
        ← Rules
      </Link>
      <h1 className="mb-6 mt-3 text-2xl font-semibold text-slate-800">
        {isEdit ? 'Edit rule' : 'Create rule'}
      </h1>

      {notice && (
        <div className="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</div>
      )}
      {error && <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

      <RuleEditor
        accounts={accounts}
        initial={initial}
        lockAccount={isEdit}
        onSubmit={submit}
        onTest={isEdit ? test : undefined}
        submitLabel={isEdit ? 'Save rule' : 'Create rule'}
      />

      {isEdit && rule && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-slate-700">Signing secret</h3>
          <p className="mb-3 mt-1 text-xs text-slate-400">
            Used to compute the <code>X-MailHook-Signature</code> header
            (HMAC-SHA256 of <code>timestamp.body</code>).
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded bg-slate-100 px-3 py-2 text-xs text-slate-700">
              {rule.secret}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(rule.secret)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Copy
            </button>
            <button
              onClick={regenerate}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50"
            >
              Regenerate
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
