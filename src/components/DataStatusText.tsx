import { DataStatus, Severity } from '../types/platform.ts';

export function StatusIndicator({ status }: { status: DataStatus }) {
  const colorMap: Record<DataStatus, string> = {
    VERIFIED: 'text-emerald-700',
    SIMULATED: 'text-amber-700',
    UNVERIFIED: 'text-slate-600',
    STALE: 'text-rose-700',
  };
  return (
    <span className={`font-mono text-[11px] font-medium tracking-tight ${colorMap[status]}`}>
      {status}
    </span>
  );
}

export function SeverityIndicator({ severity }: { severity: Severity }) {
  const colorMap: Record<Severity, string> = {
    CRITICAL: 'text-red-700 font-semibold',
    HIGH: 'text-amber-700 font-semibold',
    MEDIUM: 'text-slate-800 font-medium',
    LOW: 'text-slate-500 font-medium',
  };
  return <span className={`font-mono text-[11px] ${colorMap[severity]}`}>{severity}</span>;
}

export function formatTimeShort(iso: string | null | undefined): string {
  if (!iso) return 'Unavailable';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unavailable';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatLevelLabel(level: string | null | undefined): string {
  if (!level) return 'All Levels';
  return level
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}
