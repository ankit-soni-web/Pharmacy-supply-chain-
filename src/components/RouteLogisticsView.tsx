import { AlertTriangle, Navigation, RefreshCw, Route, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import {
  DisruptionEvent,
  DistributionNode,
  Medicine,
  MPDistrict,
  PredictiveEvaluationResult,
  ShipmentView,
  UserRole,
} from '../types/platform.ts';
import { formatTimeShort, SeverityIndicator, StatusIndicator } from './DataStatusText.tsx';
import { MpMap } from './MpMap.tsx';
import { PredictiveOutcomesPanel } from './PredictiveOutcomesPanel.tsx';
import { RapidReachPanel } from './RapidReachPanel.tsx';

interface RouteLogisticsViewProps {
  role: UserRole;
  districts: MPDistrict[];
  nodes: DistributionNode[];
  medicines: Medicine[];
  shipments: ShipmentView[];
  disruptions: DisruptionEvent[];
  onRefresh: () => Promise<void>;
}

interface CalculatedRouteResponse {
  distanceKm: number;
  baselineMinutes: number;
  estimatedMinutes: number;
  delayMinutes: number;
  routingProvider: string;
  dataStatus: 'VERIFIED' | 'SIMULATED' | 'UNVERIFIED' | 'STALE';
  source: string;
  geometry: { lat: number; lng: number }[];
  alternativeGeometry: { lat: number; lng: number }[];
  alternativeDistanceKm: number;
  alternativeMinutes: number;
  coldChainRequired: boolean;
  coldChainVehicle: boolean;
  capacityFeasible: boolean;
  coldChainFeasible: boolean;
  warnings: string[];
}

export function RouteLogisticsView({
  role,
  districts,
  nodes,
  medicines,
  shipments,
  disruptions,
  onRefresh,
}: RouteLogisticsViewProps) {
  const [originNodeId, setOriginNodeId] = useState(nodes[0]?.id ?? '');
  const [destinationNodeId, setDestinationNodeId] = useState(nodes[10]?.id ?? nodes[1]?.id ?? '');
  const [medicineId, setMedicineId] = useState(medicines[2]?.id ?? medicines[0]?.id ?? '');
  const [quantity, setQuantity] = useState(250);
  const [vehicleCapacity, setVehicleCapacity] = useState(2000);
  const [coldChainVehicle, setColdChainVehicle] = useState(true);
  const [calcResult, setCalcResult] = useState<CalculatedRouteResponse | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);

  const [disDistrictId, setDisDistrictId] = useState(districts[13]?.id ?? districts[0]?.id ?? '');
  const [disRoadName, setDisRoadName] = useState('NH-46 Bhopal–Indore Freight Stretch');
  const [disSeverity, setDisSeverity] = useState<'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'>('HIGH');
  const [disCause, setDisCause] = useState('Highway Waterlogging & Diversion');
  const [disDelayMin, setDisDelayMin] = useState(65);
  const [disBusy, setDisBusy] = useState(false);

  const [optimizingId, setOptimizingId] = useState<string | null>(null);
  const [shipmentPrediction, setShipmentPrediction] = useState<PredictiveEvaluationResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const originNode = nodes.find((n) => n.id === originNodeId);
  const destNode = nodes.find((n) => n.id === destinationNodeId);

  async function handleCalculateRoute(e: React.FormEvent) {
    e.preventDefault();
    setCalcLoading(true);
    setErrorMsg(null);
    try {
      const data = await apiFetch<CalculatedRouteResponse>('/api/routes/calculate', {
        method: 'POST',
        body: JSON.stringify({
          originNodeId,
          destinationNodeId,
          medicineId,
          quantity,
          vehicleCapacityUnits: vehicleCapacity,
          coldChainVehicle,
        }),
      });
      setCalcResult(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Route calculation failed.');
    } finally {
      setCalcLoading(false);
    }
  }

  async function handleOptimizeShipment(shipmentId: string) {
    setOptimizingId(shipmentId);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await apiFetch<{ shipment: ShipmentView; reroutedToAlternative: boolean }>(
        '/api/routes/optimize',
        {
          method: 'POST',
          body: JSON.stringify({ shipmentId }),
        }
      );
      setStatusMsg(
        `${res.shipment.shipmentCode} ${
          res.reroutedToAlternative ? 'rerouted via alternative MP corridor' : 'recalculated'
        } — updated ETA ${res.shipment.estimatedMinutes} min (${res.shipment.routingProvider}).`
      );
      await onRefresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Optimization failed.');
    } finally {
      setOptimizingId(null);
    }
  }

  async function handleViewAlternatives(shipmentId: string) {
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const alt = await apiFetch<{
        shipmentCode: string;
        primaryRoute: { distanceKm: number; estimatedMinutes: number; geometry: { lat: number; lng: number }[] };
        alternativeRoute: {
          distanceKm: number;
          estimatedMinutes: number;
          timeSavedMinutes: number;
          geometry: { lat: number; lng: number }[];
        };
        routingProvider: string;
      }>(`/api/routes/alternatives/${shipmentId}`);

      setCalcResult({
        distanceKm: alt.primaryRoute.distanceKm,
        baselineMinutes: alt.primaryRoute.estimatedMinutes,
        estimatedMinutes: alt.primaryRoute.estimatedMinutes,
        delayMinutes: 0,
        routingProvider: alt.routingProvider,
        dataStatus: 'SIMULATED',
        source: `Alternative Corridor Analysis for ${alt.shipmentCode}`,
        geometry: alt.primaryRoute.geometry,
        alternativeGeometry: alt.alternativeRoute.geometry,
        alternativeDistanceKm: alt.alternativeRoute.distanceKm,
        alternativeMinutes: alt.alternativeRoute.estimatedMinutes,
        coldChainRequired: false,
        coldChainVehicle: true,
        capacityFeasible: true,
        coldChainFeasible: true,
        warnings: [],
      });
      setStatusMsg(
        `${alt.shipmentCode}: Alternative corridor is ${alt.alternativeRoute.distanceKm} km (${alt.alternativeRoute.estimatedMinutes} min; saves ~${alt.alternativeRoute.timeSavedMinutes} min vs. primary). Plotted on map.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load alternative routes.');
    }
  }

  async function handleReportDisruption(e: React.FormEvent) {
    e.preventDefault();
    setDisBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await apiFetch<{ disruption: DisruptionEvent; impactedShipments: ShipmentView[] }>(
        '/api/routes/disruption',
        {
          method: 'POST',
          body: JSON.stringify({
            districtId: disDistrictId,
            roadName: disRoadName,
            severity: disSeverity,
            cause: disCause,
            description: `${disCause} reported by logistics desk`,
            delayImpactMinutes: disDelayMin,
          }),
        }
      );
      setStatusMsg(
        `Logged disruption on ${res.disruption.roadName} (+${res.disruption.delayImpactMinutes} min). ${res.impactedShipments.length} active shipment(s) updated & Alert Agent notified.`
      );
      await onRefresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Disruption logging failed.');
    } finally {
      setDisBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Route &amp; Logistics Agent
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Madhya Pradesh pharmaceutical corridor routing via OpenStreetMap / OSRM with vehicle capacity, 2°C–8°C cold-chain verification, and disruption monitoring.
        </p>
      </div>

      {errorMsg && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          {errorMsg}
        </div>
      )}
      {statusMsg && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900">
          {statusMsg}
        </div>
      )}

      <MpMap
        nodes={nodes}
        shipments={shipments}
        disruptions={disruptions}
        previewRoute={
          calcResult
            ? { primary: calcResult.geometry, alternative: calcResult.alternativeGeometry }
            : null
        }
        heightClass="h-[440px]"
      />

      {/* Route Calculator & Disruption Logger */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <form onSubmit={handleCalculateRoute} className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Calculate MP Corridor Route</h2>
            <Route className="h-4 w-4 text-slate-400" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-slate-700">
              Origin Node
              <select
                value={originNodeId}
                onChange={(e) => setOriginNodeId(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900"
              >
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name} ({n.city})
                  </option>
                ))}
              </select>
              {originNode && (
                <div className="mt-1 text-[11px] font-normal text-slate-500">
                  {originNode.fullAddress} (PIN {originNode.pinCode})
                </div>
              )}
            </label>
            <label className="text-xs font-medium text-slate-700">
              Destination Node
              <select
                value={destinationNodeId}
                onChange={(e) => setDestinationNodeId(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900"
              >
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name} ({n.city})
                  </option>
                ))}
              </select>
              {destNode && (
                <div className="mt-1 text-[11px] font-normal text-slate-500">
                  {destNode.fullAddress} (PIN {destNode.pinCode})
                </div>
              )}
            </label>
            <label className="text-xs font-medium text-slate-700 sm:col-span-2">
              Medicine Cargo
              <select
                value={medicineId}
                onChange={(e) => setMedicineId(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900"
              >
                {medicines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.brandName} · {m.coldChainRequired ? 'Cold Chain (2°C–8°C)' : 'Ambient'}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-700">
              Units to Dispatch
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-2 font-mono text-sm text-slate-900"
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Vehicle Capacity (Units)
              <input
                type="number"
                min={100}
                value={vehicleCapacity}
                onChange={(e) => setVehicleCapacity(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-2 font-mono text-sm text-slate-900"
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
            <input
              type="checkbox"
              checked={coldChainVehicle}
              onChange={(e) => setColdChainVehicle(e.target.checked)}
              className="rounded border-slate-300 text-teal-700"
            />
            Assign Refrigerated Cold-Chain Vehicle (2°C–8°C)
          </label>

          <button
            type="submit"
            disabled={calcLoading}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <Navigation className="h-3.5 w-3.5" />
            {calcLoading ? 'Calculating Route...' : 'Calculate Primary & Alternative Route'}
          </button>

          {calcResult && (
            <div className="mt-3 border-t border-slate-200 pt-3 text-xs space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-900">
                  Primary: {calcResult.distanceKm} km · {calcResult.estimatedMinutes} min
                  {calcResult.delayMinutes > 0 && ` (+${calcResult.delayMinutes} min disruption delay)`}
                </span>
                <StatusIndicator status={calcResult.dataStatus} />
              </div>
              <div className="text-slate-600">
                Alternative: <span className="font-mono">{calcResult.alternativeDistanceKm} km · {calcResult.alternativeMinutes} min</span> · Provider: <span className="font-mono">{calcResult.routingProvider}</span>
              </div>
              <div className="text-slate-500">Source: {calcResult.source}</div>
              {calcResult.warnings.map((w, i) => (
                <div key={i} className="text-amber-800 font-medium">
                  Warning: {w}
                </div>
              ))}
            </div>
          )}
        </form>

        <form onSubmit={handleReportDisruption} className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Report Highway Disruption</h2>
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-slate-700">
              MP District
              <select
                value={disDistrictId}
                onChange={(e) => setDisDistrictId(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900"
              >
                {districts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-700">
              Severity
              <select
                value={disSeverity}
                onChange={(e) => setDisSeverity(e.target.value as typeof disSeverity)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900"
              >
                <option value="CRITICAL">CRITICAL</option>
                <option value="HIGH">HIGH</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="LOW">LOW</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-700 sm:col-span-2">
              Highway / Road Segment
              <input
                type="text"
                value={disRoadName}
                onChange={(e) => setDisRoadName(e.target.value)}
                required
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-900"
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Cause
              <input
                type="text"
                value={disCause}
                onChange={(e) => setDisCause(e.target.value)}
                required
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-900"
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Delay Impact (Minutes)
              <input
                type="number"
                min={5}
                max={600}
                value={disDelayMin}
                onChange={(e) => setDisDelayMin(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-2 font-mono text-sm text-slate-900"
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={disBusy}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-4 py-2 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-50"
          >
            {disBusy ? 'Publishing Disruption...' : 'Log Disruption & Notify Agents'}
          </button>

          <div className="border-t border-slate-200 pt-3">
            <h3 className="text-xs font-semibold text-slate-700">Active MP Road Advisories ({disruptions.length})</h3>
            <div className="mt-2 space-y-2 max-h-32 overflow-y-auto">
              {disruptions.map((d) => (
                <div key={d.id} className="text-xs text-slate-600">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{d.roadName}</span>
                    <SeverityIndicator severity={d.severity} />
                  </div>
                  <div className="text-slate-500">
                    {d.cause} · +{d.delayImpactMinutes}m · <StatusIndicator status={d.dataStatus} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </form>
      </div>

      {/* Active Shipments Table */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Active Madhya Pradesh Shipments</h2>
          <span className="font-mono text-xs text-slate-500">{shipments.length} tracked</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2.5 font-medium">Shipment</th>
                <th className="px-4 py-2.5 font-medium">Corridor</th>
                <th className="px-4 py-2.5 font-medium">Cargo</th>
                <th className="px-4 py-2.5 font-medium text-right">Distance</th>
                <th className="px-4 py-2.5 font-medium text-right">ETA / Delay</th>
                <th className="px-4 py-2.5 font-medium">Status / Source</th>
                <th className="px-4 py-2.5 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shipments.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <div className="font-mono font-semibold text-slate-900">{s.shipmentCode}</div>
                    <div className="text-slate-500">{s.vehicleId} · {s.capacityUtilizationPct}% load</div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    <div>{s.originName}</div>
                    <div className="text-slate-500">&rarr; {s.destinationName}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{s.medicineName}</div>
                    <div className="text-slate-500 font-mono tabular-nums">
                      {s.quantity} units · {s.coldChainRequired ? (s.coldChainVehicle ? '2°C–8°C OK' : 'COLD-CHAIN MISMATCH') : 'Ambient'}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-800">
                    {s.distanceKm} km
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    <div className="text-slate-900">{s.estimatedMinutes} min</div>
                    {s.delayMinutes > 0 && (
                      <div className="text-red-700">+{s.delayMinutes}m delay</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className={s.status === 'DELAYED' ? 'font-semibold text-red-700' : 'font-medium text-slate-800'}>
                      {s.status}
                    </div>
                    <div className="text-slate-500">
                      <StatusIndicator status={s.dataStatus} /> · {formatTimeShort(s.updatedAt)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={async () => {
                          setErrorMsg(null);
                          try {
                            const data = await apiFetch<PredictiveEvaluationResult>('/api/predictive/evaluate', {
                              method: 'POST',
                              body: JSON.stringify({ entityType: 'SHIPMENT', entityId: s.id }),
                            });
                            setShipmentPrediction(data);
                          } catch (err) {
                            setErrorMsg(err instanceof Error ? err.message : 'Unable to evaluate shipment outcomes.');
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded border border-teal-700 bg-white px-2.5 py-1 text-xs font-medium text-teal-800 hover:bg-teal-50 whitespace-nowrap"
                      >
                        <Sparkles className="h-3 w-3" /> Outcomes
                      </button>
                      <button
                        type="button"
                        onClick={() => handleViewAlternatives(s.id)}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                      >
                        Alternatives
                      </button>
                      <button
                        type="button"
                        disabled={optimizingId === s.id}
                        onClick={() => handleOptimizeShipment(s.id)}
                        className="inline-flex items-center gap-1 rounded bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                      >
                        <RefreshCw className={`h-3 w-3 ${optimizingId === s.id ? 'animate-spin' : ''}`} />
                        Optimize
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {shipmentPrediction && (
        <PredictiveOutcomesPanel
          evaluation={shipmentPrediction}
          onClose={() => setShipmentPrediction(null)}
        />
      )}

      <RapidReachPanel
        role={role}
        defaultNeedSummary={
          shipmentPrediction?.definedNeed ??
          'Urgent corridor reroute confirmation & cold-chain handoff coordination.'
        }
        compact
      />
    </div>
  );
}
