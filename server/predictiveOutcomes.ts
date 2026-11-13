import { calculateRouteBetweenNodes } from './agents/routeAgent.ts';
import { computeDemandForecast } from './agents/supplyAgent.ts';
import { store } from './store.ts';
import { PredictiveEvaluationResult, PredictiveOutcomeOption } from './types.ts';

export async function evaluateAllPredictiveOutcomes(params: {
  entityType: 'INVENTORY' | 'INCIDENT' | 'SHIPMENT';
  entityId: string;
}): Promise<PredictiveEvaluationResult> {
  if (params.entityType === 'SHIPMENT') {
    const shp = store.shipments.find((s) => s.id === params.entityId);
    if (!shp) throw new Error('Shipment not found for predictive evaluation.');
    const origin = store.getNodeById(shp.originNodeId);
    const dest = store.getNodeById(shp.destinationNodeId);
    const med = store.getMedicineById(shp.medicineId);
    const route = await calculateRouteBetweenNodes(shp.originNodeId, shp.destinationNodeId);

    const altEta = shp.alternativeMinutes ?? route.alternativeMinutes;
    const primaryEta = shp.estimatedMinutes;
    const coldPenalty = med?.coldChainRequired && primaryEta > 360 ? 38 : med?.coldChainRequired ? 14 : 4;

    const outcomes: PredictiveOutcomeOption[] = [
      {
        key: 'REROUTE_ALTERNATIVE',
        label: 'Outcome A: Reroute via Alternative MP Corridor',
        strategySummary: `Switch ${shp.shipmentCode} from primary highway to bypass corridor (${route.alternativeDistanceKm} km).`,
        stockoutRiskPct: 12,
        projectedDaysOfCover: 5.8,
        spoilageRiskPct: med?.coldChainRequired ? 8 : 2,
        estimatedEtaMinutes: altEta,
        estimatedCostInr: Math.round(route.alternativeDistanceKm * 12 + 550),
        patientServiceImpact: `Restores ${dest?.city ?? 'destination'} buffer ~${Math.max(15, primaryEta - altEta)} min earlier.`,
        feasibilityStatus: altEta < primaryEta ? 'OPTIMAL' : 'VIABLE',
      },
      {
        key: 'BACKUP_LOCAL_DISPATCH',
        label: 'Outcome B: Split Dispatch from Closest Adjacent Hub',
        strategySummary: `Coordinate 1-hop emergency split batch from closest cold-chain hub while ${shp.shipmentCode} clears congestion.`,
        stockoutRiskPct: 18,
        projectedDaysOfCover: 4.5,
        spoilageRiskPct: med?.coldChainRequired ? 10 : 3,
        estimatedEtaMinutes: Math.max(45, Math.round(altEta * 0.55)),
        estimatedCostInr: 1650,
        patientServiceImpact: 'Prevents immediate clinic shortage with slightly higher split freight cost.',
        feasibilityStatus: 'VIABLE',
      },
      {
        key: 'HOLD_PRIMARY_CORRIDOR',
        label: 'Outcome C: Remain on Current Corridor & Monitor Delay',
        strategySummary: `Keep ${shp.shipmentCode} on blocked stretch (+${shp.delayMinutes} min delay) with temperature telemetry polling.`,
        stockoutRiskPct: shp.delayMinutes > 45 ? 58 : 26,
        projectedDaysOfCover: 2.1,
        spoilageRiskPct: coldPenalty,
        estimatedEtaMinutes: primaryEta,
        estimatedCostInr: Math.round(shp.distanceKm * 11),
        patientServiceImpact: 'Elevated risk of downstream reorder breach during peak demand.',
        feasibilityStatus: shp.delayMinutes > 45 ? 'CONSTRAINED' : 'VIABLE',
      },
      {
        key: 'NO_INTERVENTION',
        label: 'Outcome D: Do Nothing / Unmitigated Delay',
        strategySummary: 'No reroute or adjacent coordination; downstream facility consumes remaining safety stock.',
        stockoutRiskPct: 84,
        projectedDaysOfCover: 0.4,
        spoilageRiskPct: Math.min(72, coldPenalty + 24),
        estimatedEtaMinutes: primaryEta + 60,
        estimatedCostInr: 0,
        patientServiceImpact: 'High probability of patient-facing stockout and batch holdover excursion.',
        feasibilityStatus: 'HIGH_RISK',
      },
    ];

    const best = outcomes.find((o) => o.feasibilityStatus === 'OPTIMAL') ?? outcomes[0];
    return {
      entityType: 'SHIPMENT',
      entityId: shp.id,
      title: `${shp.shipmentCode}: ${origin?.city ?? shp.originNodeId} → ${dest?.city ?? shp.destinationNodeId} (${med?.brandName ?? shp.medicineId})`,
      definedNeed: `Deliver ${shp.quantity} units of ${med?.brandName ?? shp.medicineId} to ${dest?.name ?? shp.destinationNodeId} without cold-chain excursion or stockout.`,
      relatedInfo: `Primary distance ${shp.distanceKm} km · Current delay +${shp.delayMinutes} min · Cold-chain required: ${med?.coldChainRequired ? 'Yes (2°C–8°C)' : 'No'}.`,
      outcomes,
      recommendedOutcomeKey: best.key,
      predictiveSolutionSummary: `After evaluating all 4 transit outcomes, ${best.label} minimizes stockout risk (${best.stockoutRiskPct}%) and cuts transit ETA to ${best.estimatedEtaMinutes} min. Human dispatcher approval required before reroute confirmation.`,
      confidenceLabel: 'BOUNDED_SIMULATION',
      requiresHumanApproval: true,
      dataStatus: shp.dataStatus,
      evaluatedAt: new Date().toISOString(),
    };
  }

  let inv = store.inventory.find((i) => i.id === params.entityId);
  let alertTitle: string | null = null;
  let extraInfo = '';

  if (params.entityType === 'INCIDENT') {
    const alert = store.alerts.find((a) => a.id === params.entityId);
    if (!alert) throw new Error('Incident not found for predictive evaluation.');
    alertTitle = alert.title;
    extraInfo = `${alert.causeCertainty} ${alert.rootCauseCategory.replace(/_/g, ' ')} · ${alert.rootCauseSummary}`;
    inv =
      store.inventory.find((i) => i.id === alert.relatedEntityId) ??
      store.inventory.find((i) => i.nodeId === alert.nodeId);
    if (!inv && alert.relatedEntityId.startsWith('shp-')) {
      const shpEval = await evaluateAllPredictiveOutcomes({
        entityType: 'SHIPMENT',
        entityId: alert.relatedEntityId,
      });
      return {
        ...shpEval,
        entityType: 'INCIDENT',
        entityId: alert.id,
        title: alert.title,
        relatedInfo: extraInfo,
      };
    }
  }

  if (!inv) {
    throw new Error('Linked inventory record not found for predictive evaluation.');
  }

  const node = store.getNodeById(inv.nodeId)!;
  const med = store.getMedicineById(inv.medicineId)!;
  const forecast = computeDemandForecast(inv.dailyDemandHistory, 7);
  const dailyDemand = Math.max(1, forecast.dailyForecast);
  const effectiveNow = Math.max(0, inv.availableQty - inv.reservedQty);
  const currentCoverDays = Number((effectiveNow / dailyDemand).toFixed(1));
  const neededQty = Math.max(60, inv.reorderLevel * 2 - inv.availableQty);

  const donor = store.inventory
    .filter((i) => i.medicineId === inv!.medicineId && i.nodeId !== inv!.nodeId && i.availableQty > i.reorderLevel)
    .sort((a, b) => b.availableQty - a.availableQty)[0];

  let donorName = 'Nearest MP C&F Hub';
  let donorEta = 110;
  let donorCost = 1450;
  if (donor) {
    const donorNode = store.getNodeById(donor.nodeId)!;
    donorName = donorNode.name;
    const route = await calculateRouteBetweenNodes(donorNode.id, node.id);
    donorEta = route.estimatedMinutes;
    donorCost = Math.round(route.distanceKm * (med.coldChainRequired ? 18 : 11) + 450);
  }

  const cnfHub =
    store.nodes.find((n) => n.level === 'CNF_AGENT' && n.id !== node.id) ??
    store.nodes.find((n) => n.level === 'MANUFACTURER')!;
  const upstreamRoute = await calculateRouteBetweenNodes(cnfHub.id, node.id);
  const upstreamEta = upstreamRoute.estimatedMinutes + 60;
  const upstreamCost = Math.round(upstreamRoute.distanceKm * 12 + 650);

  const isExpiryHeavy = inv.availableQty > inv.reorderLevel * 2;

  const outcomes: PredictiveOutcomeOption[] = [
    {
      key: isExpiryHeavy ? 'FEFO_OUTBOUND_REBALANCE' : 'ADJACENT_REDISTRIBUTION',
      label: isExpiryHeavy
        ? 'Outcome A: Redistribute Excess Stock to Deficit MP Districts'
        : `Outcome A: Rapid Inter-Node Redistribution from ${donorName}`,
      strategySummary: isExpiryHeavy
        ? `Transfer surplus ${med.brandName} before expiry (${inv.expiryDate}) to adjacent deficit nodes via FEFO queue.`
        : `Dispatch ${neededQty} units of ${med.brandName} from ${donorName} using ${med.coldChainRequired ? '2°C–8°C van' : 'standard carrier'}.`,
      stockoutRiskPct: isExpiryHeavy ? 6 : 8,
      projectedDaysOfCover: Number(((effectiveNow + (isExpiryHeavy ? -neededQty * 0.25 : neededQty)) / dailyDemand).toFixed(1)),
      spoilageRiskPct: isExpiryHeavy ? 9 : med.coldChainRequired ? 6 : 2,
      estimatedEtaMinutes: donorEta,
      estimatedCostInr: donorCost,
      patientServiceImpact: isExpiryHeavy
        ? 'Prevents expiry write-off and closes deficit in neighboring MP districts.'
        : `Restores ${node.city} inventory above safety threshold within ${(donorEta / 60).toFixed(1)} hrs.`,
      feasibilityStatus: 'OPTIMAL',
    },
    {
      key: 'UPSTREAM_REPLENISHMENT',
      label: `Outcome B: Upstream C&F Replenishment (${cnfHub.city})`,
      strategySummary: `Raise replenishment order of ${Math.max(neededQty, 300)} units from ${cnfHub.name}.`,
      stockoutRiskPct: donorEta < upstreamEta ? 22 : 14,
      projectedDaysOfCover: Number(((effectiveNow + Math.max(neededQty, 300)) / dailyDemand).toFixed(1)),
      spoilageRiskPct: med.coldChainRequired ? 9 : 3,
      estimatedEtaMinutes: upstreamEta,
      estimatedCostInr: upstreamCost,
      patientServiceImpact: 'Rebuilds full 7-day buffer, but longer dispatch staging leaves short near-term gap.',
      feasibilityStatus: 'VIABLE',
    },
    {
      key: 'STAGED_SPLIT_FAST_REACH',
      label: 'Outcome C: Split Emergency Batch + 1-Hop Rapid-Reach Pickup',
      strategySummary: `Request urgent 10-min duty desk confirmation for 40% immediate courier dispatch + 60% scheduled trunk replenishment.`,
      stockoutRiskPct: 15,
      projectedDaysOfCover: Number(((effectiveNow + neededQty * 0.8) / dailyDemand).toFixed(1)),
      spoilageRiskPct: med.coldChainRequired ? 8 : 3,
      estimatedEtaMinutes: Math.max(35, Math.round(donorEta * 0.72)),
      estimatedCostInr: Math.round(donorCost * 1.25),
      patientServiceImpact: 'Fastest initial arrival at clinic/pharmacy; higher split logistics fee.',
      feasibilityStatus: 'VIABLE',
    },
    {
      key: 'BASELINE_NO_ACTION',
      label: 'Outcome D: Do Nothing / Baseline 7-Day Trajectory',
      strategySummary: `No redistribution or replenishment triggered; demand continues at ~${dailyDemand} units/day.`,
      stockoutRiskPct: currentCoverDays <= 2 ? 96 : currentCoverDays <= 5 ? 64 : 18,
      projectedDaysOfCover: Math.max(0, Number((currentCoverDays - 7).toFixed(1))),
      spoilageRiskPct: isExpiryHeavy ? 78 : 5,
      estimatedEtaMinutes: null,
      estimatedCostInr: 0,
      patientServiceImpact: isExpiryHeavy
        ? 'High likelihood of batch expiry loss while neighboring MP tiers face deficits.'
        : 'Severe patient access gap and emergency stockout within 24–72 hours.',
      feasibilityStatus: 'HIGH_RISK',
    },
  ];

  const best = outcomes[0];
  return {
    entityType: params.entityType,
    entityId: params.entityId,
    title: alertTitle ?? `${med.brandName} at ${node.name} (${node.city})`,
    definedNeed: isExpiryHeavy
      ? `Reallocate excess/short-expiry batch ${inv.batchNumber} (${inv.availableQty} units, exp ${inv.expiryDate}) before write-off.`
      : `Replenish ${neededQty} units of ${med.brandName} (${med.strength}) to cover ${dailyDemand}/day demand (currently ${inv.availableQty} units = ${currentCoverDays}d cover vs ${inv.safetyStock} safety stock).`,
    relatedInfo:
      extraInfo ||
      `Node Tier: ${node.level.replace(/_/g, ' ')} · Address: ${node.fullAddress} · Cold-chain required: ${med.coldChainRequired ? 'Yes (2°C–8°C)' : 'No'} · 7-day trend: ${forecast.trendPct >= 0 ? `+${forecast.trendPct}%` : `${forecast.trendPct}%`}.`,
    outcomes,
    recommendedOutcomeKey: best.key,
    predictiveSolutionSummary: `Predictive Solution after evaluating all 4 outcomes: Execute "${best.label}" (${best.stockoutRiskPct}% residual risk, ETA ${best.estimatedEtaMinutes} min, est. ₹${best.estimatedCostInr}). Human approval is strictly required before transfer or brand decisions.`,
    confidenceLabel: 'BOUNDED_SIMULATION',
    requiresHumanApproval: true,
    dataStatus: inv.dataStatus,
    evaluatedAt: new Date().toISOString(),
  };
}
