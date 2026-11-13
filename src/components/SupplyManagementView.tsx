import { ArrowLeftRight, CheckCircle2, PackagePlus, Sparkles, TrendingUp, XCircle } from 'lucide-react';
import { useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiFetch } from '../lib/api.ts';
import { persistApprovalToFirestore } from '../lib/firebase.ts';
import {
  ApprovalRecommendation,
  DistributionNode,
  EnrichedInventoryRow,
  Medicine,
  MPDistrict,
  OperationalNeedProfile,
  PredictiveEvaluationResult,
  UserRole,
} from '../types/platform.ts';
import { formatLevelLabel, formatTimeShort, StatusIndicator } from './DataStatusText.tsx';
import { PredictiveOutcomesPanel } from './PredictiveOutcomesPanel.tsx';
import { RapidReachPanel } from './RapidReachPanel.tsx';

interface SupplyManagementViewProps {
  role: UserRole;
  districts: MPDistrict[];
  nodes: DistributionNode[];
  medicines: Medicine[];
  inventory: EnrichedInventoryRow[];
  approvals: ApprovalRecommendation[];
  levelNeeds: OperationalNeedProfile[];
  onRefresh: () => Promise<void>;
}

interface ForecastResult {
  inventoryId: string;
  nodeName: string;
  medicineBrand: string;
  historicalSeries: { day: string; actualQty: number }[];
  forecastSeries: { day: number; predictedQty: number; lowerBound: number; upperBound: number }[];
  dailyForecast: number;
  horizonTotal: number;
  trendPct: number;
  method: string;
  projectedStockoutInDays: number | null;
}

export function SupplyManagementView({
  role,
  districts,
  nodes,
  medicines,
  inventory,
  approvals,
  levelNeeds,
  onRefresh,
}: SupplyManagementViewProps) {
  const [filterDistrict, setFilterDistrict] = useState('ALL');
  const [filterTab, setFilterTab] = useState<'ALL' | 'SHORTAGE' | 'EXCESS_EXPIRY'>('ALL');
  const [searchText, setSearchText] = useState('');
  const [forecast, setForecast] = useState<ForecastResult | null>(null);
  const [prediction, setPrediction] = useState<PredictiveEvaluationResult | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const activeTierNeed = levelNeeds.find((n) => n.level === role);

  const filtered = inventory.filter((row) => {
    if (filterDistrict !== 'ALL' && row.districtId !== filterDistrict) return false;
    if (filterTab === 'SHORTAGE' && !row.flags.shortage) return false;
    if (filterTab === 'EXCESS_EXPIRY' && !row.flags.excess && !row.flags.expiryRisk) return false;
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      return (
        row.medicineBrand.toLowerCase().includes(q) ||
        row.genericName.toLowerCase().includes(q) ||
        row.nodeName.toLowerCase().includes(q) ||
        row.batchNumber.toLowerCase().includes(q)
      );
    }
    return true;
  });

  async function handleRunForecast(inventoryId: string) {
    setBusyId(inventoryId);
    setErrorMsg(null);
    try {
      const data = await apiFetch<ForecastResult>('/api/supply/forecast', {
        method: 'POST',
        body: JSON.stringify({ inventoryId, horizonDays: 7 }),
      });
      setForecast(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Forecast failed.');
    } finally {
      setBusyId(null);
    }
  }

  async function handlePredictOutcomes(inventoryId: string) {
    setBusyId(`pred-${inventoryId}`);
    setErrorMsg(null);
    try {
      const data = await apiFetch<PredictiveEvaluationResult>('/api/predictive/evaluate', {
        method: 'POST',
        body: JSON.stringify({ entityType: 'INVENTORY', entityId: inventoryId }),
      });
      setPrediction(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Predictive evaluation failed.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleRecommendRedistribution(row: EnrichedInventoryRow) {
    setBusyId(`red-${row.id}`);
    setErrorMsg(null);
    setMessage(null);
    try {
      const res = await apiFetch<{ recommendation: ApprovalRecommendation }>('/api/supply/redistribution', {
        method: 'POST',
        body: JSON.stringify({
          targetNodeId: row.nodeId,
          medicineId: row.medicineId,
          requestedQty: Math.max(50, row.reorderLevel - row.availableQty),
        }),
      });
      setMessage(`Created pending redistribution recommendation: ${res.recommendation.title}`);
      await onRefresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not generate redistribution plan.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleRecommendReplenishment(row: EnrichedInventoryRow) {
    setBusyId(`rep-${row.id}`);
    setErrorMsg(null);
    setMessage(null);
    try {
      const res = await apiFetch<{ recommendation: ApprovalRecommendation }>('/api/supply/replenishment', {
        method: 'POST',
        body: JSON.stringify({
          targetNodeId: row.nodeId,
          medicineId: row.medicineId,
          quantity: Math.max(200, row.reorderLevel * 2 - row.availableQty),
        }),
      });
      setMessage(`Created pending replenishment recommendation: ${res.recommendation.title}`);
      await onRefresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not generate replenishment order.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleApprovalDecision(apr: ApprovalRecommendation, decision: 'APPROVED' | 'REJECTED') {
    setBusyId(apr.id);
    setErrorMsg(null);
    setMessage(null);
    try {
      await apiFetch('/api/supply/approve-transfer', {
        method: 'POST',
        body: JSON.stringify({
          approvalId: apr.id,
          decision,
          notes: `${decision} by ${role}`,
        }),
      });
      const med = medicines.find((m) => m.id === apr.medicineId);
      await persistApprovalToFirestore({
        approvalId: apr.id,
        recommendationType: apr.recommendationType,
        medicineName: med?.brandName ?? apr.medicineId,
        sourceNodeId: apr.sourceNodeId,
        targetNodeId: apr.targetNodeId,
        quantity: apr.quantity,
        status: decision,
        reviewerRole: role,
      });
      setMessage(`Recommendation ${decision.toLowerCase()} and recorded in immutable audit trail.`);
      await onRefresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Decision failed.');
    } finally {
      setBusyId(null);
    }
  }

  const combinedChartData = forecast
    ? [
        ...forecast.historicalSeries.map((h) => ({
          label: h.day,
          actual: h.actualQty,
          predicted: null as number | null,
        })),
        ...forecast.forecastSeries.map((f) => ({
          label: `+${f.day}d`,
          actual: null as number | null,
          predicted: f.predictedQty,
        })),
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Supply Management Agent
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Multi-tier MP inventory visibility, batch expiry tracking, demand forecasting, and human-approved stock redistribution.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busyId === 'scan'}
            onClick={async () => {
              setBusyId('scan');
              setErrorMsg(null);
              try {
                const res = await apiFetch<{
                  scannedRecords: number;
                  shortageCount: number;
                  excessCount: number;
                  expiryRiskCount: number;
                }>('/api/supply/scan', { method: 'POST' });
                setMessage(
                  `Scanned ${res.scannedRecords} batches: ${res.shortageCount} shortages, ${res.excessCount} excess stock, ${res.expiryRiskCount} expiry risks published to Event Bus.`
                );
                await onRefresh();
              } catch (err) {
                setErrorMsg(err instanceof Error ? err.message : 'Inventory scan failed.');
              } finally {
                setBusyId(null);
              }
            }}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            {busyId === 'scan' ? 'Scanning...' : 'Scan Excess & Expiry'}
          </button>
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            {(['ALL', 'SHORTAGE', 'EXCESS_EXPIRY'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilterTab(tab)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  filterTab === tab ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab === 'ALL' ? 'All Stock' : tab === 'SHORTAGE' ? 'Shortages' : 'Excess & Expiry'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          {errorMsg}
        </div>
      )}
      {message && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900">
          {message}
        </div>
      )}

      {activeTierNeed && (
        <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-xs space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-slate-900">
              Tier Operational Need ({activeTierNeed.label})
            </span>
            <span className="font-mono text-teal-800">
              SLA {activeTierNeed.targetResponseSlaMinutes}m · {activeTierNeed.regulatoryConstraint}
            </span>
          </div>
          <p className="text-slate-700">
            <strong>Primary Need:</strong> {activeTierNeed.primaryNeed}
          </p>
          <p className="text-slate-600">
            <strong>Related Info:</strong> {activeTierNeed.relatedInfo}
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Filter by medicine, generic, node, or batch..."
          className="w-full max-w-sm rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
        />
        <select
          value={filterDistrict}
          onChange={(e) => setFilterDistrict(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
        >
          <option value="ALL">All MP Districts ({districts.length})</option>
          {districts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">
          Showing <strong className="font-mono text-slate-900 tabular-nums">{filtered.length}</strong> of {inventory.length} batch records
        </span>
      </div>

      {/* Inventory Table */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2.5 font-medium">Node &amp; District</th>
                <th className="px-4 py-2.5 font-medium">Medicine &amp; Batch</th>
                <th className="px-4 py-2.5 font-medium text-right">Available</th>
                <th className="px-4 py-2.5 font-medium text-right">Res / In / Out</th>
                <th className="px-4 py-2.5 font-medium text-right">Safety / Reorder</th>
                <th className="px-4 py-2.5 font-medium text-right">Cover / Expiry</th>
                <th className="px-4 py-2.5 font-medium">Signals &amp; Source</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{row.nodeName}</div>
                    <div className="text-slate-500">
                      {formatLevelLabel(row.nodeLevel)} · {row.city}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{row.medicineBrand}</div>
                    <div className="font-mono text-slate-500">
                      {row.batchNumber} · Exp {row.expiryDate}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums text-slate-900">
                    {row.availableQty.toLocaleString('en-IN')}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-600">
                    {row.reservedQty} / {row.incomingQty} / {row.outgoingQty}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-600">
                    {row.safetyStock} / {row.reorderLevel}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    <div className={row.daysOfCover !== null && row.daysOfCover < 3 ? 'font-semibold text-red-700' : 'text-slate-800'}>
                      {row.daysOfCover !== null ? `${row.daysOfCover}d cover` : 'N/A'}
                    </div>
                    <div className={row.daysToExpiry <= 65 ? 'text-amber-700 font-medium' : 'text-slate-500'}>
                      {row.daysToExpiry}d to exp
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-0.5">
                      {row.flags.criticalShortage && (
                        <div className="font-semibold text-red-700">CRITICAL SHORTAGE</div>
                      )}
                      {!row.flags.criticalShortage && row.flags.shortage && (
                        <div className="font-medium text-amber-700">BELOW REORDER</div>
                      )}
                      {row.flags.excess && <div className="font-medium text-sky-700">EXCESS STOCK</div>}
                      {row.flags.expiryRisk && <div className="font-medium text-amber-700">EXPIRY RISK</div>}
                      {row.flags.highDemand && (
                        <div className="text-slate-700">Demand +{row.demandTrendPct}%</div>
                      )}
                      <div className="text-slate-500">
                        <StatusIndicator status={row.dataStatus} /> · {formatTimeShort(row.updatedAt)}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex flex-wrap justify-end gap-1.5">
                      <button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => handleRunForecast(row.id)}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <TrendingUp className="h-3 w-3" /> Forecast
                      </button>
                      <button
                        type="button"
                        disabled={busyId === `pred-${row.id}`}
                        onClick={() => handlePredictOutcomes(row.id)}
                        className="inline-flex items-center gap-1 rounded border border-teal-700 bg-white px-2 py-1 text-[11px] font-medium text-teal-800 hover:bg-teal-50"
                      >
                        <Sparkles className="h-3 w-3" /> Predict Outcomes
                      </button>
                      {row.flags.shortage && (
                        <>
                          <button
                            type="button"
                            disabled={busyId === `red-${row.id}`}
                            onClick={() => handleRecommendRedistribution(row)}
                            className="inline-flex items-center gap-1 rounded bg-teal-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-teal-800"
                          >
                            <ArrowLeftRight className="h-3 w-3" /> Redistribute
                          </button>
                          <button
                            type="button"
                            disabled={busyId === `rep-${row.id}`}
                            onClick={() => handleRecommendReplenishment(row)}
                            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <PackagePlus className="h-3 w-3" /> Replenish
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {prediction && (
        <PredictiveOutcomesPanel evaluation={prediction} onClose={() => setPrediction(null)} />
      )}

      {/* Forecast Chart + Human Approval Queue */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-6 rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-base font-semibold text-slate-900">
            Demand Forecasting &amp; Stockout Projection
          </h2>
          {forecast ? (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                <span>
                  <strong className="text-slate-900">{forecast.medicineBrand}</strong> at {forecast.nodeName}
                </span>
                <span className="font-mono tabular-nums">
                  {forecast.dailyForecast}/day · Trend {forecast.trendPct >= 0 ? `+${forecast.trendPct}%` : `${forecast.trendPct}%`}
                </span>
              </div>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={combinedChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="actual" name="Historical Consumption" stroke="#0f172a" strokeWidth={2} dot={{ r: 2.5 }} />
                    <Line type="monotone" dataKey="predicted" name="7-Day Forecast" stroke="#0f766e" strokeWidth={2} strokeDasharray="5 4" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="text-xs text-slate-500">
                Model: {forecast.method} · 7-day projected demand: <strong className="font-mono text-slate-900">{forecast.horizonTotal} units</strong> · Projected stockout in <strong className="font-mono text-slate-900">{forecast.projectedStockoutInDays ?? 'N/A'} days</strong>
              </div>
            </div>
          ) : (
            <div className="py-16 text-center text-sm text-slate-500">
              Select &ldquo;Forecast&rdquo; on any inventory row above to plot historical consumption and 7-day demand projections.
            </div>
          )}
        </div>

        <div className="lg:col-span-6 rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">
              Transfer &amp; Replenishment Approvals
            </h2>
            <span className="text-xs text-slate-500">No autonomous transfers permitted</span>
          </div>
          <div className="mt-3 space-y-3 max-h-80 overflow-y-auto pr-1">
            {approvals.map((apr) => {
              const src = nodes.find((n) => n.id === apr.sourceNodeId);
              const tgt = nodes.find((n) => n.id === apr.targetNodeId);
              return (
                <div key={apr.id} className="border-b border-slate-100 pb-3 last:border-b-0">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono font-semibold text-slate-700">
                      {apr.recommendationType} · {apr.status}
                    </span>
                    <StatusIndicator status={apr.dataStatus} />
                  </div>
                  <h3 className="mt-1 text-sm font-semibold text-slate-900">{apr.title}</h3>
                  <p className="mt-1 text-xs text-slate-600">{apr.rationale}</p>
                  <p className="mt-1 text-xs text-slate-700">
                    <strong>Expected Impact:</strong> {apr.expectedImpact}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <span className="font-mono tabular-nums">
                      {src?.city ?? apr.sourceNodeId} &rarr; {tgt?.city ?? apr.targetNodeId} · {apr.estimatedEtaMinutes}m · ₹{apr.estimatedTransportCostInr} · Cold-chain: {apr.coldChainCompatible ? 'OK' : 'INCOMPATIBLE'}
                    </span>
                    {apr.status === 'PENDING' ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busyId === apr.id}
                          onClick={() => handleApprovalDecision(apr, 'REJECTED')}
                          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <XCircle className="h-3.5 w-3.5" /> Reject
                        </button>
                        <button
                          type="button"
                          disabled={busyId === apr.id}
                          onClick={() => handleApprovalDecision(apr, 'APPROVED')}
                          className="inline-flex items-center gap-1 rounded bg-teal-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-800"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Approve &amp; Dispatch
                        </button>
                      </div>
                    ) : (
                      <span className="font-mono text-[11px] text-slate-600">
                        {apr.status} by {apr.reviewerRole} · {formatTimeShort(apr.reviewedAt)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <RapidReachPanel
        role={role}
        defaultNeedSummary={
          prediction?.definedNeed ??
          'Urgent adjacent tier stock confirmation & rapid dispatch requested by Supply Agent.'
        }
      />
    </div>
  );
}
