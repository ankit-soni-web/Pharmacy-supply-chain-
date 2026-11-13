import { ArrowRight, Building2, CheckCircle2, Play, ShieldAlert, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import { persistApprovalToFirestore, persistAuditToFirestore } from '../lib/firebase.ts';
import {
  ActiveLevelSession,
  AgentEvent,
  AlertIncident,
  ApprovalRecommendation,
  DisruptionEvent,
  DistributionNode,
  KpiMetric,
  LevelMatrixRow,
  Medicine,
  MPDistrict,
  OperationalNeedProfile,
  ShipmentView,
  UserRole,
} from '../types/platform.ts';
import { formatLevelLabel, formatTimeShort, SeverityIndicator, StatusIndicator } from './DataStatusText.tsx';
import { MpMap } from './MpMap.tsx';
import { RapidReachPanel } from './RapidReachPanel.tsx';

interface OverviewViewProps {
  role: UserRole;
  districts: MPDistrict[];
  nodes: DistributionNode[];
  medicines: Medicine[];
  shipments: ShipmentView[];
  disruptions: DisruptionEvent[];
  approvals: ApprovalRecommendation[];
  alerts: AlertIncident[];
  events: AgentEvent[];
  kpis: KpiMetric[];
  levelNeeds: OperationalNeedProfile[];
  activeLevelSession: ActiveLevelSession | null;
  onOpenLevelLogin: (lvl: UserRole) => void;
  onRefreshAll: () => Promise<void>;
  onNavigate: (tab: string) => void;
}

export function OverviewView({
  role,
  districts,
  nodes,
  medicines,
  shipments,
  disruptions,
  approvals,
  alerts,
  events,
  kpis,
  levelNeeds,
  activeLevelSession,
  onOpenLevelLogin,
  onRefreshAll,
  onNavigate,
}: OverviewViewProps) {
  const retailAndHospNodes = nodes.filter(
    (n) => n.level === 'RETAIL_PHARMACY' || n.level === 'HOSPITAL_PHARMACY' || n.level === 'WHOLESALER'
  );
  const [scenarioNodeId, setScenarioNodeId] = useState(retailAndHospNodes[0]?.id ?? nodes[0]?.id ?? '');
  const [scenarioMedId, setScenarioMedId] = useState(medicines[2]?.id ?? medicines[0]?.id ?? '');
  const [scenarioBusy, setScenarioBusy] = useState(false);
  const [scenarioNotice, setScenarioNotice] = useState<string | null>(null);
  const [approvalBusyId, setApprovalBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [levelsMatrix, setLevelsMatrix] = useState<LevelMatrixRow[]>([]);

  useEffect(() => {
    apiFetch<{ levels: LevelMatrixRow[] }>('/api/reports/levels-matrix')
      .then((res) => setLevelsMatrix(res.levels))
      .catch(() => {});
  }, [nodes, approvals, alerts]);

  const pendingApprovals = approvals.filter((a) => a.status === 'PENDING');
  const openAlerts = alerts.filter((a) => a.status !== 'RESOLVED');
  const activeTierNeed = levelNeeds.find((n) => n.level === role);

  async function runIntegratedScenario() {
    if (!scenarioNodeId || !scenarioMedId) return;
    setScenarioBusy(true);
    setActionError(null);
    setScenarioNotice(null);
    try {
      const res = await apiFetch<{
        shortageInventory: { nodeName: string; medicineBrand: string; availableQty: number };
        recommendation: ApprovalRecommendation | null;
      }>('/api/supply/report-shortage', {
        method: 'POST',
        body: JSON.stringify({
          nodeId: scenarioNodeId,
          medicineId: scenarioMedId,
          reportedQtyRemaining: 8,
        }),
      });
      await persistAuditToFirestore({
        actorRole: role,
        action: 'SCENARIO_SHORTAGE_REPORTED',
        entityType: 'Inventory',
        entityId: scenarioNodeId,
        details: `Reported shortage of ${res.shortageInventory.medicineBrand} at ${res.shortageInventory.nodeName}.`,
      });
      setScenarioNotice(
        res.recommendation
          ? `Supply Agent detected shortage at ${res.shortageInventory.nodeName}, Route Agent verified transit feasibility, Alert Agent logged incident, and transfer recommendation "${res.recommendation.title}" is queued for human approval.`
          : `Shortage detected at ${res.shortageInventory.nodeName} and logged to Alert Agent.`
      );
      await onRefreshAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Scenario execution failed.');
    } finally {
      setScenarioBusy(false);
    }
  }

  async function handleApprovalDecision(approval: ApprovalRecommendation, decision: 'APPROVED' | 'REJECTED') {
    setApprovalBusyId(approval.id);
    setActionError(null);
    try {
      await apiFetch('/api/supply/approve-transfer', {
        method: 'POST',
        body: JSON.stringify({
          approvalId: approval.id,
          decision,
          notes: `${decision} via Command Overview by ${role}`,
        }),
      });
      const med = medicines.find((m) => m.id === approval.medicineId);
      await persistApprovalToFirestore({
        approvalId: approval.id,
        recommendationType: approval.recommendationType,
        medicineName: med?.brandName ?? approval.medicineId,
        sourceNodeId: approval.sourceNodeId,
        targetNodeId: approval.targetNodeId,
        quantity: approval.quantity,
        status: decision,
        reviewerRole: role,
      });
      await onRefreshAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not submit approval decision.');
    } finally {
      setApprovalBusyId(null);
    }
  }

  const topKpis = kpis.slice(0, 4);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Madhya Pradesh Command Overview
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Unified operational state across {nodes.length} distribution nodes in {districts.length} MP districts · Active role: {formatLevelLabel(role)}
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span>Open Incidents: <strong className="font-mono text-slate-900 tabular-nums">{openAlerts.length}</strong></span>
          <span aria-hidden="true">·</span>
          <span>Pending Approvals: <strong className="font-mono text-slate-900 tabular-nums">{pendingApprovals.length}</strong></span>
          <span aria-hidden="true">·</span>
          <span>Active Shipments: <strong className="font-mono text-slate-900 tabular-nums">{shipments.length}</strong></span>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {topKpis.map((kpi) => (
          <div key={kpi.key} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
              <span>{kpi.label}</span>
              <StatusIndicator status={kpi.dataStatus} />
            </div>
            <div className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {kpi.status === 'AVAILABLE' && kpi.value !== null ? `${kpi.value}${kpi.unit === '%' ? '%' : ` ${kpi.unit}`}` : 'Unavailable'}
            </div>
            <p className="mt-1 truncate text-xs text-slate-500" title={kpi.formula}>
              {kpi.formula}
            </p>
          </div>
        ))}
      </div>

      {/* 5 Integrated Agents Directory */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">
            Five Integrated Intelligence Agents
          </h2>
          <span className="text-xs text-slate-500">
            Connected via shared Event Bus &amp; Madhya Pradesh database
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          {[
            {
              tab: 'routes',
              title: '01. Route & Logistics Agent',
              summary: `${shipments.length} MP shipments · ${disruptions.filter((d) => d.active).length} active disruptions`,
              detail: 'OSRM routing, cold-chain checks, alternatives & delay prediction',
            },
            {
              tab: 'supply',
              title: '02. Supply Management Agent',
              summary: `${pendingApprovals.length} pending approvals · ${nodes.length} nodes`,
              detail: 'Multi-tier inventory, demand forecasting & human-gated transfers',
            },
            {
              tab: 'reports',
              title: '03. Reporting & Analytics Agent',
              summary: `${kpis.length} computed KPIs · ${districts.length} districts`,
              detail: 'District comparisons, bottlenecks, trends & CSV/JSON exports',
            },
            {
              tab: 'alerts',
              title: '04. Alert & Root-Cause Agent',
              summary: `${openAlerts.length} open incidents · ${openAlerts.filter((a) => a.escalated).length} escalated`,
              detail: 'Confirmed/Probable root causes, evidence & resolution tracking',
            },
            {
              tab: 'pharma',
              title: '05. Pharma Knowledge RAG',
              summary: `${medicines.length} medicines · NPPA & ABDM HFR`,
              detail: 'Gemini + vector RAG, price tiers, comparisons & live stock lookup',
            },
          ].map((agent) => (
            <button
              key={agent.tab}
              type="button"
              onClick={() => onNavigate(agent.tab)}
              className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-4 text-left transition-colors hover:border-teal-700"
            >
              <div>
                <div className="text-sm font-semibold text-slate-900">{agent.title}</div>
                <div className="mt-1 font-mono text-xs text-teal-800">{agent.summary}</div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{agent.detail}</p>
              </div>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-teal-700">
                Open Workspace <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Active Role Defined Need + 7-Tier Login & Address Directory */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              7 Supply-Chain Levels: Numbers, Full Addresses, Defined Needs &amp; Tier Logins
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              {activeLevelSession
                ? `Verified Session: ${activeLevelSession.organizationName} · ${activeLevelSession.fullAddress} (PIN ${activeLevelSession.pinCode})`
                : activeTierNeed
                  ? `Active Role Need (${activeTierNeed.label}): ${activeTierNeed.primaryNeed}`
                  : 'All 7 Madhya Pradesh distribution tiers with facility numbers, registered street addresses, SLA needs, and scoped login access.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('reports')}
            className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-900"
          >
            View Level Charts <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {levelsMatrix.map((lvl) => (
            <div
              key={lvl.level}
              className={`flex flex-col justify-between rounded-md border p-3.5 text-xs ${
                role === lvl.level ? 'border-teal-700 bg-teal-50/40' : 'border-slate-200 bg-slate-50/50'
              }`}
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">{lvl.label}</span>
                  <span className="font-mono tabular-nums text-[11px] text-slate-600">
                    {lvl.nodeCount} node{lvl.nodeCount !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="font-mono text-[11px] tabular-nums text-slate-700">
                  Stock: <strong>{lvl.availableStockUnits.toLocaleString('en-IN')}</strong> · Util {lvl.capacityUtilizationPct}% · Shortages {lvl.shortageSkuCount}
                </div>
                <div className="text-[11px] text-slate-600 line-clamp-2">
                  <strong>Address:</strong> {lvl.primaryAddress} (PIN {lvl.pinCode})
                </div>
                {lvl.needProfile && (
                  <div className="text-[11px] text-slate-600 line-clamp-2">
                    <strong>Need:</strong> {lvl.needProfile.primaryNeed}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => onOpenLevelLogin(lvl.level)}
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-800 hover:border-teal-700 hover:text-teal-800"
              >
                <Building2 className="h-3 w-3" />
                Login / Address ({formatLevelLabel(lvl.level).split(' ')[0]})
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* End-to-End Integrated Cross-Agent Workflow Trigger */}
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="text-base font-semibold text-slate-900">
              Integrated Cross-Agent Shortage Simulation
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Simulate a pharmacy or wholesaler shortage report in Madhya Pradesh to trigger Supply detection, Route feasibility check, Alert root-cause creation, and a human-gated redistribution recommendation.
            </p>
          </div>
          <button
            type="button"
            onClick={runIntegratedScenario}
            disabled={scenarioBusy}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap"
          >
            <Play className="h-3.5 w-3.5" />
            {scenarioBusy ? 'Dispatching Agents...' : 'Report Shortage & Orchestrate'}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-slate-700">
            Target MP Distribution Node
            <select
              value={scenarioNodeId}
              onChange={(e) => setScenarioNodeId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
            >
              {retailAndHospNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name} ({n.city} · {formatLevelLabel(n.level)})
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-700">
            Medicine Formulation
            <select
              value={scenarioMedId}
              onChange={(e) => setScenarioMedId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
            >
              {medicines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.brandName} ({m.genericName} · {m.strength})
                </option>
              ))}
            </select>
          </label>
        </div>

        {scenarioNotice && (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-900">
            {scenarioNotice}
          </div>
        )}
        {actionError && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {actionError}
          </div>
        )}
      </div>

      {/* Map + Pending Human Approvals */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">
              MP Network &amp; Active Corridors
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('routes')}
              className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-900"
            >
              Open Route Workspace <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <MpMap nodes={nodes} shipments={shipments} disruptions={disruptions} heightClass="h-[380px]" />
        </div>

        <div className="lg:col-span-5 flex flex-col">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">
              Human Approval Queue
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('supply')}
              className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-900"
            >
              Supply Console <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex-1 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
            {pendingApprovals.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-500">
                No pending stock redistribution approvals. All recommendations have been reviewed.
              </div>
            ) : (
              pendingApprovals.slice(0, 3).map((apr) => (
                <div key={apr.id} className="border-b border-slate-100 pb-3 last:border-b-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span>{apr.recommendationType} · {apr.quantity} units</span>
                    <StatusIndicator status={apr.dataStatus} />
                  </div>
                  <h3 className="mt-1 text-sm font-semibold text-slate-900">{apr.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">{apr.rationale}</p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <span className="font-mono tabular-nums">
                      ETA {apr.estimatedEtaMinutes}m · ₹{apr.estimatedTransportCostInr}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={approvalBusyId === apr.id}
                        onClick={() => handleApprovalDecision(apr, 'REJECTED')}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        <XCircle className="h-3.5 w-3.5" /> Reject
                      </button>
                      <button
                        type="button"
                        disabled={approvalBusyId === apr.id}
                        onClick={() => handleApprovalDecision(apr, 'APPROVED')}
                        className="inline-flex items-center gap-1 rounded bg-teal-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Active Alerts & Shared Event Bus Stream */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Priority Incidents</h2>
            <button
              type="button"
              onClick={() => onNavigate('alerts')}
              className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-900"
            >
              Investigate All <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {openAlerts.slice(0, 4).map((alert) => (
              <div key={alert.id} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <SeverityIndicator severity={alert.severity} />
                    <span className="text-slate-400">·</span>
                    <span className="font-mono text-slate-500">{alert.incidentCode}</span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-600">{alert.causeCertainty}</span>
                  </div>
                  <span className="font-mono text-[11px] text-slate-500">{formatTimeShort(alert.createdAt)}</span>
                </div>
                <p className="mt-1 text-sm font-medium text-slate-900">{alert.title}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Central Agent Event Stream</h2>
            <span className="font-mono text-xs text-slate-500">{events.length} dispatched</span>
          </div>
          <div className="divide-y divide-slate-100">
            {events.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">
                No live agent events triggered in this session yet. Trigger a route optimization, disruption, or shortage report to observe cross-agent events.
              </div>
            ) : (
              events.slice(0, 5).map((ev) => (
                <div key={ev.event_id} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono font-medium text-slate-900">{ev.event_type}</span>
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                      {formatTimeShort(ev.timestamp)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>{ev.source_agent}</span>
                    <span aria-hidden="true">·</span>
                    <span>{ev.district_id}</span>
                    <span aria-hidden="true">·</span>
                    <StatusIndicator status={ev.data_status} />
                    {ev.requires_approval && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                          <ShieldAlert className="h-3 w-3" /> Approval Required
                        </span>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Privacy-Scoped 1-Hop Rapid-Reach Panel */}
      <RapidReachPanel role={role} compact />
    </div>
  );
}
