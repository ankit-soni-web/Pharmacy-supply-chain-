import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { eventBus } from '../eventBus.ts';
import { RequestWithAuth } from '../middleware/auth.ts';
import { store } from '../store.ts';
import { ApprovalRecommendation, InventoryRecord, Shipment } from '../types.ts';
import { calculateRouteBetweenNodes } from './routeAgent.ts';

export function computeDemandForecast(history: number[], horizonDays = 7) {
  if (!history.length) {
    return {
      dailyForecast: 0,
      horizonTotal: 0,
      trendPct: 0,
      method: 'Unavailable (insufficient historical points)',
    };
  }
  const n = history.length;
  const recentWindow = history.slice(-5);
  const earlierWindow = history.slice(0, Math.max(1, n - 5));
  const recentAvg = recentWindow.reduce((a, b) => a + b, 0) / recentWindow.length;
  const earlierAvg = earlierWindow.reduce((a, b) => a + b, 0) / earlierWindow.length;
  const trendPct = earlierAvg > 0 ? Number((((recentAvg - earlierAvg) / earlierAvg) * 100).toFixed(1)) : 0;

  // Exponential smoothing (alpha = 0.35) + dampened linear slope
  const alpha = 0.35;
  let smoothed = history[0];
  for (let i = 1; i < n; i++) {
    smoothed = alpha * history[i] + (1 - alpha) * smoothed;
  }
  const slopePerDay = n > 1 ? (history[n - 1] - history[0]) / (n - 1) : 0;
  const forecastSeries: { day: number; predictedQty: number; lowerBound: number; upperBound: number }[] = [];
  let horizonTotal = 0;

  for (let day = 1; day <= horizonDays; day++) {
    const raw = Math.max(1, Math.round(smoothed + slopePerDay * day * 0.45));
    horizonTotal += raw;
    forecastSeries.push({
      day,
      predictedQty: raw,
      lowerBound: Math.max(0, Math.round(raw * 0.85)),
      upperBound: Math.round(raw * 1.15),
    });
  }

  return {
    dailyForecast: Math.round(horizonTotal / horizonDays),
    horizonTotal,
    trendPct,
    method: 'Exponential Smoothing (α=0.35) + Dampened Linear Slope',
    forecastSeries,
  };
}

function enrichInventoryRow(inv: InventoryRecord) {
  const node = store.getNodeById(inv.nodeId);
  const medicine = store.getMedicineById(inv.medicineId);
  const forecast = computeDemandForecast(inv.dailyDemandHistory, 7);
  const effectiveAvailable = Math.max(0, inv.availableQty - inv.reservedQty);
  const daysOfCover =
    forecast.dailyForecast > 0 ? Number((effectiveAvailable / forecast.dailyForecast).toFixed(1)) : null;

  const nowMs = Date.parse('2026-11-12T12:00:00Z');
  const expiryMs = Date.parse(inv.expiryDate);
  const daysToExpiry = Math.round((expiryMs - nowMs) / (1000 * 60 * 60 * 24));

  const isShortage = inv.availableQty <= inv.reorderLevel || inv.availableQty <= inv.safetyStock;
  const isCriticalShortage = inv.availableQty <= inv.safetyStock;
  const isExcess = inv.availableQty > inv.reorderLevel * 2.4 && (daysOfCover ?? 0) > 25;
  const isExpiryRisk = daysToExpiry <= 65 && inv.availableQty > forecast.dailyForecast * Math.max(1, daysToExpiry);

  return {
    ...inv,
    nodeName: node?.name ?? inv.nodeId,
    nodeLevel: node?.level ?? 'RETAIL_PHARMACY',
    districtId: node?.districtId ?? '',
    city: node?.city ?? '',
    coldChainCapable: node?.coldChainCapable ?? false,
    medicineBrand: medicine?.brandName ?? inv.medicineId,
    genericName: medicine?.genericName ?? '',
    coldChainRequired: medicine?.coldChainRequired ?? false,
    dailyForecast: forecast.dailyForecast,
    demandTrendPct: forecast.trendPct,
    daysOfCover,
    daysToExpiry,
    flags: {
      shortage: isShortage,
      criticalShortage: isCriticalShortage,
      excess: isExcess,
      expiryRisk: isExpiryRisk,
      highDemand: forecast.trendPct >= 25,
      lowDemand: forecast.trendPct <= -15,
    },
  };
}

export function queryLiveStockForMedicine(query: string) {
  const q = query.toLowerCase();
  const matchingMedicines = store.medicines.filter(
    (m) =>
      m.brandName.toLowerCase().includes(q) ||
      m.genericName.toLowerCase().includes(q) ||
      m.composition.toLowerCase().includes(q)
  );
  const medIds = new Set(matchingMedicines.map((m) => m.id));
  const records = store.inventory
    .filter((i) => medIds.has(i.medicineId))
    .map(enrichInventoryRow);
  return { matchingMedicines, records };
}

export function registerSupplyAgentRoutes(router: Router) {
  router.get('/supply/inventory', (req, res) => {
    const { districtId, level, medicineId } = req.query as Record<string, string | undefined>;
    let rows = store.inventory.map(enrichInventoryRow);
    if (districtId && districtId !== 'ALL') {
      rows = rows.filter((r) => r.districtId === districtId);
    }
    if (level && level !== 'ALL') {
      rows = rows.filter((r) => r.nodeLevel === level);
    }
    if (medicineId && medicineId !== 'ALL') {
      rows = rows.filter((r) => r.medicineId === medicineId);
    }

    res.json({
      inventory: rows,
      approvals: store.approvals,
      medicines: store.medicines,
      nodes: store.nodes,
    });
  });

  router.get('/supply/shortages', (_req, res) => {
    const shortages = store.inventory.map(enrichInventoryRow).filter((r) => r.flags.shortage);
    res.json({ shortages });
  });

  router.get('/supply/excess', (_req, res) => {
    const excess = store.inventory
      .map(enrichInventoryRow)
      .filter((r) => r.flags.excess || r.flags.expiryRisk);
    res.json({ excess });
  });

  router.post('/supply/scan', async (_req, res) => {
    const rows = store.inventory.map(enrichInventoryRow);
    const excessRows = rows.filter((r) => r.flags.excess);
    const expiryRows = rows.filter((r) => r.flags.expiryRisk);
    const shortageRows = rows.filter((r) => r.flags.shortage);

    for (const r of excessRows) {
      await eventBus.publish({
        event_type: 'EXCESS_STOCK_IDENTIFIED',
        source_agent: 'SUPPLY_MANAGEMENT_AGENT',
        district_id: r.districtId,
        distribution_node_id: r.nodeId,
        entity_id: r.id,
        priority: 'MEDIUM',
        data_status: r.dataStatus,
        payload: {
          nodeName: r.nodeName,
          medicineBrand: r.medicineBrand,
          availableQty: r.availableQty,
          daysOfCover: r.daysOfCover,
        },
        dedupeWindowMs: 10000,
      });
    }

    for (const r of expiryRows) {
      await eventBus.publish({
        event_type: 'EXPIRY_RISK_DETECTED',
        source_agent: 'SUPPLY_MANAGEMENT_AGENT',
        district_id: r.districtId,
        distribution_node_id: r.nodeId,
        entity_id: r.id,
        priority: r.daysToExpiry <= 45 ? 'HIGH' : 'MEDIUM',
        data_status: r.dataStatus,
        payload: {
          nodeName: r.nodeName,
          medicineBrand: r.medicineBrand,
          batchNumber: r.batchNumber,
          expiryDate: r.expiryDate,
          daysToExpiry: r.daysToExpiry,
          availableQty: r.availableQty,
        },
        dedupeWindowMs: 10000,
      });
    }

    res.json({
      scannedRecords: rows.length,
      shortageCount: shortageRows.length,
      excessCount: excessRows.length,
      expiryRiskCount: expiryRows.length,
    });
  });

  router.post('/supply/forecast', (req, res) => {
    const { inventoryId, horizonDays } = req.body as { inventoryId: string; horizonDays?: number };
    const inv = store.inventory.find((i) => i.id === inventoryId);
    if (!inv) {
      return res.status(404).json({ error: 'Inventory record not found.' });
    }
    const forecast = computeDemandForecast(inv.dailyDemandHistory, horizonDays ?? 7);
    const enriched = enrichInventoryRow(inv);
    res.json({
      inventoryId: inv.id,
      nodeName: enriched.nodeName,
      medicineBrand: enriched.medicineBrand,
      historicalSeries: inv.dailyDemandHistory.map((qty, idx) => ({
        day: `D-${inv.dailyDemandHistory.length - idx}`,
        actualQty: qty,
      })),
      ...forecast,
      projectedStockoutInDays:
        forecast.dailyForecast > 0
          ? Number((Math.max(0, inv.availableQty - inv.reservedQty) / forecast.dailyForecast).toFixed(1))
          : null,
      dataStatus: inv.dataStatus,
      source: inv.source,
    });
  });

  router.post('/supply/redistribution', async (req, res) => {
    try {
      const { targetNodeId, medicineId, requestedQty } = req.body as {
        targetNodeId: string;
        medicineId: string;
        requestedQty?: number;
      };
      const targetNode = store.getNodeById(targetNodeId);
      const medicine = store.getMedicineById(medicineId);
      if (!targetNode || !medicine) {
        return res.status(404).json({ error: 'Target MP node or medicine not found.' });
      }

      const targetInv = store.inventory.find((i) => i.nodeId === targetNodeId && i.medicineId === medicineId);
      const qtyNeeded = requestedQty ?? Math.max(50, (targetInv?.reorderLevel ?? 100) - (targetInv?.availableQty ?? 0));

      // Eligible MP donor nodes with surplus above safety stock
      const candidates = store.inventory
        .filter((i) => i.medicineId === medicineId && i.nodeId !== targetNodeId)
        .map((i) => ({ inv: i, enriched: enrichInventoryRow(i) }))
        .filter(({ inv, enriched }) => {
          const surplus = inv.availableQty - inv.reorderLevel;
          const coldOk = !medicine.coldChainRequired || enriched.coldChainCapable;
          return surplus >= Math.min(qtyNeeded, 40) && coldOk && enriched.daysToExpiry > 30;
        });

      if (candidates.length === 0) {
        return res.status(400).json({
          error: 'No eligible MP distribution node currently holds sufficient surplus & cold-chain capability for redistribution. Consider upstream replenishment.',
        });
      }

      const evaluated = await Promise.all(
        candidates.map(async ({ inv, enriched }) => {
          const route = await calculateRouteBetweenNodes(inv.nodeId, targetNodeId);
          const transferQty = Math.min(qtyNeeded, Math.max(20, inv.availableQty - inv.safetyStock));
          const estimatedTransportCostInr = Math.round(route.distanceKm * (medicine.coldChainRequired ? 18 : 11) + 450);
          return {
            sourceNodeId: inv.nodeId,
            sourceNodeName: enriched.nodeName,
            sourceDistrictId: enriched.districtId,
            sourceAvailableQty: inv.availableQty,
            recommendedQty: transferQty,
            distanceKm: route.distanceKm,
            estimatedEtaMinutes: route.estimatedMinutes,
            estimatedTransportCostInr,
            routingProvider: route.routingProvider,
            coldChainCompatible: !medicine.coldChainRequired || (enriched.coldChainCapable && targetNode.coldChainCapable),
            score: route.estimatedMinutes + estimatedTransportCostInr * 0.02,
          };
        })
      );

      evaluated.sort((a, b) => a.score - b.score);
      const best = evaluated[0];

      const approval: ApprovalRecommendation = {
        id: `apr-${uuidv4().slice(0, 6)}`,
        recommendationType: 'REDISTRIBUTION',
        title: `Redistribute ${best.recommendedQty} ${medicine.brandName} (${best.sourceNodeName} → ${targetNode.name})`,
        medicineId: medicine.id,
        sourceNodeId: best.sourceNodeId,
        targetNodeId: targetNode.id,
        quantity: best.recommendedQty,
        rationale: `${targetNode.name} requires ${qtyNeeded} units. ${best.sourceNodeName} holds ${best.sourceAvailableQty} units above safety threshold with ${best.distanceKm} km route (${best.estimatedEtaMinutes} min ETA via ${best.routingProvider}).`,
        expectedImpact: `Covers projected ${targetNode.city} demand without breaching ${best.sourceNodeName} safety stock.`,
        estimatedTransportCostInr: best.estimatedTransportCostInr,
        estimatedEtaMinutes: best.estimatedEtaMinutes,
        routeFeasible: true,
        coldChainCompatible: best.coldChainCompatible,
        status: 'PENDING',
        relatedIncidentId: null,
        requestedByAgent: 'SUPPLY_MANAGEMENT_AGENT',
        reviewedBy: null,
        reviewerRole: null,
        reviewedAt: null,
        reviewNotes: null,
        createdAt: new Date().toISOString(),
        dataStatus: 'SIMULATED',
        source: 'Supply Agent + Route Agent Feasibility Evaluation',
      };

      store.approvals.unshift(approval);

      await eventBus.publish({
        event_type: 'REDISTRIBUTION_RECOMMENDED',
        source_agent: 'SUPPLY_MANAGEMENT_AGENT',
        district_id: targetNode.districtId,
        distribution_node_id: targetNode.id,
        entity_id: approval.id,
        priority: 'HIGH',
        data_status: 'SIMULATED',
        requires_approval: true,
        payload: {
          title: approval.title,
          quantity: approval.quantity,
          sourceNodeId: approval.sourceNodeId,
          targetNodeId: approval.targetNodeId,
          estimatedEtaMinutes: approval.estimatedEtaMinutes,
        },
      });

      store.addAuditLog({
        actorId: 'supply-management-agent',
        actorRole: 'SYSTEM_AGENT',
        action: 'REDISTRIBUTION_RECOMMENDED',
        entityType: 'ApprovalRecommendation',
        entityId: approval.id,
        details: `${approval.title} — awaiting authorized human approval.`,
      });

      res.status(201).json({ recommendation: approval, evaluatedCandidates: evaluated });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Redistribution analysis failed.' });
    }
  });

  router.post('/supply/replenishment', async (req, res) => {
    try {
      const { targetNodeId, medicineId, quantity } = req.body as {
        targetNodeId: string;
        medicineId: string;
        quantity?: number;
      };
      const targetNode = store.getNodeById(targetNodeId);
      const medicine = store.getMedicineById(medicineId);
      if (!targetNode || !medicine) {
        return res.status(404).json({ error: 'Node or medicine not found.' });
      }
      const upstream =
        store.nodes.find((n) => n.level === 'CNF_AGENT' && n.districtId === 'mp-bhopal') ??
        store.nodes.find((n) => n.level === 'MANUFACTURER')!;
      const route = await calculateRouteBetweenNodes(upstream.id, targetNode.id);
      const orderQty = quantity ?? 500;
      const estimatedTransportCostInr = Math.round(route.distanceKm * 12 + 650);

      const approval: ApprovalRecommendation = {
        id: `apr-${uuidv4().slice(0, 6)}`,
        recommendationType: 'REPLENISHMENT',
        title: `Upstream Replenishment: ${orderQty} ${medicine.brandName} (${upstream.name} → ${targetNode.name})`,
        medicineId: medicine.id,
        sourceNodeId: upstream.id,
        targetNodeId: targetNode.id,
        quantity: orderQty,
        rationale: `Replenishment order from upstream ${upstream.level} to rebuild safety buffer at ${targetNode.name}.`,
        expectedImpact: `Replenishes ${orderQty} units; estimated transit ${route.estimatedMinutes} min (${route.distanceKm} km).`,
        estimatedTransportCostInr,
        estimatedEtaMinutes: route.estimatedMinutes,
        routeFeasible: true,
        coldChainCompatible: !medicine.coldChainRequired || upstream.coldChainCapable,
        status: 'PENDING',
        relatedIncidentId: null,
        requestedByAgent: 'SUPPLY_MANAGEMENT_AGENT',
        reviewedBy: null,
        reviewerRole: null,
        reviewedAt: null,
        reviewNotes: null,
        createdAt: new Date().toISOString(),
        dataStatus: 'SIMULATED',
        source: 'Supply Agent Upstream Replenishment Planner',
      };

      store.approvals.unshift(approval);

      await eventBus.publish({
        event_type: 'REPLENISHMENT_REQUIRED',
        source_agent: 'SUPPLY_MANAGEMENT_AGENT',
        district_id: targetNode.districtId,
        distribution_node_id: targetNode.id,
        entity_id: approval.id,
        priority: 'MEDIUM',
        data_status: 'SIMULATED',
        requires_approval: true,
        payload: {
          title: approval.title,
          quantity: orderQty,
        },
      });

      res.status(201).json({ recommendation: approval });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Replenishment failed.' });
    }
  });

  router.post('/supply/approve-transfer', async (req: RequestWithAuth, res) => {
    try {
      const { approvalId, decision, notes } = req.body as {
        approvalId: string;
        decision: 'APPROVED' | 'REJECTED';
        notes?: string;
      };
      const actorRole = req.authContext?.role ?? 'STATE_ADMIN';
      const actorId = req.authContext?.email ?? req.authContext?.uid ?? 'authorized-operator';

      // Enforce RBAC for consequential stock transfers
      const permittedApprovers = ['STATE_ADMIN', 'MANUFACTURER', 'CNF_AGENT', 'SUPER_STOCKIST', 'WHOLESALER'];
      if (!permittedApprovers.includes(actorRole)) {
        return res.status(403).json({
          error: `Role ${actorRole} cannot authorize inter-node stock transfers. Switch to State Admin, C&F Agent, Super-Stockist, or Wholesaler.`,
        });
      }

      const approval = store.approvals.find((a) => a.id === approvalId);
      if (!approval) {
        return res.status(404).json({ error: 'Approval recommendation not found.' });
      }
      if (approval.status !== 'PENDING') {
        return res.status(400).json({ error: `Recommendation already ${approval.status}.` });
      }

      approval.status = decision;
      approval.reviewedBy = actorId;
      approval.reviewerRole = actorRole;
      approval.reviewedAt = new Date().toISOString();
      approval.reviewNotes = notes ?? (decision === 'APPROVED' ? 'Authorized for dispatch.' : 'Rejected by reviewer.');

      let createdShipment: Shipment | null = null;
      if (decision === 'APPROVED') {
        const srcInv = store.inventory.find(
          (i) => i.nodeId === approval.sourceNodeId && i.medicineId === approval.medicineId
        );
        if (srcInv) {
          srcInv.availableQty = Math.max(0, srcInv.availableQty - approval.quantity);
          srcInv.outgoingQty += approval.quantity;
          srcInv.updatedAt = new Date().toISOString();
        }
        let tgtInv = store.inventory.find(
          (i) => i.nodeId === approval.targetNodeId && i.medicineId === approval.medicineId
        );
        if (tgtInv) {
          tgtInv.incomingQty += approval.quantity;
          tgtInv.updatedAt = new Date().toISOString();
        } else {
          const med = store.getMedicineById(approval.medicineId);
          tgtInv = {
            id: `inv-${uuidv4().slice(0, 6)}`,
            nodeId: approval.targetNodeId,
            medicineId: approval.medicineId,
            batchNumber: srcInv?.batchNumber ?? 'MP-TRF-2026',
            expiryDate: srcInv?.expiryDate ?? '2027-09-30',
            availableQty: 0,
            reservedQty: 0,
            incomingQty: approval.quantity,
            outgoingQty: 0,
            reorderLevel: 100,
            safetyStock: 50,
            dailyDemandHistory: [15, 16, 18, 17, 19, 20, 22],
            unitCostInr: med?.distributorPurchasePriceInr ?? 100,
            dataStatus: 'SIMULATED',
            source: 'Approved Transfer Dispatch',
            updatedAt: new Date().toISOString(),
          };
          store.inventory.push(tgtInv);
        }

        const route = await calculateRouteBetweenNodes(approval.sourceNodeId, approval.targetNodeId);
        const medicine = store.getMedicineById(approval.medicineId);
        createdShipment = {
          id: `shp-${uuidv4().slice(0, 6)}`,
          shipmentCode: `MP-SHP-2026-${Math.floor(200 + Math.random() * 799)}`,
          originNodeId: approval.sourceNodeId,
          destinationNodeId: approval.targetNodeId,
          medicineId: approval.medicineId,
          quantity: approval.quantity,
          vehicleId: medicine?.coldChainRequired ? 'MP-04-CC-7721' : 'MP-09-TR-3310',
          vehicleCapacityUnits: 5000,
          coldChainVehicle: Boolean(medicine?.coldChainRequired),
          coldChainRequired: Boolean(medicine?.coldChainRequired),
          status: 'IN_TRANSIT',
          distanceKm: route.distanceKm,
          estimatedMinutes: route.estimatedMinutes,
          baselineMinutes: route.baselineMinutes,
          delayMinutes: route.delayMinutes,
          routingProvider: route.routingProvider,
          geometry: route.geometry,
          alternativeGeometry: route.alternativeGeometry,
          alternativeDistanceKm: route.alternativeDistanceKm,
          alternativeMinutes: route.alternativeMinutes,
          disruptionIds: route.affectingDisruptions.map((d) => d.id),
          dataStatus: route.dataStatus,
          source: 'Approved Redistribution Dispatch',
          updatedAt: new Date().toISOString(),
        };
        store.shipments.unshift(createdShipment);

        // Update linked incident if present
        if (approval.relatedIncidentId) {
          const incident = store.alerts.find((a) => a.id === approval.relatedIncidentId);
          if (incident && incident.status !== 'RESOLVED') {
            incident.status = 'INVESTIGATING';
            incident.resolutionNotes = `Transfer ${createdShipment.shipmentCode} dispatched (${approval.quantity} units).`;
          }
        }
      }

      store.addAuditLog({
        actorId,
        actorRole,
        action: `TRANSFER_${decision}`,
        entityType: 'ApprovalRecommendation',
        entityId: approval.id,
        details: `${approval.title} -> ${decision}. ${createdShipment ? `Dispatched ${createdShipment.shipmentCode}.` : ''}`,
      });

      res.json({ approval, shipment: createdShipment });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Approval processing failed.' });
    }
  });

  // Integrated end-to-end scenario trigger (Part 3 Example Scenario)
  router.post('/supply/report-shortage', async (req, res) => {
    try {
      const { nodeId, medicineId, reportedQtyRemaining } = req.body as {
        nodeId: string;
        medicineId: string;
        reportedQtyRemaining?: number;
      };
      const node = store.getNodeById(nodeId);
      const medicine = store.getMedicineById(medicineId);
      if (!node || !medicine) {
        return res.status(404).json({ error: 'MP node or medicine not found.' });
      }

      let inv = store.inventory.find((i) => i.nodeId === nodeId && i.medicineId === medicineId);
      if (!inv) {
        inv = {
          id: `inv-${uuidv4().slice(0, 6)}`,
          nodeId,
          medicineId,
          batchNumber: 'MP-REP-2026',
          expiryDate: '2027-10-30',
          availableQty: reportedQtyRemaining ?? 10,
          reservedQty: 4,
          incomingQty: 0,
          outgoingQty: 0,
          reorderLevel: 120,
          safetyStock: 60,
          dailyDemandHistory: [18, 20, 22, 24, 27, 30, 34, 36, 39, 42],
          unitCostInr: medicine.distributorPurchasePriceInr,
          dataStatus: 'SIMULATED',
          source: 'Pharmacy Shortage Report Trigger',
          updatedAt: new Date().toISOString(),
        };
        store.inventory.push(inv);
      } else {
        inv.availableQty = reportedQtyRemaining ?? Math.min(12, Math.max(2, Math.round(inv.safetyStock * 0.25)));
        inv.updatedAt = new Date().toISOString();
      }

      await eventBus.publish({
        event_type: 'STOCK_SHORTAGE_DETECTED',
        source_agent: 'SUPPLY_MANAGEMENT_AGENT',
        district_id: node.districtId,
        distribution_node_id: node.id,
        entity_id: inv.id,
        priority: 'CRITICAL',
        data_status: inv.dataStatus,
        payload: {
          nodeName: node.name,
          nodeLevel: node.level,
          medicineId: medicine.id,
          medicineBrand: medicine.brandName,
          availableQty: inv.availableQty,
          safetyStock: inv.safetyStock,
        },
      });

      // Automatically evaluate eligible MP redistribution option (held for human approval!)
      const donor = store.inventory
        .filter((i) => i.medicineId === medicineId && i.nodeId !== nodeId && i.availableQty > i.reorderLevel + 100)
        .sort((a, b) => b.availableQty - a.availableQty)[0];

      let recommendation: ApprovalRecommendation | null = null;
      if (donor) {
        const donorNode = store.getNodeById(donor.nodeId)!;
        const route = await calculateRouteBetweenNodes(donorNode.id, node.id);
        const qty = Math.min(200, Math.max(50, inv.reorderLevel - inv.availableQty));
        recommendation = {
          id: `apr-${uuidv4().slice(0, 6)}`,
          recommendationType: 'REDISTRIBUTION',
          title: `Shortage Response Transfer: ${qty} ${medicine.brandName} (${donorNode.name} → ${node.name})`,
          medicineId: medicine.id,
          sourceNodeId: donorNode.id,
          targetNodeId: node.id,
          quantity: qty,
          rationale: `Triggered by ${node.name} shortage report (${inv.availableQty} left vs ${inv.safetyStock} safety stock). ${donorNode.name} holds ${donor.availableQty} units; route ${route.distanceKm} km (~${route.estimatedMinutes} min).`,
          expectedImpact: `Restores ${node.city} inventory above reorder level without impacting ${donorNode.city} safety stock.`,
          estimatedTransportCostInr: Math.round(route.distanceKm * (medicine.coldChainRequired ? 18 : 11) + 450),
          estimatedEtaMinutes: route.estimatedMinutes,
          routeFeasible: true,
          coldChainCompatible: !medicine.coldChainRequired || (donorNode.coldChainCapable && node.coldChainCapable),
          status: 'PENDING',
          relatedIncidentId: store.alerts[0]?.id ?? null,
          requestedByAgent: 'SUPPLY_MANAGEMENT_AGENT',
          reviewedBy: null,
          reviewerRole: null,
          reviewedAt: null,
          reviewNotes: null,
          createdAt: new Date().toISOString(),
          dataStatus: 'SIMULATED',
          source: 'Integrated Shortage Orchestration Workflow',
        };
        store.approvals.unshift(recommendation);

        await eventBus.publish({
          event_type: 'REDISTRIBUTION_RECOMMENDED',
          source_agent: 'SUPPLY_MANAGEMENT_AGENT',
          district_id: node.districtId,
          distribution_node_id: node.id,
          entity_id: recommendation.id,
          priority: 'HIGH',
          data_status: 'SIMULATED',
          requires_approval: true,
          payload: {
            title: recommendation.title,
            quantity: recommendation.quantity,
          },
        });
      }

      res.status(201).json({
        shortageInventory: enrichInventoryRow(inv),
        recommendation,
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Shortage trigger failed.' });
    }
  });
}
