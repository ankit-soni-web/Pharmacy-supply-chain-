import { AlertOctagon, ArrowUpRight, CheckCircle, UserCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import { persistAuditToFirestore } from '../lib/firebase.ts';
import {
  AlertIncident,
  MPDistrict,
  OperationalNeedProfile,
  PredictiveEvaluationResult,
  UserRole,
} from '../types/platform.ts';
import { formatLevelLabel, formatTimeShort, SeverityIndicator, StatusIndicator } from './DataStatusText.tsx';
import { PredictiveOutcomesPanel } from './PredictiveOutcomesPanel.tsx';
import { RapidReachPanel } from './RapidReachPanel.tsx';

interface AlertsRootCauseViewProps {
  role: UserRole;
  districts: MPDistrict[];
  alerts: AlertIncident[];
  levelNeeds: OperationalNeedProfile[];
  onRefresh: () => Promise<void>;
}

interface RootCauseStat {
  category: string;
  count: number;
  confirmedCount: number;
  probableCount: number;
  suspectedCount: number;
}

export function AlertsRootCauseView({
  role,
  districts,
  alerts,
  levelNeeds,
  onRefresh,
}: AlertsRootCauseViewProps) {
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedId, setSelectedId] = useState<string>(alerts[0]?.id ?? '');
  const [rootCauses, setRootCauses] = useState<RootCauseStat[]>([]);
  const [resolutionMeta, setResolutionMeta] = useState<{
    resolvedCount: number;
    openCount: number;
    averageResolutionMinutes: number | null;
    reason?: string;
  } | null>(null);
  const [incidentPrediction, setIncidentPrediction] = useState<PredictiveEvaluationResult | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [assigneeInput, setAssigneeInput] = useState('MP District Supply Coordinator');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<{ rootCauses: RootCauseStat[] }>('/api/incidents/root-causes'),
      apiFetch<typeof resolutionMeta>('/api/incidents/resolution-times'),
    ])
      .then(([rc, rt]) => {
        setRootCauses(rc.rootCauses);
        setResolutionMeta(rt);
      })
      .catch(() => {});
  }, [alerts]);

  const filtered = alerts.filter((a) => {
    if (severityFilter !== 'ALL' && a.severity !== severityFilter) return false;
    if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
    return true;
  });

  const activeAlert = filtered.find((a) => a.id === selectedId) ?? filtered[0] ?? null;
  const activeAlertNeed = activeAlert?.distributionLevel
    ? levelNeeds.find((n) => n.level === activeAlert.distributionLevel)
    : undefined;

  useEffect(() => {
    if (!activeAlert) {
      setIncidentPrediction(null);
      return;
    }
    let active = true;
    apiFetch<PredictiveEvaluationResult>('/api/predictive/evaluate', {
      method: 'POST',
      body: JSON.stringify({ entityType: 'INCIDENT', entityId: activeAlert.id }),
    })
      .then((res) => {
        if (active) setIncidentPrediction(res);
      })
      .catch(() => {
        if (active) setIncidentPrediction(null);
      });
    return () => {
      active = false;
    };
  }, [activeAlert?.id]);

  async function handleAcknowledge(id: string) {
    setBusy(true);
    setErrorMsg(null);
    try {
      await apiFetch(`/api/alerts/${id}/acknowledge`, { method: 'POST' });
      await persistAuditToFirestore({
        actorRole: role,
        action: 'INCIDENT_ACKNOWLEDGED',
        entityType: 'AlertIncident',
        entityId: id,
        details: `Incident ${id} acknowledged by ${role}.`,
      });
      await onRefresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Acknowledge failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleAssignOrEscalate(id: string, escalate: boolean) {
    setBusy(true);
    setErrorMsg(null);
    try {
      await apiFetch(`/api/alerts/${id}/assign`, {
        method: 'POST',
        body: JSON.stringify({ assignee: assigneeInput, escalate }),
      });
      await onRefresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Assignment failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleResolve(id: string) {
    setBusy(true);
    setErrorMsg(null);
    try {
      await apiFetch(`/api/alerts/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({
          resolutionNotes: resolutionNotes.trim() || 'Verified resolution and corrective action logged.',
        }),
      });
      await persistAuditToFirestore({
        actorRole: role,
        action: 'INCIDENT_RESOLVED',
        entityType: 'AlertIncident',
        entityId: id,
        details: resolutionNotes.trim() || 'Resolved incident.',
      });
      setResolutionNotes('');
      await onRefresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Resolve failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Alert, Root-Cause &amp; Resolution Agent
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Cross-agent incident detection, evidence-backed root-cause investigation (Confirmed vs. Probable vs. Suspected), and escalation workflows.
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-600">
          <span>
            Open: <strong className="font-mono text-slate-900 tabular-nums">{resolutionMeta?.openCount ?? alerts.filter((a) => a.status !== 'RESOLVED').length}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Resolved: <strong className="font-mono text-slate-900 tabular-nums">{resolutionMeta?.resolvedCount ?? 0}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Mean Resolution:{' '}
            <strong className="font-mono text-slate-900 tabular-nums">
              {resolutionMeta?.averageResolutionMinutes !== null && resolutionMeta?.averageResolutionMinutes !== undefined
                ? `${resolutionMeta.averageResolutionMinutes}m`
                : 'Unavailable'}
            </strong>
          </span>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          {errorMsg}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800"
        >
          <option value="ALL">All Severities</option>
          <option value="CRITICAL">CRITICAL</option>
          <option value="HIGH">HIGH</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="LOW">LOW</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800"
        >
          <option value="ALL">All Statuses</option>
          <option value="OPEN">OPEN</option>
          <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
          <option value="INVESTIGATING">INVESTIGATING</option>
          <option value="ESCALATED">ESCALATED</option>
          <option value="RESOLVED">RESOLVED</option>
        </select>
      </div>

      {/* Master-Detail Incident Workspace */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-5 divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              No incidents match the selected filters.
            </div>
          ) : (
            filtered.map((item) => {
              const dist = districts.find((d) => d.id === item.districtId);
              const isSelected = activeAlert?.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`w-full text-left p-4 transition-colors ${
                    isSelected ? 'bg-slate-50' : 'bg-white hover:bg-slate-50/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <SeverityIndicator severity={item.severity} />
                      <span className="text-slate-400">·</span>
                      <span className="font-mono text-slate-600">{item.incidentCode}</span>
                    </div>
                    <span className="font-mono text-[11px] font-medium text-slate-700">{item.status}</span>
                  </div>
                  <div className="mt-1.5 text-sm font-semibold text-slate-900">{item.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>{dist?.name ?? item.districtId}</span>
                    <span aria-hidden="true">·</span>
                    <span>{item.causeCertainty} {item.rootCauseCategory.replace(/_/g, ' ')}</span>
                    <span aria-hidden="true">·</span>
                    <StatusIndicator status={item.dataStatus} />
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="lg:col-span-7">
          {activeAlert ? (
            <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-5">
              <div className="border-b border-slate-200 pb-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <div className="flex items-center gap-2">
                    <SeverityIndicator severity={activeAlert.severity} />
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">{activeAlert.incidentCode}</span>
                    <span aria-hidden="true">·</span>
                    <span>Status: <strong className="text-slate-900">{activeAlert.status}</strong></span>
                    {activeAlert.escalated && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-semibold text-red-700">ESCALATED</span>
                      </>
                    )}
                  </div>
                  <StatusIndicator status={activeAlert.dataStatus} />
                </div>
                <h2 className="mt-2 text-lg font-semibold text-slate-900">{activeAlert.title}</h2>
                <div className="mt-1 text-xs text-slate-500">
                  District: {districts.find((d) => d.id === activeAlert.districtId)?.name ?? activeAlert.districtId}
                  {' · '}Tier: {formatLevelLabel(activeAlert.distributionLevel)}
                  {' · '}Created: {formatTimeShort(activeAlert.createdAt)}
                  {activeAlert.assignedTo ? ` · Assigned: ${activeAlert.assignedTo}` : ''}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Root-Cause Analysis ({activeAlert.causeCertainty} · {activeAlert.rootCauseCategory.replace(/_/g, ' ')})
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-800">
                  {activeAlert.rootCauseSummary}
                </p>
                <div className="mt-3">
                  <div className="text-xs font-medium text-slate-700">Supporting Evidence:</div>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-slate-600">
                    {activeAlert.evidence.map((ev, i) => (
                      <li key={i}>{ev}</li>
                    ))}
                  </ul>
                </div>
                {activeAlertNeed && (
                  <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
                    <div className="font-semibold text-slate-900">
                      Defined Tier Need &amp; Related Scope ({activeAlertNeed.label})
                    </div>
                    <p className="text-slate-700">{activeAlertNeed.primaryNeed}</p>
                    <p className="text-slate-500">{activeAlertNeed.relatedInfo}</p>
                  </div>
                )}
              </div>

              {incidentPrediction && (
                <PredictiveOutcomesPanel evaluation={incidentPrediction} />
              )}

              <div className="border-t border-slate-200 pt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Recommended Corrective Actions
                </h3>
                <div className="mt-2 space-y-3">
                  {activeAlert.recommendations.map((rec, i) => (
                    <div key={i} className="rounded-md border border-slate-200 bg-slate-50/70 p-3.5 text-xs space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900">{rec.title}</span>
                        <span className="font-mono text-amber-800">
                          {rec.requiresApproval ? 'APPROVAL REQUIRED' : 'ADVISORY'}
                        </span>
                      </div>
                      <p className="text-slate-600"><strong>Evidence:</strong> {rec.evidence}</p>
                      <p className="text-slate-600"><strong>Expected Benefit:</strong> {rec.expectedBenefit}</p>
                      <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                        Est. Time: {rec.estimatedTimeMinutes} min · Est. Cost: {rec.estimatedCostInr !== null ? `₹${rec.estimatedCostInr}` : 'Unavailable'}
                      </div>
                      <p className="text-slate-600"><strong>Risk / Constraint:</strong> {rec.riskNote}</p>
                    </div>
                  ))}
                </div>
              </div>

              {activeAlert.status !== 'RESOLVED' ? (
                <div className="border-t border-slate-200 pt-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-medium text-slate-700">Set Root-Cause Certainty:</span>
                    {(['CONFIRMED', 'PROBABLE', 'SUSPECTED'] as const).map((cert) => (
                      <button
                        key={cert}
                        type="button"
                        disabled={busy || activeAlert.causeCertainty === cert}
                        onClick={async () => {
                          setBusy(true);
                          setErrorMsg(null);
                          try {
                            await apiFetch(`/api/alerts/${activeAlert.id}/investigate`, {
                              method: 'POST',
                              body: JSON.stringify({ causeCertainty: cert }),
                            });
                            await onRefresh();
                          } catch (err) {
                            setErrorMsg(err instanceof Error ? err.message : 'Investigation update failed.');
                          } finally {
                            setBusy(false);
                          }
                        }}
                        className={`rounded border px-2.5 py-1 text-[11px] font-mono ${
                          activeAlert.causeCertainty === cert
                            ? 'border-teal-700 bg-teal-50 text-teal-900 font-semibold'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {cert}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busy || activeAlert.status === 'ACKNOWLEDGED'}
                      onClick={() => handleAcknowledge(activeAlert.id)}
                      className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <AlertOctagon className="h-3.5 w-3.5" /> Acknowledge
                    </button>
                    <input
                      type="text"
                      value={assigneeInput}
                      onChange={(e) => setAssigneeInput(e.target.value)}
                      placeholder="Assignee role/name"
                      className="rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleAssignOrEscalate(activeAlert.id, false)}
                      className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                    >
                      <UserCheck className="h-3.5 w-3.5" /> Assign
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleAssignOrEscalate(activeAlert.id, true)}
                      className="inline-flex items-center gap-1.5 rounded border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                    >
                      <ArrowUpRight className="h-3.5 w-3.5" /> Escalate
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={resolutionNotes}
                      onChange={(e) => setResolutionNotes(e.target.value)}
                      placeholder="Document resolution evidence before closing..."
                      className="flex-1 min-w-[220px] rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-900"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleResolve(activeAlert.id)}
                      className="inline-flex items-center gap-1.5 rounded bg-teal-700 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-teal-800"
                    >
                      <CheckCircle className="h-3.5 w-3.5" /> Mark Resolved
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                  Resolved at {formatTimeShort(activeAlert.resolvedAt)}: {activeAlert.resolutionNotes}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
              Select an incident from the left queue to inspect root-cause evidence.
            </div>
          )}
        </div>
      </div>

      {/* Root-Cause Breakdown Matrix */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-900">Root-Cause Category Distribution</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2.5 font-medium">Root-Cause Category</th>
                <th className="px-4 py-2.5 font-medium text-right">Total</th>
                <th className="px-4 py-2.5 font-medium text-right">Confirmed</th>
                <th className="px-4 py-2.5 font-medium text-right">Probable</th>
                <th className="px-4 py-2.5 font-medium text-right">Suspected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rootCauses.map((rc) => (
                <tr key={rc.category}>
                  <td className="px-4 py-2.5 font-medium text-slate-900">
                    {rc.category.replace(/_/g, ' ')}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">{rc.count}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-emerald-700">{rc.confirmedCount}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-amber-700">{rc.probableCount}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-600">{rc.suspectedCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {/* 1-Hop Rapid-Reach Incident Escalation */}
      <RapidReachPanel
        role={role}
        defaultNeedSummary={
          activeAlert
            ? `Incident ${activeAlert.incidentCode}: ${activeAlert.title} — immediate 1-hop coordination required.`
            : undefined
        }
        compact
      />
    </div>
  );
}
