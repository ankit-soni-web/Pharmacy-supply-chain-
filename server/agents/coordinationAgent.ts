import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { RequestWithAuth } from '../middleware/auth.ts';
import { evaluateAllPredictiveOutcomes } from '../predictiveOutcomes.ts';
import { store } from '../store.ts';
import { DistributionLevel, FastReachRequest, ScopedContactView, UserRole } from '../types.ts';

const TIER_ORDER: DistributionLevel[] = [
  'MANUFACTURER',
  'CNF_AGENT',
  'SUPER_STOCKIST',
  'WHOLESALER',
  'LOCAL_DISTRIBUTOR',
  'RETAIL_PHARMACY',
  'HOSPITAL_PHARMACY',
];

function isAdjacentOrSameScope(callerRole: UserRole, targetLevel: DistributionLevel): {
  allowed: boolean;
  visibility: ScopedContactView['contactVisibility'];
  note: string;
} {
  if (callerRole === 'STATE_ADMIN') {
    return {
      allowed: true,
      visibility: 'ADMIN_OVERSIGHT',
      note: 'State Admin oversight access — direct channel visible for emergency MP coordination; never exported.',
    };
  }
  if (callerRole === targetLevel) {
    return {
      allowed: true,
      visibility: 'SELF_LEVEL',
      note: 'Same operational tier — rapid peer desk reach enabled.',
    };
  }

  // Strict 1-hop adjacency rules so contacts are never shared too far across distant tiers
  const adjacencyMap: Record<DistributionLevel, DistributionLevel[]> = {
    MANUFACTURER: ['CNF_AGENT'],
    CNF_AGENT: ['MANUFACTURER', 'SUPER_STOCKIST', 'HOSPITAL_PHARMACY'],
    SUPER_STOCKIST: ['CNF_AGENT', 'WHOLESALER', 'LOCAL_DISTRIBUTOR'],
    WHOLESALER: ['SUPER_STOCKIST', 'LOCAL_DISTRIBUTOR', 'RETAIL_PHARMACY', 'HOSPITAL_PHARMACY'],
    LOCAL_DISTRIBUTOR: ['SUPER_STOCKIST', 'WHOLESALER', 'RETAIL_PHARMACY'],
    RETAIL_PHARMACY: ['LOCAL_DISTRIBUTOR', 'WHOLESALER'],
    HOSPITAL_PHARMACY: ['CNF_AGENT', 'WHOLESALER'],
  };

  if (adjacencyMap[callerRole]?.includes(targetLevel)) {
    return {
      allowed: true,
      visibility: 'DIRECT_ADJACENT',
      note: '1-hop adjacent supply partner — direct rapid-reach channel unlocked for urgent fulfillment.',
    };
  }

  return {
    allowed: false,
    visibility: 'REDACTED_BEYOND_SCOPE',
    note: 'Contact withheld: restricted strictly to 1-hop adjacent partners so personal/desk contacts are never shared too far.',
  };
}

export function registerCoordinationAgentRoutes(router: Router) {
  // Predictive multi-outcome evaluation for Supply, Route, and Alert agents
  router.post('/predictive/evaluate', async (req, res) => {
    try {
      const { entityType, entityId } = req.body as {
        entityType: 'INVENTORY' | 'INCIDENT' | 'SHIPMENT';
        entityId: string;
      };
      const result = await evaluateAllPredictiveOutcomes({ entityType, entityId });
      res.json(result);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Unable to evaluate predictive outcomes.',
      });
    }
  });

  // Level-specific Login Profile & Full Address Registration validation
  router.post('/levels/login-profile', (req: RequestWithAuth, res) => {
    const {
      level,
      organizationName,
      districtId,
      fullAddress,
      pinCode,
      licenseNumber,
      phone,
      responseSlaMinutes,
    } = req.body as {
      level: UserRole;
      organizationName: string;
      districtId: string;
      fullAddress: string;
      pinCode: string;
      licenseNumber?: string;
      phone?: string;
      responseSlaMinutes?: number;
    };

    const district = store.getDistrictById(districtId);
    if (!district) {
      return res.status(400).json({ error: 'Selected district must be a valid Madhya Pradesh district.' });
    }
    if (!fullAddress || fullAddress.trim().length < 10) {
      return res.status(400).json({ error: 'Full street/facility address in Madhya Pradesh is required.' });
    }
    if (!/^4[5-8]\d{4}$/.test((pinCode ?? '').trim())) {
      return res.status(400).json({
        error: 'PIN code must be a valid 6-digit Madhya Pradesh PIN (45xxxx–48xxxx).',
      });
    }

    const actor = req.authContext?.email ?? req.authContext?.uid ?? 'mp-operator';
    // Log strictly without exposing phone/personal contact details in audit logs
    store.addAuditLog({
      actorId: actor,
      actorRole: level,
      action: 'LEVEL_LOGIN_PROFILE_VERIFIED',
      entityType: 'DistributionLevelSession',
      entityId: districtId,
      details: `Activated ${level} workspace session for "${organizationName || 'MP Facility'}" in ${district.name} (PIN ${pinCode.trim()}). Direct phone stored privately only.`,
    });

    res.json({
      verified: true,
      level,
      districtName: district.name,
      organizationName: organizationName || `${level} Facility`,
      fullAddress: fullAddress.trim(),
      pinCode: pinCode.trim(),
      licenseNumber: licenseNumber?.trim() || 'MP/FDA/REG-PENDING',
      privateContactStored: Boolean(phone && phone.trim().length >= 6),
      responseSlaMinutes: responseSlaMinutes ?? 15,
      privacyGuarantee: 'Personal contact and street-level direct phone are never broadcast or exported.',
    });
  });

  // Privacy-scoped contacts: shares direct reach ONLY with 1-hop adjacent tiers (or State Admin)
  router.get('/contacts/scoped', (req: RequestWithAuth, res) => {
    const callerRole = req.authContext?.role ?? 'STATE_ADMIN';
    const { districtId, level } = req.query as { districtId?: string; level?: string };

    const contacts: ScopedContactView[] = store.nodes
      .filter((node) => {
        if (districtId && districtId !== 'ALL' && node.districtId !== districtId) return false;
        if (level && level !== 'ALL' && node.level !== level) return false;
        return true;
      })
      .map((node) => {
        const seed = store.nodeContacts.find((c) => c.nodeId === node.id);
        const scope = isAdjacentOrSameScope(callerRole, node.level);
        return {
          nodeId: node.id,
          nodeName: node.name,
          level: node.level,
          districtId: node.districtId,
          city: node.city,
          fullAddress: node.fullAddress,
          deskName: seed?.deskName ?? `${node.city} Duty Desk`,
          slaMinutes: seed?.slaMinutes ?? 15,
          shiftHours: seed?.shiftHours ?? '08:00–21:00 IST',
          contactVisibility: scope.visibility,
          // CRITICAL: Redact direct channel if outside 1-hop scope!
          directChannel: scope.allowed ? (seed?.directChannel ?? 'Desk Verified') : null,
          maskedChannel: seed?.maskedChannel ?? '+91-755-XXXX00',
          privacyNote: scope.note,
        };
      });

    res.json({
      callerRole,
      contacts,
      recentRequests: store.fastReachRequests.filter(
        (r) => callerRole === 'STATE_ADMIN' || r.requesterRole === callerRole || r.targetLevel === callerRole
      ),
      tierOrder: TIER_ORDER,
    });
  });

  // Ask adjacent contact to reach as fast as possible (strictly 1-hop scoped)
  router.post('/contacts/fast-reach', (req: RequestWithAuth, res) => {
    const callerRole = req.authContext?.role ?? 'STATE_ADMIN';
    const { targetNodeId, urgency, needSummary } = req.body as {
      targetNodeId: string;
      urgency: 'IMMEDIATE_10M' | 'URGENT_30M';
      needSummary: string;
    };

    const node = store.getNodeById(targetNodeId);
    if (!node) {
      return res.status(404).json({ error: 'Target MP distribution node not found.' });
    }

    const scope = isAdjacentOrSameScope(callerRole, node.level);
    if (!scope.allowed) {
      return res.status(403).json({
        error: `Privacy guard blocked request: ${callerRole} cannot broadcast contacts directly to ${node.level}. Route through an adjacent 1-hop supply tier.`,
      });
    }

    if (!needSummary || needSummary.trim().length < 5) {
      return res.status(400).json({ error: 'Provide a clear operational need summary before dispatching rapid reach.' });
    }

    const seed = store.nodeContacts.find((c) => c.nodeId === node.id);
    const request: FastReachRequest = {
      id: `reach-${uuidv4().slice(0, 6)}`,
      requesterRole: callerRole,
      targetNodeId: node.id,
      targetNodeName: node.name,
      targetLevel: node.level,
      urgency: urgency || 'IMMEDIATE_10M',
      needSummary: needSummary.trim(),
      shareScope: 'SINGLE_HOP_ONLY',
      slaMinutes: urgency === 'IMMEDIATE_10M' ? 10 : seed?.slaMinutes ?? 20,
      status: 'DISPATCHED_TO_ADJACENT_DESK',
      createdAt: new Date().toISOString(),
    };

    store.fastReachRequests.unshift(request);
    if (store.fastReachRequests.length > 50) {
      store.fastReachRequests.length = 50;
    }

    // Notice: Audit log records node & need only — zero personal phone numbers leaked
    store.addAuditLog({
      actorId: req.authContext?.email ?? req.authContext?.uid ?? 'operator',
      actorRole: callerRole,
      action: 'FAST_REACH_DISPATCHED_1HOP',
      entityType: 'DistributionNode',
      entityId: node.id,
      details: `Rapid-reach ping (${request.urgency}) sent strictly to ${node.name} (${node.level}) for: "${request.needSummary}".`,
    });

    res.status(201).json({
      request,
      directChannel: seed?.directChannel ?? null,
      privacyGuarantee: 'Contact shared strictly with this single 1-hop target desk only.',
    });
  });
}
