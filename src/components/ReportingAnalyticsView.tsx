import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiFetch } from '../lib/api.ts';
import {
  DistributionLevel,
  DistributionNode,
  KpiMetric,
  LevelMatrixRow,
  ShipmentView,
  UserRole,
} from '../types/platform.ts';
import { formatLevelLabel, StatusIndicator } from './DataStatusText.tsx';
import { MpMap } from './MpMap.tsx';

interface ReportingAnalyticsViewProps {
  role: UserRole;
  nodes: DistributionNode[];
  shipments: ShipmentView[];
  onOpenLevelLogin?: (lvl: UserRole) => void;
}

interface DistrictReportRow {
  districtId: string;
  districtName: string;
  division: string;
  nodeCount: number;
  availableUnits: number | null;
  shortageSkuCount: number | null;
  openAlertCount: number;
  fulfilmentRatePct: number | null;
  dataStatus: 'SIMULATED' | 'UNVERIFIED';
}

export function ReportingAnalyticsView({
  role,
  nodes,
  shipments,
  onOpenLevelLogin,
}: ReportingAnalyticsViewProps) {
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [selectedLevel, setSelectedLevel] = useState<string>('ALL');
  const [kpis, setKpis] = useState<KpiMetric[]>([]);
  const [districts, setDistricts] = useState<DistrictReportRow[]>([]);
  const [levelsMatrix, setLevelsMatrix] = useState<LevelMatrixRow[]>([]);
  const [trends, setTrends] = useState<{ label: string; demandUnits: number; availableSupplyUnits: number }[]>([]);
  const [bottlenecks, setBottlenecks] = useState<
    { id: string; corridor: string; districtId: string; delayImpactMinutes: number; severity: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setErrorMsg(null);
      try {
        const levelParam = selectedLevel !== 'ALL' ? `&level=${selectedLevel}` : '';
        const [perfRes, distRes, trendRes, stateRes, matrixRes] = await Promise.all([
          apiFetch<{ kpis: KpiMetric[] }>(`/api/reports/performance?period=${period}${levelParam}`),
          apiFetch<{ districts: DistrictReportRow[] }>('/api/reports/districts'),
          apiFetch<{ series: { label: string; demandUnits: number; availableSupplyUnits: number }[] }>(
            `/api/reports/inventory-trends?period=${period}`
          ),
          apiFetch<{ bottlenecks: typeof bottlenecks }>('/api/reports/state'),
          apiFetch<{ levels: LevelMatrixRow[] }>('/api/reports/levels-matrix'),
        ]);
        if (!active) return;
        setKpis(perfRes.kpis);
        setDistricts(distRes.districts);
        setTrends(trendRes.series);
        setBottlenecks(stateRes.bottlenecks);
        setLevelsMatrix(matrixRes.levels);
      } catch (err) {
        if (active) setErrorMsg(err instanceof Error ? err.message : 'Failed to load analytics.');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [period, selectedLevel]);

  function exportCsvReport() {
    const headers = ['District', 'Division', 'Nodes', 'AvailableUnits', 'Shortages', 'OpenAlerts', 'FulfilmentRatePct', 'DataStatus'];
    const rows = districts.map((d) => [
      d.districtName,
      d.division,
      d.nodeCount,
      d.availableUnits ?? 'UNAVAILABLE',
      d.shortageSkuCount ?? 'UNAVAILABLE',
      d.openAlertCount,
      d.fulfilmentRatePct ?? 'UNAVAILABLE',
      d.dataStatus,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `routerescue-mp-report-${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportJsonReport() {
    const payload = {
      generatedAt: new Date().toISOString(),
      period,
      distributionLevel: selectedLevel,
      role,
      kpis,
      districts,
      bottlenecks,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `routerescue-mp-report-${period}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const levels: ('ALL' | DistributionLevel)[] = [
    'ALL',
    'MANUFACTURER',
    'CNF_AGENT',
    'SUPER_STOCKIST',
    'WHOLESALER',
    'LOCAL_DISTRIBUTOR',
    'RETAIL_PHARMACY',
    'HOSPITAL_PHARMACY',
  ];

  const chartDistricts = districts.filter((d) => d.nodeCount > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Reporting &amp; Analytics Agent
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Database-computed Madhya Pradesh KPIs, district performance comparisons, bottlenecks, and exportable role-scoped reports.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            {(['daily', 'weekly', 'monthly'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  period === p ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <select
            value={selectedLevel}
            onChange={(e) => setSelectedLevel(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800"
          >
            {levels.map((lvl) => (
              <option key={lvl} value={lvl}>
                {lvl === 'ALL' ? 'All Supply Tiers' : formatLevelLabel(lvl)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={exportCsvReport}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
          <button
            type="button"
            onClick={exportJsonReport}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" /> JSON
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          {errorMsg}
        </div>
      )}

      {/* 8 Documented KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
            ))
          : kpis.map((kpi) => (
              <div key={kpi.key} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span>{kpi.label}</span>
                  <StatusIndicator status={kpi.dataStatus} />
                </div>
                <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
                  {kpi.status === 'AVAILABLE' && kpi.value !== null
                    ? `${kpi.value}${kpi.unit === '%' ? '%' : ` ${kpi.unit}`}`
                    : 'Unavailable'}
                </div>
                <p className="mt-1 text-[11px] leading-snug text-slate-500">
                  {kpi.status === 'UNAVAILABLE' ? kpi.unavailableReason : kpi.formula}
                </p>
              </div>
            ))}
      </div>

      {/* MP District Analytics Map */}
      <div className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">
          Madhya Pradesh District Coverage &amp; Distribution Map
        </h2>
        <MpMap nodes={nodes} shipments={shipments} heightClass="h-[340px]" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-base font-semibold text-slate-900">
            Inventory Supply vs. Demand Trend ({period})
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">Aggregated across active Madhya Pradesh nodes</p>
          <div className="mt-4 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="demandUnits" name="Daily Demand Units" stroke="#dc2626" strokeWidth={2} />
                <Line type="monotone" dataKey="availableSupplyUnits" name="Available Network Stock" stroke="#0f766e" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-base font-semibold text-slate-900">
            MP District Stock &amp; Open Incidents
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">Active reporting districts in Madhya Pradesh</p>
          <div className="mt-4 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartDistricts}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="districtName" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="availableUnits" name="Available Units" fill="#0f766e" />
                <Bar dataKey="shortageSkuCount" name="Shortage SKUs" fill="#dc2626" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Distribution Levels: Quantitative Numbers & Comparative Charts */}
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-base font-semibold text-slate-900">
              Distribution Level Stock vs. Capacity (All 7 Tiers)
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Available inventory units compared against registered tier storage capacity
            </p>
            <div className="mt-4 h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={levelsMatrix}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="availableStockUnits" name="Available Stock" fill="#0f766e" />
                  <Bar dataKey="totalCapacityUnits" name="Total Capacity" fill="#94a3b8" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-base font-semibold text-slate-900">
              Tier Fulfilment Rate (%) &amp; Shortage SKUs
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Level-by-level fulfilment efficiency and active shortage SKU counts
            </p>
            <div className="mt-4 h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={levelsMatrix}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="fulfilmentRatePct" name="Fulfilment Rate %" fill="#0284c7" />
                  <Bar dataKey="capacityUtilizationPct" name="Capacity Util %" fill="#0d9488" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Full 7-Level Numeric & Operational Need Table */}
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">
              7-Tier Supply-Chain Quantitative Matrix, Primary Addresses &amp; Defined Needs
            </h2>
            <span className="text-xs text-slate-500">Madhya Pradesh tier-by-tier audit view</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Distribution Level</th>
                  <th className="px-4 py-2.5 font-medium text-right">Nodes</th>
                  <th className="px-4 py-2.5 font-medium text-right">Available / Capacity</th>
                  <th className="px-4 py-2.5 font-medium text-right">Res / In / Out</th>
                  <th className="px-4 py-2.5 font-medium text-right">Shortages / Incidents</th>
                  <th className="px-4 py-2.5 font-medium text-right">Fulfilment / On-Time</th>
                  <th className="px-4 py-2.5 font-medium">Defined Need &amp; Primary Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {levelsMatrix.map((row) => (
                  <tr key={row.level} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 align-top">
                      <div className="font-semibold text-slate-900">{row.label}</div>
                      {onOpenLevelLogin && (
                        <button
                          type="button"
                          onClick={() => onOpenLevelLogin(row.level)}
                          className="mt-1 text-[11px] font-medium text-teal-700 hover:underline"
                        >
                          Login / Address
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums align-top">
                      {row.nodeCount}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums align-top">
                      <div className="font-semibold text-slate-900">
                        {row.availableStockUnits.toLocaleString('en-IN')}
                      </div>
                      <div className="text-slate-500">
                        / {row.totalCapacityUnits.toLocaleString('en-IN')} ({row.capacityUtilizationPct}%)
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums align-top text-slate-700">
                      {row.reservedUnits} / {row.incomingUnits} / {row.outgoingUnits}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums align-top">
                      <span className={row.shortageSkuCount > 0 ? 'font-semibold text-red-700' : 'text-slate-700'}>
                        {row.shortageSkuCount}
                      </span>
                      {' / '}
                      <span>{row.openIncidentCount}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums align-top">
                      <div>{row.fulfilmentRatePct !== null ? `${row.fulfilmentRatePct}%` : 'N/A'}</div>
                      <div className="text-slate-500">
                        OTD {row.onTimeDeliveryPct !== null ? `${row.onTimeDeliveryPct}%` : 'N/A'}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top max-w-md">
                      {row.needProfile && (
                        <div className="text-slate-800">
                          <strong>Need:</strong> {row.needProfile.primaryNeed}
                        </div>
                      )}
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {row.primaryAddress} (PIN {row.pinCode})
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* District Comparison Table & Active Bottlenecks */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-3">
            <h2 className="text-base font-semibold text-slate-900">Madhya Pradesh District Comparison</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2.5 font-medium">District</th>
                  <th className="px-4 py-2.5 font-medium">Division</th>
                  <th className="px-4 py-2.5 font-medium text-right">Nodes</th>
                  <th className="px-4 py-2.5 font-medium text-right">Available Stock</th>
                  <th className="px-4 py-2.5 font-medium text-right">Shortages</th>
                  <th className="px-4 py-2.5 font-medium text-right">Fulfilment</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {districts.map((d) => (
                  <tr key={d.districtId} className="hover:bg-slate-50/70">
                    <td className="px-4 py-2.5 font-medium text-slate-900">{d.districtName}</td>
                    <td className="px-4 py-2.5 text-slate-600">{d.division}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">{d.nodeCount}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {d.availableUnits !== null ? d.availableUnits.toLocaleString('en-IN') : 'Unavailable'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {d.shortageSkuCount !== null ? d.shortageSkuCount : 'Unavailable'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {d.fulfilmentRatePct !== null ? `${d.fulfilmentRatePct}%` : 'Unavailable'}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusIndicator status={d.dataStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-4 rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-base font-semibold text-slate-900">Distribution Bottlenecks</h2>
          <p className="mt-0.5 text-xs text-slate-500">Active corridor constraints affecting MP fulfilment</p>
          <div className="mt-3 divide-y divide-slate-100">
            {bottlenecks.length === 0 ? (
              <div className="py-8 text-xs text-slate-500">No active highway bottlenecks detected.</div>
            ) : (
              bottlenecks.map((b) => (
                <div key={b.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-900">{b.corridor}</span>
                    <span className="font-mono text-red-700">+{b.delayImpactMinutes}m</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    District: {b.districtId} · Severity: {b.severity}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
