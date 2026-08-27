interface StatsCardProps {
  label: string;
  value: string | number;
  hint?: string;
  accent?: 'default' | 'green' | 'red' | 'amber';
}

const ACCENTS: Record<NonNullable<StatsCardProps['accent']>, string> = {
  default: 'text-slate-900',
  green: 'text-green-600',
  red: 'text-red-600',
  amber: 'text-amber-600',
};

export function StatsCard({ label, value, hint, accent = 'default' }: StatsCardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className={`mt-2 text-3xl font-semibold ${ACCENTS[accent]}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}
