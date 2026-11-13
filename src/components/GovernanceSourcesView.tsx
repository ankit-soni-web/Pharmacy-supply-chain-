import { AuditLogEntry, DataSourceRegistryItem, UserRole } from '../types/platform.ts';
import { formatLevelLabel, formatTimeShort, StatusIndicator } from './DataStatusText.tsx';

interface GovernanceSourcesViewProps {
  role: UserRole;
  dataSources: DataSourceRegistryItem[];
  auditLogs: AuditLogEntry[];
}

export function GovernanceSourcesView({
  role,
  dataSources,
  auditLogs,
}: GovernanceSourcesViewProps) {
  const rbacMatrix: { role: UserRole; stockApprove: boolean; routeDisrupt: boolean; incidentResolve: boolean; ragIngest: boolean }[] = [
    { role: 'STATE_ADMIN', stockApprove: true, routeDisrupt: true, incidentResolve: true, ragIngest: true },
    { role: 'MANUFACTURER', stockApprove: true, routeDisrupt: true, incidentResolve: true, ragIngest: true },
    { role: 'CNF_AGENT', stockApprove: true, routeDisrupt: true, incidentResolve: true, ragIngest: true },
    { role: 'SUPER_STOCKIST', stockApprove: true, routeDisrupt: true, incidentResolve: true, ragIngest: false },
    { role: 'WHOLESALER', stockApprove: true, routeDisrupt: true, incidentResolve: true, ragIngest: false },
    { role: 'LOCAL_DISTRIBUTOR', stockApprove: false, routeDisrupt: true, incidentResolve: true, ragIngest: false },
    { role: 'RETAIL_PHARMACY', stockApprove: false, routeDisrupt: true, incidentResolve: false, ragIngest: false },
    { role: 'HOSPITAL_PHARMACY', stockApprove: false, routeDisrupt: true, incidentResolve: false, ragIngest: false },
  ];

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Data Governance, Sources &amp; Audit Trail
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Transparent provenance registry (VERIFIED, UNVERIFIED, SIMULATED, STALE), role-based access enforcement, and immutable decision log.
        </p>
      </div>

      {/* Data Source Registry */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-900">Data Source Registry</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2.5 font-medium">Source</th>
                <th className="px-4 py-2.5 font-medium">Category &amp; Reliability</th>
                <th className="px-4 py-2.5 font-medium">Permitted Usage &amp; Limitation</th>
                <th className="px-4 py-2.5 font-medium">Status &amp; Last Checked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dataSources.map((src) => (
                <tr key={src.id}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{src.name}</div>
                    <div className="font-mono text-[11px] text-slate-500">{src.url}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-slate-800">{src.category}</div>
                    <div className="font-mono text-[11px] text-slate-500">
                      {src.reliability} · {src.availability}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 max-w-md">{src.permittedUsage}</td>
                  <td className="px-4 py-3">
                    <StatusIndicator status={src.dataStatus} />
                    <div className="font-mono text-[11px] text-slate-500">{formatTimeShort(src.lastCheckedAt)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* RBAC & Audit Log */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-5 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Role-Based Access Matrix</h2>
            <span className="text-xs text-slate-500">Active: {formatLevelLabel(role)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium text-center">Approve Transfer</th>
                  <th className="px-3 py-2 font-medium text-center">Resolve Alert</th>
                  <th className="px-3 py-2 font-medium text-center">Ingest RAG</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rbacMatrix.map((row) => (
                  <tr key={row.role} className={row.role === role ? 'bg-teal-50/50' : ''}>
                    <td className="px-3 py-2 font-medium text-slate-900">{formatLevelLabel(row.role)}</td>
                    <td className="px-3 py-2 text-center font-mono">{row.stockApprove ? 'YES' : 'NO'}</td>
                    <td className="px-3 py-2 text-center font-mono">{row.incidentResolve ? 'YES' : 'NO'}</td>
                    <td className="px-3 py-2 text-center font-mono">{row.ragIngest ? 'YES' : 'NO'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-7 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-3">
            <h2 className="text-base font-semibold text-slate-900">Decision &amp; Action Audit Trail</h2>
          </div>
          <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto px-5">
            {auditLogs.map((log) => (
              <div key={log.id} className="py-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-slate-900">{log.action}</span>
                  <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                    {formatTimeShort(log.timestamp)}
                  </span>
                </div>
                <div className="mt-0.5 text-slate-700">{log.details}</div>
                <div className="mt-0.5 font-mono text-[11px] text-slate-500">
                  Actor: {log.actorId} ({log.actorRole}) · {log.entityType} {log.entityId}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
