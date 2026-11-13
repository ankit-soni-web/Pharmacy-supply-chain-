import { v4 as uuidv4 } from 'uuid';
import {
  MP_DISTRICTS,
  SEED_ALERTS,
  SEED_APPROVALS,
  SEED_AUDIT_LOGS,
  SEED_DATA_SOURCES,
  SEED_DISRUPTIONS,
  SEED_FACILITIES,
  SEED_INVENTORY,
  SEED_LEVEL_NEEDS,
  SEED_MEDICINES,
  SEED_NEWS,
  SEED_NODE_CONTACTS,
  SEED_NODES,
  SEED_ORDERS,
  SEED_ORGANIZATIONS,
  SEED_PHARMA_DOCUMENTS,
  SEED_SHIPMENTS,
} from './data/mpSeed.ts';
import {
  AlertIncident,
  ApprovalRecommendation,
  AuditLogEntry,
  DataSourceRegistryItem,
  DisruptionEvent,
  DistributionNode,
  FastReachRequest,
  HealthcareFacility,
  InventoryRecord,
  Medicine,
  MPDistrict,
  NodeContactSeed,
  OperationalNeedProfile,
  OrderRecord,
  Organization,
  PharmaChunk,
  PharmaDocument,
  PharmaNewsItem,
  Shipment,
} from './types.ts';

class SupplyChainStore {
  districts: MPDistrict[] = [...MP_DISTRICTS];
  organizations: Organization[] = [...SEED_ORGANIZATIONS];
  nodes: DistributionNode[] = [...SEED_NODES];
  medicines: Medicine[] = [...SEED_MEDICINES];
  inventory: InventoryRecord[] = SEED_INVENTORY.map((i) => ({ ...i, dailyDemandHistory: [...i.dailyDemandHistory] }));
  orders: OrderRecord[] = [...SEED_ORDERS];
  shipments: Shipment[] = SEED_SHIPMENTS.map((s) => ({
    ...s,
    geometry: [...s.geometry],
    disruptionIds: [...s.disruptionIds],
  }));
  disruptions: DisruptionEvent[] = [...SEED_DISRUPTIONS];
  alerts: AlertIncident[] = SEED_ALERTS.map((a) => ({
    ...a,
    evidence: [...a.evidence],
    recommendations: [...a.recommendations],
  }));
  approvals: ApprovalRecommendation[] = [...SEED_APPROVALS];
  documents: PharmaDocument[] = [...SEED_PHARMA_DOCUMENTS];
  chunks: PharmaChunk[] = [];
  news: PharmaNewsItem[] = [...SEED_NEWS];
  facilities: HealthcareFacility[] = [...SEED_FACILITIES];
  dataSources: DataSourceRegistryItem[] = [...SEED_DATA_SOURCES];
  auditLogs: AuditLogEntry[] = [...SEED_AUDIT_LOGS];
  levelNeeds: OperationalNeedProfile[] = [...SEED_LEVEL_NEEDS];
  nodeContacts: NodeContactSeed[] = [...SEED_NODE_CONTACTS];
  fastReachRequests: FastReachRequest[] = [];

  getDistrictById(id: string): MPDistrict | undefined {
    return this.districts.find((d) => d.id === id);
  }

  getNodeById(id: string): DistributionNode | undefined {
    return this.nodes.find((n) => n.id === id);
  }

  getMedicineById(id: string): Medicine | undefined {
    return this.medicines.find((m) => m.id === id);
  }

  addAuditLog(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): AuditLogEntry {
    const log: AuditLogEntry = {
      id: `aud-${uuidv4().slice(0, 8)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    this.auditLogs.unshift(log);
    if (this.auditLogs.length > 500) {
      this.auditLogs.length = 500;
    }
    return log;
  }
}

export const store = new SupplyChainStore();
