import { Router } from 'express';
import { eventBus } from '../eventBus.ts';
import { RequestWithAuth } from '../middleware/auth.ts';
import { store } from '../store.ts';
import { DistributionLevel } from '../types.ts';

export interface KpiMetric {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  status: 'AVAILABLE' | 'UNAVAILABLE';
  unavailableReason?: string;
  formula: string;
  dataStatus: 'SIMULATED' | 'VERIFIED';
}

function calculateKpis(filterDistrictId?: string, filterLevel?: DistributionLevel): KpiMetric[] {
  const nodeSet = new Set(
    store.nodes
      .filter((n) => {
        if (filterDistrictId && filterDistrictId !== 'ALL' && n.districtId !== filterDistrictId) return false;
        if (filterLevel && n.level !== filterLevel) return false;
        return true;
      })
      .map((n) => n.id)
  );

  const invRows = store.inventory.filter((i) => nodeSet.has(i.nodeId));
  const orders = store.orders.filter(
    (o) => nodeSet.has(o.requestingNodeId) || nodeSet.has(o.supplyingNodeId)
  );
  const shipments = store.shipments.filter(
    (s) => nodeSet.has(s.originNodeId) || nodeSet.has(s.destinationNodeId)
  );
  const alerts = store.alerts.filter((a) => {
    if (filterDistrictId && filterDistrictId !== 'ALL' && a.districtId !== filterDistrictId) return false;
    if (filterLevel && a.distributionLevel && a.distributionLevel !== filterLevel) return false;
    return true;
  });

  // 1. Order Fulfilment Rate = sum(fulfilledQty) / sum(requestedQty) * 100
  const totalRequested = orders.reduce((s, o) => s + o.requestedQty, 0);
  const totalFulfilled = orders.reduce((s, o) => s + o.fulfilledQty, 0);
  const orderFulfilmentRate: KpiMetric =
    totalRequested > 0
      ? {
          key: 'order_fulfilment_rate',
          label: 'Order Fulfilment Rate',
          value: Number(((totalFulfilled / totalRequested) * 100).toFixed(1)),
          unit: '%',
          status: 'AVAILABLE',
          formula: '(SUM(fulfilled_qty) / SUM(requested_qty)) × 100',
          dataStatus: 'SIMULATED',
        }
      : {
          key: 'order_fulfilment_rate',
          label: 'Order Fulfilment Rate',
          value: null,
          unit: '%',
          status: 'UNAVAILABLE',
          unavailableReason: 'No orders recorded for selected scope.',
          formula: '(SUM(fulfilled_qty) / SUM(requested_qty)) × 100',
          dataStatus: 'SIMULATED',
        };

  // 2. Average Delivery Time (minutes) across completed/measured orders & active shipments
  const measuredMinutes = orders
    .filter((o) => o.actualMinutes !== null)
    .map((o) => o.actualMinutes as number);
  const avgDeliveryTime: KpiMetric =
    measuredMinutes.length > 0
      ? {
          key: 'avg_delivery_time',
          label: 'Average Delivery Time',
          value: Math.round(measuredMinutes.reduce((a, b) => a + b, 0) / measuredMinutes.length),
          unit: 'min',
          status: 'AVAILABLE',
          formula: 'AVG(actual_delivery_minutes) across measured orders',
          dataStatus: 'SIMULATED',
        }
      : {
          key: 'avg_delivery_time',
          label: 'Average Delivery Time',
          value: null,
          unit: 'min',
          status: 'UNAVAILABLE',
          unavailableReason: 'No completed delivery timestamps in selected scope.',
          formula: 'AVG(actual_delivery_minutes) across measured orders',
          dataStatus: 'SIMULATED',
        };

  // 3. Stockout Rate = count(available <= safetyStock) / count(inventory records) * 100
  const stockoutCount = invRows.filter((i) => i.availableQty <= i.safetyStock).length;
  const stockoutRate: KpiMetric =
    invRows.length > 0
      ? {
          key: 'stockout_rate',
          label: 'Stockout Risk Rate',
          value: Number(((stockoutCount / invRows.length) * 100).toFixed(1)),
          unit: '%',
          status: 'AVAILABLE',
          formula: '(COUNT(available_qty <= safety_stock) / COUNT(inventory_skus)) × 100',
          dataStatus: 'SIMULATED',
        }
      : {
          key: 'stockout_rate',
          label: 'Stockout Risk Rate',
          value: null,
          unit: '%',
          status: 'UNAVAILABLE',
          unavailableReason: 'No inventory records for selected scope.',
          formula: '(COUNT(available_qty <= safety_stock) / COUNT(inventory_skus)) × 100',
          dataStatus: 'SIMULATED',
        };

  // 4. Inventory Turnover = Annualized COGS/Demand Units / Current Average Inventory Units
  const totalStockUnits = invRows.reduce((s, i) => s + i.availableQty, 0);
  const dailyDemandSum = invRows.reduce((s, i) => {
    const avg = i.dailyDemandHistory.length
      ? i.dailyDemandHistory.reduce((a, b) => a + b, 0) / i.dailyDemandHistory.length
      : 0;
    return s + avg;
  }, 0);
  const inventoryTurnover: KpiMetric =
    totalStockUnits > 0 && dailyDemandSum > 0
      ? {
          key: 'inventory_turnover',
          label: 'Annualized Inventory Turnover',
          value: Number(((dailyDemandSum * 365) / totalStockUnits).toFixed(2)),
          unit: 'x/yr',
          status: 'AVAILABLE',
          formula: '(SUM(avg_daily_consumption) × 365) / SUM(available_units)',
          dataStatus: 'SIMULATED',
        }
      : {
          key: 'inventory_turnover',
          label: 'Annualized Inventory Turnover',
          value: null,
          unit: 'x/yr',
          status: 'UNAVAILABLE',
          unavailableReason: 'Requires both active inventory and consumption history.',
          formula: '(SUM(avg_daily_consumption) × 365) / SUM(available_units)',
          dataStatus: 'SIMULATED',
        };

  // 5. Excess Inventory Percentage
  const excessUnits = invRows.reduce(
    (s, i) => s + Math.max(0, i.availableQty - i.reorderLevel * 2),
    0
  );
  const excessPct: KpiMetric =
    totalStockUnits > 0
      ? {
          key: 'excess_inventory_pct',
          label: 'Excess Inventory Percentage',
          value: Number(((excessUnits / totalStockUnits) * 100).toFixed(1)),
          unit: '%',
          status: 'AVAILABLE',
          formula: '(SUM(MAX(0, available_qty - 2 × reorder_level)) / SUM(available_qty)) × 100',
          dataStatus: 'SIMULATED',
        }
      : {
          key: 'excess_inventory_pct',
          label: 'Excess Inventory Percentage',
          value: null,
          unit: '%',
          status: 'UNAVAILABLE',
          unavailableReason: 'Zero inventory units in scope.',
          formula: '(SUM(MAX(0, available_qty - 2 × reorder_level)) / SUM(available_qty)) × 100',
          dataStatus: 'SIMULATED',
        };

  // 6. Expiry Loss Risk Percentage (batches <= 65 days projected unconsumed before expiry)
  const refNow = Date.parse('2026-11-12T12:00:00Z');
  let atRiskUnits = 0;
  for (const inv of invRows) {
    const daysLeft = Math.max(0, Math.round((Date.parse(inv.expiryDate) - refNow) / 86400000));
    if (daysLeft <= 65) {
      const avgDaily = inv.dailyDemandHistory.length
        ? inv.dailyDemandHistory.reduce((a, b) => a + b, 0) / inv.dailyDemandHistory.length
        : 0;
      const projectedConsumed = avgDaily * daysLeft;
      atRiskUnits += Math.max(0, inv.availableQty - projectedConsumed);
    }
  }
  const expiryLossPct: KpiMetric =
    totalStockUnits > 0
      ? {
          key: 'expiry_loss_pct',
          label: 'Projected Expiry Risk Percentage',
          value: Number(((atRiskUnits / totalStockUnits) * 100).toFixed(2)),
          unit: '%',
          status: 'AVAILABLE',
          formula: '(SUM(unconsumed_units_within_65d_expiry) / SUM(available_qty)) × 100',
          dataStatus: 'SIMULATED',
        }
      : {
          key: 'expiry_loss_pct',
          label: 'Projected Expiry Risk Percentage',
          value: null,
          unit: '%',
          status: 'UNAVAILABLE',
          unavailableReason: 'No batch inventory in scope.',
          formula: '(SUM(unconsumed_units_within_65d_expiry) / SUM(available_qty)) × 100',
          dataStatus: 'SIMULATED',
        };

  // 7. On-Time Delivery Percentage
  const measuredDeliveries = orders.filter((o) => o.actualMinutes !== null);
  const onTimeOrders = measuredDeliveries.filter((o) => (o.actualMinutes ?? 9999) <= o.promisedMinutes);
  const onTimeShipmentCount = shipments.filter((s) => s.delayMinutes <= 15).length;
  const totalTransitMeasured = measuredDeliveries.length + shipments.length;
  const onTimeDeliveryPct: KpiMetric =
    totalTransitMeasured > 0
      ? {
          key: 'on_time_delivery_pct',
          label: 'On-Time Delivery Percentage',
          value: Number(
            (((onTimeOrders.length + onTimeShipmentCount) / totalTransitMeasured) * 100).toFixed(1)
          ),
          unit: '%',
          status: 'AVAILABLE',
          formula: '(COUNT(on_time_orders_and_shipments) / COUNT(measured_transits)) × 100',
          dataStatus: 'SIMULATED',
        }
      : {
          key: 'on_time_delivery_pct',
          label: 'On-Time Delivery Percentage',
          value: null,
          unit: '%',
          status: 'UNAVAILABLE',
          unavailableReason: 'No measured orders or shipments in selected scope.',
          formula: '(COUNT(on_time_orders_and_shipments) / COUNT(measured_transits)) × 100',
          dataStatus: 'SIMULATED',
        };

  // 8. Average Incident Resolution Time
  const resolvedAlerts = alerts.filter((a) => a.resolvedAt !== null);
  const avgResolutionMin: KpiMetric =
    resolvedAlerts.length > 0
      ? {
          key: 'avg_incident_resolution_time',
          label: 'Average Incident Resolution Time',
          value: Math.round(
            resolvedAlerts.reduce(
              (sum, a) => sum + Math.max(1, (Date.parse(a.resolvedAt!) - Date.parse(a.createdAt)) / 60000),
              0
            ) / resolvedAlerts.length
          ),
          unit: 'min',
          status: 'AVAILABLE',
          formula: 'AVG(resolved_at - created_at) in minutes for resolved incidents',
          dataStatus: 'SIMULATED',
        }
      : {
          key: 'avg_incident_resolution_time',
          label: 'Average Incident Resolution Time',
          value: null,
          unit: 'min',
          status: 'UNAVAILABLE',
          unavailableReason: 'No resolved incidents recorded yet in current operational window.',
          formula: 'AVG(resolved_at - created_at) in minutes for resolved incidents',
          dataStatus: 'SIMULATED',
        };

  return [
    orderFulfilmentRate,
    avgDeliveryTime,
    stockoutRate,
    inventoryTurnover,
    excessPct,
    expiryLossPct,
    onTimeDeliveryPct,
    avgResolutionMin,
  ];
}

export function registerReportingAgentRoutes(router: Router) {
  router.get('/reports/state', async (req: RequestWithAuth, res) => {
    const kpis = calculateKpis();
    const openIncidents = store.alerts.filter((a) => a.status !== 'RESOLVED').length;
    const activeShipments = store.shipments.filter((s) => s.status !== 'DELIVERED').length;
    const totalAvailableUnits = store.inventory.reduce((s, i) => s + i.availableQty, 0);

    const stockoutKpi = kpis.find((k) => k.key === 'stockout_rate');
    if (stockoutKpi?.value !== null && stockoutKpi && stockoutKpi.value >= 25) {
      await eventBus.publish({
        event_type: 'PERFORMANCE_THRESHOLD_BREACHED',
        source_agent: 'REPORTING_ANALYTICS_AGENT',
        district_id: 'mp-bhopal',
        entity_id: 'state-mp-stockout',
        priority: 'HIGH',
        data_status: 'SIMULATED',
        payload: { kpi: stockoutKpi.label, value: stockoutKpi.value, threshold: 25 },
        dedupeWindowMs: 30000,
      });
    }

    await eventBus.publish({
      event_type: 'REPORT_GENERATED',
      source_agent: 'REPORTING_ANALYTICS_AGENT',
      district_id: 'mp-bhopal',
      entity_id: 'mp-state-report',
      priority: 'LOW',
      data_status: 'SIMULATED',
      payload: {
        scope: 'Madhya Pradesh State-Wide',
        kpiCount: kpis.length,
      },
      dedupeWindowMs: 25000,
    });

    res.json({
      scope: 'Madhya Pradesh State-Wide',
      requestedByRole: req.authContext?.role ?? 'STATE_ADMIN',
      generatedAt: new Date().toISOString(),
      summary: {
        totalNodes: store.nodes.length,
        totalDistrictsTracked: store.districts.length,
        totalAvailableUnits,
        activeShipments,
        openIncidents,
        pendingApprovals: store.approvals.filter((a) => a.status === 'PENDING').length,
      },
      kpis,
      bottlenecks: store.disruptions
        .filter((d) => d.active)
        .map((d) => ({
          id: d.id,
          corridor: d.roadName,
          districtId: d.districtId,
          delayImpactMinutes: d.delayImpactMinutes,
          severity: d.severity,
        })),
    });
  });

  router.get('/reports/districts', async (_req, res) => {
    const districts = store.districts.map((d) => {
      const nodesInDist = store.nodes.filter((n) => n.districtId === d.id);
      const nodeIds = new Set(nodesInDist.map((n) => n.id));
      const inv = store.inventory.filter((i) => nodeIds.has(i.nodeId));
      const availableUnits = inv.reduce((s, i) => s + i.availableQty, 0);
      const shortages = inv.filter((i) => i.availableQty <= i.safetyStock).length;
      const openAlerts = store.alerts.filter((a) => a.districtId === d.id && a.status !== 'RESOLVED').length;
      const kpis = calculateKpis(d.id);
      const fulfilment = kpis.find((k) => k.key === 'order_fulfilment_rate');

      return {
        districtId: d.id,
        districtName: d.name,
        division: d.division,
        lat: d.lat,
        lng: d.lng,
        nodeCount: nodesInDist.length,
        availableUnits: nodesInDist.length > 0 ? availableUnits : null,
        shortageSkuCount: nodesInDist.length > 0 ? shortages : null,
        openAlertCount: openAlerts,
        fulfilmentRatePct: fulfilment?.value ?? null,
        dataStatus: nodesInDist.length > 0 ? 'SIMULATED' : 'UNVERIFIED',
      };
    });

    const flaggedDistrict = districts.find((d) => (d.shortageSkuCount ?? 0) > 0);
    if (flaggedDistrict) {
      await eventBus.publish({
        event_type: 'DISTRICT_TREND_IDENTIFIED',
        source_agent: 'REPORTING_ANALYTICS_AGENT',
        district_id: flaggedDistrict.districtId,
        entity_id: flaggedDistrict.districtId,
        priority: 'MEDIUM',
        data_status: 'SIMULATED',
        payload: {
          districtName: flaggedDistrict.districtName,
          shortageSkuCount: flaggedDistrict.shortageSkuCount,
        },
        dedupeWindowMs: 30000,
      });
    }

    res.json({ districts });
  });

  router.get('/reports/levels-matrix', (_req, res) => {
    const levels: DistributionLevel[] = [
      'MANUFACTURER',
      'CNF_AGENT',
      'SUPER_STOCKIST',
      'WHOLESALER',
      'LOCAL_DISTRIBUTOR',
      'RETAIL_PHARMACY',
      'HOSPITAL_PHARMACY',
    ];

    const matrix = levels.map((lvl) => {
      const nodes = store.nodes.filter((n) => n.level === lvl);
      const nodeIds = new Set(nodes.map((n) => n.id));
      const inv = store.inventory.filter((i) => nodeIds.has(i.nodeId));
      const orders = store.orders.filter(
        (o) => nodeIds.has(o.requestingNodeId) || nodeIds.has(o.supplyingNodeId)
      );
      const shipments = store.shipments.filter(
        (s) => nodeIds.has(s.originNodeId) || nodeIds.has(s.destinationNodeId)
      );
      const kpis = calculateKpis(undefined, lvl);
      const fulfilment = kpis.find((k) => k.key === 'order_fulfilment_rate');
      const onTime = kpis.find((k) => k.key === 'on_time_delivery_pct');
      const needProfile = store.levelNeeds.find((n) => n.level === lvl);

      const totalCapacityUnits = nodes.reduce((s, n) => s + n.capacityUnits, 0);
      const availableStockUnits = inv.reduce((s, i) => s + i.availableQty, 0);
      const reservedUnits = inv.reduce((s, i) => s + i.reservedQty, 0);
      const incomingUnits = inv.reduce((s, i) => s + i.incomingQty, 0);
      const outgoingUnits = inv.reduce((s, i) => s + i.outgoingQty, 0);
      const shortageSkuCount = inv.filter((i) => i.availableQty <= i.reorderLevel).length;
      const openIncidentCount = store.alerts.filter(
        (a) => a.status !== 'RESOLVED' && (a.distributionLevel === lvl || (a.nodeId && nodeIds.has(a.nodeId)))
      ).length;

      return {
        level: lvl,
        label: needProfile?.label ?? lvl.replace(/_/g, ' '),
        nodeCount: nodes.length,
        totalCapacityUnits,
        availableStockUnits,
        reservedUnits,
        incomingUnits,
        outgoingUnits,
        capacityUtilizationPct:
          totalCapacityUnits > 0 ? Number(((availableStockUnits / totalCapacityUnits) * 100).toFixed(1)) : 0,
        shortageSkuCount,
        openIncidentCount,
        activeShipmentCount: shipments.filter((s) => s.status !== 'DELIVERED').length,
        orderCount: orders.length,
        fulfilmentRatePct: fulfilment?.value ?? null,
        onTimeDeliveryPct: onTime?.value ?? null,
        primaryAddress: nodes[0]?.fullAddress ?? 'Madhya Pradesh Network',
        pinCode: nodes[0]?.pinCode ?? '',
        needProfile: needProfile ?? null,
        dataStatus: 'SIMULATED' as const,
      };
    });

    res.json({ levels: matrix, generatedAt: new Date().toISOString() });
  });

  router.get('/reports/distribution-level', (req, res) => {
    const level = (req.query.level as DistributionLevel | undefined) || 'RETAIL_PHARMACY';
    const kpis = calculateKpis(undefined, level);
    const nodes = store.nodes.filter((n) => n.level === level);
    res.json({
      level,
      nodeCount: nodes.length,
      nodes,
      kpis,
      needProfile: store.levelNeeds.find((n) => n.level === level) ?? null,
      generatedAt: new Date().toISOString(),
    });
  });

  router.get('/reports/performance', (req, res) => {
    const { period = 'weekly', districtId, level } = req.query as {
      period?: 'daily' | 'weekly' | 'monthly';
      districtId?: string;
      level?: DistributionLevel;
    };
    const kpis = calculateKpis(districtId, level);
    res.json({
      period,
      districtId: districtId ?? 'ALL',
      level: level ?? 'ALL',
      kpis,
      generatedAt: new Date().toISOString(),
    });
  });

  router.get('/reports/inventory-trends', (req, res) => {
    const { period = 'daily' } = req.query as { period?: 'daily' | 'weekly' | 'monthly' };
    // Aggregate real 14-day demand history stored on inventory records
    const days = 14;
    const dailySeries = Array.from({ length: days }, (_, idx) => {
      const demandUnits = store.inventory.reduce(
        (sum, inv) => sum + (inv.dailyDemandHistory[idx] ?? 0),
        0
      );
      // Approximate available supply curve backwards from current total
      const currentTotal = store.inventory.reduce((s, i) => s + i.availableQty, 0);
      const remainingDays = days - 1 - idx;
      const estimatedSupply = Math.max(0, currentTotal + remainingDays * 420);
      return {
        label: period === 'monthly' ? `M-${Math.ceil((days - idx) / 4)}` : period === 'weekly' ? `W-${Math.ceil((days - idx) / 3)}` : `Day ${idx + 1}`,
        demandUnits,
        availableSupplyUnits: estimatedSupply,
      };
    });

    res.json({
      period,
      series: dailySeries,
      dataStatus: 'SIMULATED',
      source: 'Aggregated from MP Inventory 14-day Consumption History',
    });
  });

  router.get('/reports/incidents', (_req, res) => {
    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const a of store.alerts) {
      byCategory[a.rootCauseCategory] = (byCategory[a.rootCauseCategory] ?? 0) + 1;
      bySeverity[a.severity] = (bySeverity[a.severity] ?? 0) + 1;
    }
    res.json({
      totalIncidents: store.alerts.length,
      openIncidents: store.alerts.filter((a) => a.status !== 'RESOLVED').length,
      resolvedIncidents: store.alerts.filter((a) => a.status === 'RESOLVED').length,
      escalatedIncidents: store.alerts.filter((a) => a.escalated).length,
      byCategory,
      bySeverity,
    });
  });
}
