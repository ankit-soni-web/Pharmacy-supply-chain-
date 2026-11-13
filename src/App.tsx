import { onAuthStateChanged, User } from 'firebase/auth';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Boxes,
  Building2,
  LogIn,
  LogOut,
  Map as MapIcon,
  ShieldCheck,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AlertsRootCauseView } from './components/AlertsRootCauseView.tsx';
import { formatLevelLabel } from './components/DataStatusText.tsx';
import { GovernanceSourcesView } from './components/GovernanceSourcesView.tsx';
import { LevelLoginModal } from './components/LevelLoginModal.tsx';
import { OverviewView } from './components/OverviewView.tsx';
import { PharmaAssistantView } from './components/PharmaAssistantView.tsx';
import { ReportingAnalyticsView } from './components/ReportingAnalyticsView.tsx';
import { RouteLogisticsView } from './components/RouteLogisticsView.tsx';
import { SupplyManagementView } from './components/SupplyManagementView.tsx';
import { apiFetch, setApiOperatorRole } from './lib/api.ts';
import {
  auth,
  fetchUserFirestoreAuditLogs,
  signInWithGoogle,
  signOutUser,
  syncUserProfileToFirestore,
  testFirestoreConnection,
} from './lib/firebase.ts';
import {
  ActiveLevelSession,
  AgentEvent,
  AlertIncident,
  ApprovalRecommendation,
  AuditLogEntry,
  DataSourceRegistryItem,
  DisruptionEvent,
  DistributionNode,
  EnrichedInventoryRow,
  KpiMetric,
  Medicine,
  MPDistrict,
  OperationalNeedProfile,
  ShipmentView,
  UserRole,
} from './types/platform.ts';

type ActiveView = 'overview' | 'routes' | 'supply' | 'reports' | 'alerts' | 'pharma' | 'governance';

const NAV_ITEMS: { id: ActiveView; label: string; shortLabel: string; icon: typeof Activity }[] = [
  { id: 'overview', label: 'Command Overview', shortLabel: 'Overview', icon: Activity },
  { id: 'routes', label: '01. Route & Logistics', shortLabel: 'Route Agent', icon: MapIcon },
  { id: 'supply', label: '02. Supply Management', shortLabel: 'Supply Agent', icon: Boxes },
  { id: 'reports', label: '03. Reporting & Analytics', shortLabel: 'Reporting Agent', icon: BarChart3 },
  { id: 'alerts', label: '04. Alerts & Root-Cause', shortLabel: 'Alert Agent', icon: AlertTriangle },
  { id: 'pharma', label: '05. Pharma Knowledge', shortLabel: 'Pharma AI', icon: BookOpen },
  { id: 'governance', label: 'Sources & Audit', shortLabel: 'Governance', icon: ShieldCheck },
];

const ROLES: UserRole[] = [
  'STATE_ADMIN',
  'MANUFACTURER',
  'CNF_AGENT',
  'SUPER_STOCKIST',
  'WHOLESALER',
  'LOCAL_DISTRIBUTOR',
  'RETAIL_PHARMACY',
  'HOSPITAL_PHARMACY',
];

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>('overview');
  const [operatorRole, setOperatorRole] = useState<UserRole>('STATE_ADMIN');
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  const [districts, setDistricts] = useState<MPDistrict[]>([]);
  const [nodes, setNodes] = useState<DistributionNode[]>([]);
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [inventory, setInventory] = useState<EnrichedInventoryRow[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRecommendation[]>([]);
  const [shipments, setShipments] = useState<ShipmentView[]>([]);
  const [disruptions, setDisruptions] = useState<DisruptionEvent[]>([]);
  const [alerts, setAlerts] = useState<AlertIncident[]>([]);
  const [kpis, setKpis] = useState<KpiMetric[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [dataSources, setDataSources] = useState<DataSourceRegistryItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [levelNeeds, setLevelNeeds] = useState<OperationalNeedProfile[]>([]);
  const [activeLevelSession, setActiveLevelSession] = useState<ActiveLevelSession | null>(null);
  const [levelLoginOpen, setLevelLoginOpen] = useState(false);
  const [levelLoginTarget, setLevelLoginTarget] = useState<UserRole>('WHOLESALER');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadAllData = useCallback(async () => {
    try {
      const [boot, invRes, routeRes, alertRes, stateRep] = await Promise.all([
        apiFetch<{
          districts: MPDistrict[];
          nodes: DistributionNode[];
          medicines: Medicine[];
          dataSources: DataSourceRegistryItem[];
          auditLogs: AuditLogEntry[];
          recentEvents: AgentEvent[];
          levelNeeds?: OperationalNeedProfile[];
        }>('/api/bootstrap'),
        apiFetch<{ inventory: EnrichedInventoryRow[]; approvals: ApprovalRecommendation[] }>('/api/supply/inventory'),
        apiFetch<{ shipments: ShipmentView[]; disruptions: DisruptionEvent[] }>('/api/routes'),
        apiFetch<{ alerts: AlertIncident[] }>('/api/alerts'),
        apiFetch<{ kpis: KpiMetric[] }>('/api/reports/state'),
      ]);

      setDistricts(boot.districts);
      setNodes(boot.nodes);
      setMedicines(boot.medicines);
      setDataSources(boot.dataSources);
      setAuditLogs(boot.auditLogs);
      setEvents(boot.recentEvents);
      if (boot.levelNeeds) setLevelNeeds(boot.levelNeeds);
      setInventory(invRes.inventory);
      setApprovals(invRes.approvals);
      setShipments(routeRes.shipments);
      setDisruptions(routeRes.disruptions);
      setAlerts(alertRes.alerts);
      setKpis(stateRep.kpis);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unable to reach RouteRescue AI backend.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    testFirestoreConnection();
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      if (user) {
        syncUserProfileToFirestore(user, operatorRole, 'mp-bhopal').catch(() => {});
        if (user.emailVerified) {
          fetchUserFirestoreAuditLogs(user.uid)
            .then((fsLogs) => {
              if (fsLogs.length > 0) {
                setAuditLogs((prev) => {
                  const seen = new Set(prev.map((l) => l.id));
                  return [...fsLogs.filter((l) => !seen.has(l.id)), ...prev];
                });
              }
            })
            .catch(() => {});
        }
      }
    });
    return () => unsub();
  }, [operatorRole]);

  useEffect(() => {
    setApiOperatorRole(operatorRole);
    loadAllData();
  }, [operatorRole, loadAllData]);

  // Live SSE Event Bus listener
  useEffect(() => {
    const es = new EventSource('/api/events/stream');
    es.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as AgentEvent & { type?: string };
        if (parsed.event_id) {
          setEvents((prev) => [parsed, ...prev.filter((e) => e.event_id !== parsed.event_id)].slice(0, 50));
        }
      } catch {
        // ignore heartbeat/parse errors
      }
    };
    return () => es.close();
  }, []);

  async function handleAuthClick() {
    setAuthBusy(true);
    try {
      if (firebaseUser) {
        await signOutUser();
      } else {
        const user = await signInWithGoogle();
        await syncUserProfileToFirestore(user, operatorRole, 'mp-bhopal');
      }
    } catch {
      // popup cancelled or blocked
    } finally {
      setAuthBusy(false);
    }
  }

  const activeNavLabel = NAV_ITEMS.find((n) => n.id === activeView)?.label ?? 'Command Overview';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* 3-Zone Top Bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-8 border-b border-slate-200 bg-white px-6 py-3.5">
        <a
          href="#overview"
          onClick={(e) => {
            e.preventDefault();
            setActiveView('overview');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          RouteRescue AI
        </a>

        <nav className="hidden lg:flex items-center gap-5 text-xs font-medium text-slate-600">
          {NAV_ITEMS.slice(1, 6).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveView(item.id)}
              className={`transition-colors whitespace-nowrap shrink-0 ${
                activeView === item.id
                  ? 'text-teal-800 underline underline-offset-4'
                  : 'hover:text-slate-900'
              }`}
            >
              {item.shortLabel}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              setLevelLoginTarget(operatorRole);
              setLevelLoginOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Building2 className="h-3.5 w-3.5 text-teal-700" />
            Level Login &amp; Address
          </button>
          <button
            type="button"
            disabled={authBusy}
            onClick={handleAuthClick}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {firebaseUser ? (
              <>
                <LogOut className="h-3.5 w-3.5" />
                {firebaseUser.displayName?.split(' ')[0] || 'Sign Out'}
              </>
            ) : (
              <>
                <LogIn className="h-3.5 w-3.5" />
                Sign In
              </>
            )}
          </button>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Left Sidebar (240px) */}
        <aside className="hidden md:flex w-60 shrink-0 flex-col justify-between border-r border-slate-200 bg-white p-4">
          <div className="space-y-6">
            <div>
              <div className="px-2 text-xs font-semibold text-slate-500">
                Active Operator Role
              </div>
              <select
                value={operatorRole}
                onChange={(e) => setOperatorRole(e.target.value as UserRole)}
                aria-label="Active Operator Role"
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium text-slate-900 focus:border-teal-700 focus:outline-none"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {formatLevelLabel(r)}
                  </option>
                ))}
              </select>
              {activeLevelSession && (
                <div className="mt-2 rounded-md border border-teal-200 bg-teal-50/50 p-2 text-[11px] text-slate-700">
                  <div className="font-semibold text-teal-900 truncate">{activeLevelSession.organizationName}</div>
                  <div className="mt-0.5 text-slate-600 line-clamp-2">{activeLevelSession.fullAddress}</div>
                  <div className="mt-0.5 font-mono text-slate-500">
                    PIN {activeLevelSession.pinCode} · SLA {activeLevelSession.responseSlaMinutes}m
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  setLevelLoginTarget(operatorRole);
                  setLevelLoginOpen(true);
                }}
                className="mt-2 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
              >
                {activeLevelSession ? 'Update Level Address / Login' : 'Verify Level Address & Login'}
              </button>
            </div>

            <nav className="space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeView === item.id;
                const badgeCount =
                  item.id === 'alerts'
                    ? alerts.filter((a) => a.status !== 'RESOLVED').length
                    : item.id === 'supply'
                      ? approvals.filter((a) => a.status === 'PENDING').length
                      : null;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveView(item.id)}
                    className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-xs font-medium transition-colors ${
                      active
                        ? 'bg-teal-50 text-teal-900'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 truncate">
                      <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-teal-700' : 'text-slate-400'}`} />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {badgeCount !== null && badgeCount > 0 && (
                      <span className="font-mono text-[11px] tabular-nums text-slate-700">
                        {badgeCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="border-t border-slate-200 pt-3 text-[11px] leading-relaxed text-slate-500">
            <div>Region: Madhya Pradesh, India</div>
            <div>Data Integrity: Operational stock &amp; traffic marked SIMULATED unless verified externally.</div>
          </div>
        </aside>

        {/* Main Viewport */}
        <main className="flex-1 min-w-0 p-6 lg:p-8">
          {/* Mobile & Narrow Viewport Horizontal 5-Agent Switcher */}
          <div className="mb-4 space-y-2 md:hidden">
            <div className="flex items-center gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveView(item.id)}
                  className={`rounded-md px-3 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                    activeView === item.id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {item.shortLabel}
                </button>
              ))}
            </div>
            <select
              value={operatorRole}
              onChange={(e) => setOperatorRole(e.target.value as UserRole)}
              aria-label="Mobile Active Operator Role"
              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium text-slate-900"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  Role: {formatLevelLabel(r)}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-4 text-xs text-slate-500">
            Madhya Pradesh Network <span aria-hidden="true">/</span> {activeNavLabel}
          </div>

          {loadError && (
            <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {loadError}
            </div>
          )}

          {loading ? (
            <div className="space-y-4">
              <div className="h-10 w-72 animate-pulse rounded bg-slate-200" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-24 animate-pulse rounded-lg bg-slate-200" />
                ))}
              </div>
              <div className="h-80 animate-pulse rounded-lg bg-slate-200" />
            </div>
          ) : (
            <div className="mx-auto max-w-7xl">
              {activeView === 'overview' && (
                <OverviewView
                  role={operatorRole}
                  districts={districts}
                  nodes={nodes}
                  medicines={medicines}
                  shipments={shipments}
                  disruptions={disruptions}
                  approvals={approvals}
                  alerts={alerts}
                  events={events}
                  kpis={kpis}
                  levelNeeds={levelNeeds}
                  activeLevelSession={activeLevelSession}
                  onOpenLevelLogin={(lvl) => {
                    setLevelLoginTarget(lvl);
                    setLevelLoginOpen(true);
                  }}
                  onRefreshAll={loadAllData}
                  onNavigate={(t) => setActiveView(t as ActiveView)}
                />
              )}
              {activeView === 'routes' && (
                <RouteLogisticsView
                  role={operatorRole}
                  districts={districts}
                  nodes={nodes}
                  medicines={medicines}
                  shipments={shipments}
                  disruptions={disruptions}
                  onRefresh={loadAllData}
                />
              )}
              {activeView === 'supply' && (
                <SupplyManagementView
                  role={operatorRole}
                  districts={districts}
                  nodes={nodes}
                  medicines={medicines}
                  inventory={inventory}
                  approvals={approvals}
                  levelNeeds={levelNeeds}
                  onRefresh={loadAllData}
                />
              )}
              {activeView === 'reports' && (
                <ReportingAnalyticsView
                  role={operatorRole}
                  nodes={nodes}
                  shipments={shipments}
                  onOpenLevelLogin={(lvl) => {
                    setLevelLoginTarget(lvl);
                    setLevelLoginOpen(true);
                  }}
                />
              )}
              {activeView === 'alerts' && (
                <AlertsRootCauseView
                  role={operatorRole}
                  districts={districts}
                  alerts={alerts}
                  levelNeeds={levelNeeds}
                  onRefresh={loadAllData}
                />
              )}
              {activeView === 'pharma' && (
                <PharmaAssistantView districts={districts} medicines={medicines} />
              )}
              {activeView === 'governance' && (
                <GovernanceSourcesView
                  role={operatorRole}
                  dataSources={dataSources}
                  auditLogs={auditLogs}
                />
              )}
            </div>
          )}
        </main>
      </div>

      <LevelLoginModal
        open={levelLoginOpen}
        initialLevel={levelLoginTarget}
        currentSession={activeLevelSession}
        districts={districts}
        nodes={nodes}
        levelNeeds={levelNeeds}
        firebaseUser={firebaseUser}
        onClose={() => setLevelLoginOpen(false)}
        onAuthenticated={(session, newRole) => {
          setActiveLevelSession(session);
          setOperatorRole(newRole);
          loadAllData();
        }}
      />
    </div>
  );
}
