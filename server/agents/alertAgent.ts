import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { eventBus } from '../eventBus.ts';
import { RequestWithAuth } from '../middleware/auth.ts';
import { store } from '../store.ts';
import { AlertIncident, RootCauseCategory, Severity } from '../types.ts';

let subscriptionsRegistered = false;

export function registerAlertAgentSubscriptions() {
  if (subscriptionsRegistered) return;
  subscriptionsRegistered = true;

  eventBus.subscribe('STOCK_SHORTAGE_DETECTED', async (ev) => {
    const existing = store.alerts.find(
      (a) => a.relatedEntityId === ev.entity_id && a.status !== 'RESOLVED'
    );
    if (existing) return;

    const payload = ev.payload as {
      nodeName?: string;
      nodeLevel?: string;
      medicineBrand?: string;
      availableQty?: number;
      safetyStock?: number;
    };

    const incident: AlertIncident = {
      id: `inc-${uuidv4().slice(0, 6)}`,
      incidentCode: `INC-MP-${Math.floor(1000 + Math.random() * 9000)}`,
      title: `Stockout Alert: ${payload.medicineBrand ?? 'Medicine'} at ${payload.nodeName ?? 'MP Node'}`,
      severity: ev.priority,
      status: 'OPEN',
      rootCauseCategory: 'DEMAND_RELATED',
      causeCertainty: 'PROBABLE',
      rootCauseSummary: `Probable demand surge or delayed replenishment: stock fell to ${payload.availableQty ?? 0} units (safety threshold ${payload.safetyStock ?? 0}).`,
      districtId: ev.district_id,
      nodeId: ev.distribution_node_id,
      distributionLevel: (payload.nodeLevel as AlertIncident['distributionLevel']) ?? null,
      relatedEntityId: ev.entity_id,
      evidence: [
        `Triggered by Supply Agent event ${ev.event_id.slice(0, 8)}`,
        `Available stock (${payload.availableQty ?? 0}) below safety stock (${payload.safetyStock ?? 0})`,
      ],
      recommendations: [
        {
          title: 'Review Eligible MP Redistribution Recommendation',
          evidence: 'Supply Agent evaluated neighboring nodes with surplus stock.',
          expectedBenefit: 'Prevents patient-facing stockout at affected pharmacy.',
          estimatedTimeMinutes: 120,
          estimatedCostInr: 1500,
          riskNote: 'Requires authorized human approval before stock transfer.',
          requiresApproval: true,
        },
      ],
      assignedTo: null,
      escalated: ev.priority === 'CRITICAL',
      createdAt: new Date().toISOString(),
      acknowledgedAt: null,
      resolvedAt: null,
      resolutionNotes: null,
      dataStatus: ev.data_status,
      source: 'Alert Agent (via EventBus STOCK_SHORTAGE_DETECTED)',
    };

    store.alerts.unshift(incident);

    await eventBus.publish({
      event_type: 'INCIDENT_DETECTED',
      source_agent: 'ALERT_RESOLUTION_AGENT',
      district_id: incident.districtId,
      distribution_node_id: incident.nodeId,
      entity_id: incident.id,
      priority: incident.severity,
      data_status: incident.dataStatus,
      payload: { incidentCode: incident.incidentCode, title: incident.title },
    });
  });

  eventBus.subscribe('ROUTE_DISRUPTION_DETECTED', async (ev) => {
    const payload = ev.payload as {
      roadName?: string;
      cause?: string;
      delayImpactMinutes?: number;
      impactedShipmentCount?: number;
    };

    const incident: AlertIncident = {
      id: `inc-${uuidv4().slice(0, 6)}`,
      incidentCode: `INC-MP-${Math.floor(1000 + Math.random() * 9000)}`,
      title: `Corridor Disruption: ${payload.roadName ?? 'MP Highway'}`,
      severity: ev.priority,
      status: 'OPEN',
      rootCauseCategory: 'TRANSPORTATION_DISRUPTION',
      causeCertainty: ev.data_status === 'VERIFIED' ? 'CONFIRMED' : 'SUSPECTED',
      rootCauseSummary: `${ev.data_status === 'VERIFIED' ? 'Confirmed' : 'Suspected (operator-reported)'} highway disruption (${payload.cause ?? 'Transit delay'}) adding ~${payload.delayImpactMinutes ?? 45} min across ${payload.impactedShipmentCount ?? 0} shipments.`,
      districtId: ev.district_id,
      nodeId: ev.distribution_node_id,
      distributionLevel: null,
      relatedEntityId: ev.entity_id,
      evidence: [
        `Road segment: ${payload.roadName ?? 'Unknown'}`,
        `Estimated delay impact: ${payload.delayImpactMinutes ?? 0} minutes`,
        `Data status: ${ev.data_status}`,
      ],
      recommendations: [
        {
          title: 'Optimize & Reroute Impacted Shipments',
          evidence: 'Route Agent can evaluate alternative MP highway corridors.',
          expectedBenefit: 'Mitigates cold-chain excursion and stockout risk.',
          estimatedTimeMinutes: 30,
          estimatedCostInr: 900,
          riskNote: 'Verify vehicle fuel & cold-chain holdover capacity.',
          requiresApproval: true,
        },
      ],
      assignedTo: null,
      escalated: ev.priority === 'CRITICAL',
      createdAt: new Date().toISOString(),
      acknowledgedAt: null,
      resolvedAt: null,
      resolutionNotes: null,
      dataStatus: ev.data_status,
      source: 'Alert Agent (via EventBus ROUTE_DISRUPTION_DETECTED)',
    };
    store.alerts.unshift(incident);
  });

  eventBus.subscribe('EXPIRY_RISK_DETECTED', async (ev) => {
    const existing = store.alerts.find(
      (a) => a.relatedEntityId === ev.entity_id && a.status !== 'RESOLVED'
    );
    if (existing) return;
    const payload = ev.payload as {
      nodeName?: string;
      medicineBrand?: string;
      batchNumber?: string;
      expiryDate?: string;
      daysToExpiry?: number;
    };
    store.alerts.unshift({
      id: `inc-${uuidv4().slice(0, 6)}`,
      incidentCode: `INC-MP-${Math.floor(1000 + Math.random() * 9000)}`,
      title: `Expiry Risk: ${payload.medicineBrand ?? 'Batch'} (${payload.batchNumber ?? ''}) at ${payload.nodeName ?? 'MP Node'}`,
      severity: ev.priority,
      status: 'OPEN',
      rootCauseCategory: 'INVENTORY_MANAGEMENT',
      causeCertainty: 'CONFIRMED',
      rootCauseSummary: `Confirmed short shelf-life: batch expires on ${payload.expiryDate ?? 'N/A'} (${payload.daysToExpiry ?? '--'} days remaining).`,
      districtId: ev.district_id,
      nodeId: ev.distribution_node_id,
      distributionLevel: null,
      relatedEntityId: ev.entity_id,
      evidence: [`Batch ${payload.batchNumber ?? ''} expires ${payload.expiryDate ?? ''}`],
      recommendations: [
        {
          title: 'Prioritize FEFO Dispatch or Cross-Node Transfer',
          evidence: 'Consumption velocity trails remaining shelf life.',
          expectedBenefit: 'Prevents batch write-off.',
          estimatedTimeMinutes: 120,
          estimatedCostInr: 750,
          riskNote: 'Requires human authorization and cold-chain check if applicable.',
          requiresApproval: true,
        },
      ],
      assignedTo: null,
      escalated: false,
      createdAt: new Date().toISOString(),
      acknowledgedAt: null,
      resolvedAt: null,
      resolutionNotes: null,
      dataStatus: ev.data_status,
      source: 'Alert Agent (via EventBus EXPIRY_RISK_DETECTED)',
    });
  });

  eventBus.subscribe('SHIPMENT_DELAY_PREDICTED', async (ev) => {
    const payload = ev.payload as {
      shipmentCode?: string;
      delayMinutes?: number;
      estimatedMinutes?: number;
    };
    const existing = store.alerts.find(
      (a) => a.relatedEntityId === ev.entity_id && a.status !== 'RESOLVED'
    );
    if (existing) return;
    store.alerts.unshift({
      id: `inc-${uuidv4().slice(0, 6)}`,
      incidentCode: `INC-MP-${Math.floor(1000 + Math.random() * 9000)}`,
      title: `Shipment Delay Predicted: ${payload.shipmentCode ?? ev.entity_id}`,
      severity: ev.priority,
      status: 'OPEN',
      rootCauseCategory: 'TRANSPORTATION_DISRUPTION',
      causeCertainty: 'PROBABLE',
      rootCauseSummary: `Predicted +${payload.delayMinutes ?? 0} min transit delay (ETA ${payload.estimatedMinutes ?? '--'} min) affecting downstream stock replenishment.`,
      districtId: ev.district_id,
      nodeId: ev.distribution_node_id,
      distributionLevel: null,
      relatedEntityId: ev.entity_id,
      evidence: [`Route Agent reported +${payload.delayMinutes ?? 0} min delay on ${payload.shipmentCode ?? ev.entity_id}`],
      recommendations: [
        {
          title: 'Evaluate Alternative Corridor in Route & Logistics Agent',
          evidence: 'Corridor disruption active along primary path.',
          expectedBenefit: 'Recovers transit time and safeguards cold-chain window.',
          estimatedTimeMinutes: 25,
          estimatedCostInr: 800,
          riskNote: 'Requires dispatcher approval.',
          requiresApproval: true,
        },
      ],
      assignedTo: null,
      escalated: false,
      createdAt: new Date().toISOString(),
      acknowledgedAt: null,
      resolvedAt: null,
      resolutionNotes: null,
      dataStatus: ev.data_status,
      source: 'Alert Agent (via EventBus SHIPMENT_DELAY_PREDICTED)',
    });
  });

  eventBus.subscribe('PERFORMANCE_THRESHOLD_BREACHED', async (ev) => {
    const existing = store.alerts.find(
      (a) => a.relatedEntityId === ev.entity_id && a.status !== 'RESOLVED'
    );
    if (existing) return;
    const payload = ev.payload as { kpi?: string; value?: number; threshold?: number };
    store.alerts.unshift({
      id: `inc-${uuidv4().slice(0, 6)}`,
      incidentCode: `INC-MP-${Math.floor(1000 + Math.random() * 9000)}`,
      title: `KPI Threshold Breached: ${payload.kpi ?? 'State Metric'} (${payload.value ?? '--'}% >= ${payload.threshold ?? '--'}%)`,
      severity: ev.priority,
      status: 'OPEN',
      rootCauseCategory: 'DISTRIBUTION_BOTTLENECK',
      causeCertainty: 'CONFIRMED',
      rootCauseSummary: `Confirmed by Reporting & Analytics Agent: ${payload.kpi ?? 'metric'} reached ${payload.value ?? '--'}%, exceeding threshold ${payload.threshold ?? '--'}%.`,
      districtId: ev.district_id,
      nodeId: ev.distribution_node_id,
      distributionLevel: null,
      relatedEntityId: ev.entity_id,
      evidence: [`Reporting Agent threshold monitor event ${ev.event_id.slice(0, 8)}`],
      recommendations: [
        {
          title: 'Inspect Shortage SKUs & Approve Pending Transfers',
          evidence: 'Statewide stockout risk exceeds operational limit.',
          expectedBenefit: 'Reduces state stockout exposure.',
          estimatedTimeMinutes: 90,
          estimatedCostInr: 1800,
          riskNote: 'Requires human approval for all inter-node transfers.',
          requiresApproval: true,
        },
      ],
      assignedTo: null,
      escalated: false,
      createdAt: new Date().toISOString(),
      acknowledgedAt: null,
      resolvedAt: null,
      resolutionNotes: null,
      dataStatus: ev.data_status,
      source: 'Alert Agent (via EventBus PERFORMANCE_THRESHOLD_BREACHED)',
    });
  });
}

export function registerAlertAgentRoutes(router: Router) {
  registerAlertAgentSubscriptions();

  router.get('/alerts', (req, res) => {
    const { severity, status, districtId } = req.query as {
      severity?: Severity;
      status?: string;
      districtId?: string;
    };
    let alerts = [...store.alerts];
    if (severity && severity !== ('ALL' as string)) {
      alerts = alerts.filter((a) => a.severity === severity);
    }
    if (status && status !== 'ALL') {
      alerts = alerts.filter((a) => a.status === status);
    }
    if (districtId && districtId !== 'ALL') {
      alerts = alerts.filter((a) => a.districtId === districtId);
    }
    res.json({ alerts });
  });

  router.get('/alerts/:id', (req, res) => {
    const alert = store.alerts.find((a) => a.id === req.params.id);
    if (!alert) return res.status(404).json({ error: 'Incident not found.' });
    res.json({ alert });
  });

  router.post('/alerts/:id/investigate', async (req: RequestWithAuth, res) => {
    const alert = store.alerts.find((a) => a.id === req.params.id);
    if (!alert) return res.status(404).json({ error: 'Incident not found.' });
    const { rootCauseCategory, causeCertainty, rootCauseSummary } = req.body as {
      rootCauseCategory?: RootCauseCategory;
      causeCertainty?: 'CONFIRMED' | 'PROBABLE' | 'SUSPECTED';
      rootCauseSummary?: string;
    };
    if (rootCauseCategory) alert.rootCauseCategory = rootCauseCategory;
    if (causeCertainty) alert.causeCertainty = causeCertainty;
    if (rootCauseSummary && rootCauseSummary.trim()) alert.rootCauseSummary = rootCauseSummary.trim();
    if (alert.status === 'OPEN' || alert.status === 'ACKNOWLEDGED') {
      alert.status = 'INVESTIGATING';
    }

    await eventBus.publish({
      event_type: 'ROOT_CAUSE_UPDATED',
      source_agent: 'ALERT_RESOLUTION_AGENT',
      district_id: alert.districtId,
      distribution_node_id: alert.nodeId,
      entity_id: alert.id,
      priority: alert.severity,
      data_status: alert.dataStatus,
      payload: {
        incidentCode: alert.incidentCode,
        rootCauseCategory: alert.rootCauseCategory,
        causeCertainty: alert.causeCertainty,
      },
    });

    await eventBus.publish({
      event_type: 'RESOLUTION_RECOMMENDED',
      source_agent: 'ALERT_RESOLUTION_AGENT',
      district_id: alert.districtId,
      distribution_node_id: alert.nodeId,
      entity_id: alert.id,
      priority: alert.severity,
      data_status: alert.dataStatus,
      requires_approval: true,
      payload: {
        incidentCode: alert.incidentCode,
        recommendationCount: alert.recommendations.length,
      },
    });

    store.addAuditLog({
      actorId: req.authContext?.email ?? req.authContext?.uid ?? 'operator',
      actorRole: req.authContext?.role ?? 'STATE_ADMIN',
      action: 'ROOT_CAUSE_UPDATED',
      entityType: 'AlertIncident',
      entityId: alert.id,
      details: `${alert.incidentCode} classified as ${alert.causeCertainty} ${alert.rootCauseCategory}.`,
    });

    res.json({ alert });
  });

  router.post('/alerts/:id/acknowledge', async (req: RequestWithAuth, res) => {
    const alert = store.alerts.find((a) => a.id === req.params.id);
    if (!alert) return res.status(404).json({ error: 'Incident not found.' });
    alert.status = 'ACKNOWLEDGED';
    alert.acknowledgedAt = new Date().toISOString();
    const actor = req.authContext?.email ?? req.authContext?.uid ?? 'operator';
    store.addAuditLog({
      actorId: actor,
      actorRole: req.authContext?.role ?? 'STATE_ADMIN',
      action: 'INCIDENT_ACKNOWLEDGED',
      entityType: 'AlertIncident',
      entityId: alert.id,
      details: `Acknowledged ${alert.incidentCode}.`,
    });
    res.json({ alert });
  });

  router.post('/alerts/:id/assign', async (req: RequestWithAuth, res) => {
    const alert = store.alerts.find((a) => a.id === req.params.id);
    if (!alert) return res.status(404).json({ error: 'Incident not found.' });
    const { assignee, escalate } = req.body as { assignee?: string; escalate?: boolean };
    if (assignee) alert.assignedTo = assignee;
    if (escalate) {
      alert.escalated = true;
      alert.status = 'ESCALATED';
      await eventBus.publish({
        event_type: 'INCIDENT_ESCALATED',
        source_agent: 'ALERT_RESOLUTION_AGENT',
        district_id: alert.districtId,
        distribution_node_id: alert.nodeId,
        entity_id: alert.id,
        priority: 'CRITICAL',
        data_status: alert.dataStatus,
        payload: { incidentCode: alert.incidentCode, assignedTo: alert.assignedTo },
      });
    } else if (alert.status === 'OPEN') {
      alert.status = 'INVESTIGATING';
    }
    res.json({ alert });
  });

  router.post('/alerts/:id/resolve', async (req: RequestWithAuth, res) => {
    const alert = store.alerts.find((a) => a.id === req.params.id);
    if (!alert) return res.status(404).json({ error: 'Incident not found.' });
    const { resolutionNotes } = req.body as { resolutionNotes?: string };
    alert.status = 'RESOLVED';
    alert.resolvedAt = new Date().toISOString();
    alert.resolutionNotes = resolutionNotes ?? 'Resolved after human verification and corrective dispatch.';

    await eventBus.publish({
      event_type: 'INCIDENT_RESOLVED',
      source_agent: 'ALERT_RESOLUTION_AGENT',
      district_id: alert.districtId,
      distribution_node_id: alert.nodeId,
      entity_id: alert.id,
      priority: alert.severity,
      data_status: alert.dataStatus,
      payload: { incidentCode: alert.incidentCode, resolutionNotes: alert.resolutionNotes },
    });

    store.addAuditLog({
      actorId: req.authContext?.email ?? req.authContext?.uid ?? 'operator',
      actorRole: req.authContext?.role ?? 'STATE_ADMIN',
      action: 'INCIDENT_RESOLVED',
      entityType: 'AlertIncident',
      entityId: alert.id,
      details: `${alert.incidentCode} resolved: ${alert.resolutionNotes}`,
    });

    res.json({ alert });
  });

  router.get('/incidents/root-causes', (_req, res) => {
    const categories: RootCauseCategory[] = [
      'DEMAND_RELATED',
      'INVENTORY_MANAGEMENT',
      'TRANSPORTATION_DISRUPTION',
      'SUPPLIER_DELAY',
      'DELAYED_DISPATCH',
      'DISTRIBUTION_BOTTLENECK',
      'DATA_SHARING_FAILURE',
    ];
    const summary = categories.map((cat) => {
      const items = store.alerts.filter((a) => a.rootCauseCategory === cat);
      return {
        category: cat,
        count: items.length,
        confirmedCount: items.filter((i) => i.causeCertainty === 'CONFIRMED').length,
        probableCount: items.filter((i) => i.causeCertainty === 'PROBABLE').length,
        suspectedCount: items.filter((i) => i.causeCertainty === 'SUSPECTED').length,
      };
    });
    res.json({ rootCauses: summary });
  });

  router.get('/incidents/resolution-times', (_req, res) => {
    const resolved = store.alerts.filter((a) => a.resolvedAt !== null);
    const avgMinutes =
      resolved.length > 0
        ? Math.round(
            resolved.reduce(
              (sum, a) => sum + Math.max(1, (Date.parse(a.resolvedAt!) - Date.parse(a.createdAt)) / 60000),
              0
            ) / resolved.length
          )
        : null;
    res.json({
      resolvedCount: resolved.length,
      openCount: store.alerts.length - resolved.length,
      averageResolutionMinutes: avgMinutes,
      status: avgMinutes === null ? 'UNAVAILABLE' : 'AVAILABLE',
      reason: avgMinutes === null ? 'No resolved incidents recorded yet.' : undefined,
    });
  });

  router.get('/incidents/recommendations', (_req, res) => {
    const list = store.alerts
      .filter((a) => a.status !== 'RESOLVED')
      .flatMap((a) =>
        a.recommendations.map((rec) => ({
          incidentId: a.id,
          incidentCode: a.incidentCode,
          severity: a.severity,
          districtId: a.districtId,
          ...rec,
        }))
      );
    res.json({ recommendations: list });
  });
}
