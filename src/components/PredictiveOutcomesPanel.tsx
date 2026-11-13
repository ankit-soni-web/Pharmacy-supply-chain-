import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { PredictiveEvaluationResult } from '../types/platform.ts';
import { formatTimeShort, StatusIndicator } from './DataStatusText.tsx';

interface PredictiveOutcomesPanelProps {
  evaluation: PredictiveEvaluationResult;
  onClose?: () => void;
}

export function PredictiveOutcomesPanel({ evaluation, onClose }: PredictiveOutcomesPanelProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-mono font-semibold text-teal-800">
              MULTI-OUTCOME PREDICTIVE EVALUATION
            </span>
            <span aria-hidden="true">·</span>
            <StatusIndicator status={evaluation.dataStatus} />
            <span aria-hidden="true">·</span>
            <span className="font-mono">{formatTimeShort(evaluation.evaluatedAt)}</span>
          </div>
          <h3 className="mt-1 text-base font-semibold text-slate-900">{evaluation.title}</h3>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Dismiss
          </button>
        )}
      </div>

      {/* Explicit Defined Need & Related Info */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
          <div className="font-semibold uppercase tracking-wide text-slate-500">
            Defined Operational Need
          </div>
          <p className="mt-1 leading-relaxed text-slate-900">{evaluation.definedNeed}</p>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
          <div className="font-semibold uppercase tracking-wide text-slate-500">
            Related Context &amp; Constraints
          </div>
          <p className="mt-1 leading-relaxed text-slate-700">{evaluation.relatedInfo}</p>
        </div>
      </div>

      {/* All Possible Outcomes Comparison */}
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          All Possible Outcomes Evaluated ({evaluation.outcomes.length} Scenarios)
        </div>
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3.5 py-2 font-medium">Outcome Scenario</th>
                <th className="px-3.5 py-2 font-medium text-right">Stockout Risk</th>
                <th className="px-3.5 py-2 font-medium text-right">Cover</th>
                <th className="px-3.5 py-2 font-medium text-right">Spoilage</th>
                <th className="px-3.5 py-2 font-medium text-right">ETA / Cost</th>
                <th className="px-3.5 py-2 font-medium">Feasibility</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {evaluation.outcomes.map((o) => {
                const isRecommended = o.key === evaluation.recommendedOutcomeKey;
                return (
                  <tr key={o.key} className={isRecommended ? 'bg-teal-50/40' : 'bg-white'}>
                    <td className="px-3.5 py-2.5 align-top">
                      <div className="font-semibold text-slate-900">
                        {o.label}
                        {isRecommended && (
                          <span className="ml-2 font-mono text-[10px] font-semibold text-teal-800">
                            RECOMMENDED
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-slate-600">{o.strategySummary}</div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        Impact: {o.patientServiceImpact}
                      </div>
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-mono tabular-nums align-top">
                      <span className={o.stockoutRiskPct >= 50 ? 'font-semibold text-red-700' : 'text-slate-900'}>
                        {o.stockoutRiskPct}%
                      </span>
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-mono tabular-nums align-top text-slate-800">
                      {o.projectedDaysOfCover}d
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-mono tabular-nums align-top text-slate-800">
                      {o.spoilageRiskPct}%
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-mono tabular-nums align-top text-slate-800">
                      <div>{o.estimatedEtaMinutes !== null ? `${o.estimatedEtaMinutes}m` : 'N/A'}</div>
                      <div className="text-[11px] text-slate-500">₹{o.estimatedCostInr.toLocaleString('en-IN')}</div>
                    </td>
                    <td className="px-3.5 py-2.5 align-top font-mono text-[11px] font-semibold">
                      <span
                        className={
                          o.feasibilityStatus === 'OPTIMAL'
                            ? 'text-teal-800'
                            : o.feasibilityStatus === 'HIGH_RISK'
                              ? 'text-red-700'
                              : o.feasibilityStatus === 'CONSTRAINED'
                                ? 'text-amber-700'
                                : 'text-slate-700'
                        }
                      >
                        {o.feasibilityStatus}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Predictive Solution Banner */}
      <div className="rounded-md border border-teal-200 bg-teal-50/60 p-3.5 text-xs space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 font-semibold text-teal-900">
            <CheckCircle2 className="h-4 w-4 text-teal-700" />
            Predictive Solution (Post-Outcome Synthesis)
          </span>
          <span className="inline-flex items-center gap-1 font-mono text-[11px] font-medium text-amber-800">
            <ShieldAlert className="h-3.5 w-3.5" />
            Human Approval Required
          </span>
        </div>
        <p className="leading-relaxed text-slate-800">{evaluation.predictiveSolutionSummary}</p>
      </div>
    </div>
  );
}
