export type DataStatus = 'VERIFIED' | 'UNVERIFIED' | 'SIMULATED' | 'STALE';

export type DistributionLevel =
  | 'MANUFACTURER'
  | 'CNF_AGENT'
  | 'SUPER_STOCKIST'
  | 'WHOLESALER'
  | 'LOCAL_DISTRIBUTOR'
  | 'RETAIL_PHARMACY'
  | 'HOSPITAL_PHARMACY';

export type UserRole =
  | 'STATE_ADMIN'
  | DistributionLevel;

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type IncidentStatus = 'OPEN' | 'ACKNOWLEDGED' | 'INVESTIGATING' | 'ESCALATED' | 'RESOLVED';

export type CauseCertainty = 'CONFIRMED' | 'PROBABLE' | 'SUSPECTED';

export type RootCauseCategory =
  | 'DEMAND_RELATED'
  | 'INVENTORY_MANAGEMENT'
  | 'TRANSPORTATION_DISRUPTION'
  | 'SUPPLIER_DELAY'
  | 'DELAYED_DISPATCH'
  | 'DISTRIBUTION_BOTTLENECK'
  | 'DATA_SHARING_FAILURE';

export type AgentName =
  | 'ROUTE_LOGISTICS_AGENT'
  | 'SUPPLY_MANAGEMENT_AGENT'
  | 'REPORTING_ANALYTICS_AGENT'
  | 'ALERT_RESOLUTION_AGENT'
  | 'PHARMA_RAG_ASSISTANT'
  | 'ORCHESTRATOR';

export type EventType =
  | 'ROUTE_DISRUPTION_DETECTED'
  | 'ROUTE_RECALCULATED'
  | 'SHIPMENT_DELAY_PREDICTED'
  | 'DELIVERY_ESTIMATE_UPDATED'
  | 'STOCK_SHORTAGE_DETECTED'
  | 'EXCESS_STOCK_IDENTIFIED'
  | 'REDISTRIBUTION_RECOMMENDED'
  | 'REPLENISHMENT_REQUIRED'
  | 'EXPIRY_RISK_DETECTED'
  | 'REPORT_GENERATED'
  | 'PERFORMANCE_THRESHOLD_BREACHED'
  | 'DISTRICT_TREND_IDENTIFIED'
  | 'INCIDENT_DETECTED'
  | 'ROOT_CAUSE_UPDATED'
  | 'RESOLUTION_RECOMMENDED'
  | 'INCIDENT_ESCALATED'
  | 'INCIDENT_RESOLVED';

export interface AgentEvent {
  event_id: string;
  event_type: EventType;
  source_agent: AgentName;
  timestamp: string;
  district_id: string;
  distribution_node_id: string | null;
  entity_id: string;
  priority: Severity;
  data_status: DataStatus;
  payload: Record<string, unknown>;
  requires_approval: boolean;
}

export interface MPDistrict {
  id: string;
  name: string;
  division: string;
  lat: number;
  lng: number;
  populationEstimate: number;
}

export interface Organization {
  id: string;
  name: string;
  level: DistributionLevel;
  districtId: string;
  licenseNumber: string;
  dataStatus: DataStatus;
  source: string;
  updatedAt: string;
}

export interface DistributionNode {
  id: string;
  organizationId: string;
  name: string;
  level: DistributionLevel;
  districtId: string;
  city: string;
  fullAddress: string;
  pinCode: string;
  lat: number;
  lng: number;
  coldChainCapable: boolean;
  capacityUnits: number;
  dataStatus: DataStatus;
  source: string;
  updatedAt: string;
}

export interface Medicine {
  id: string;
  brandName: string;
  genericName: string;
  composition: string;
  strength: string;
  dosageForm: string;
  packSize: string;
  manufacturer: string;
  therapeuticCategory: string;
  scheduleType: string;
  coldChainRequired: boolean;
  nppaCeilingPriceInr: number | null;
  mrpInr: number;
  retailSellingPriceInr: number;
  distributorPurchasePriceInr: number;
  priceEffectiveDate: string;
  priceSource: string;
  dataStatus: DataStatus;
  source: string;
  updatedAt: string;
}

export interface InventoryRecord {
  id: string;
  nodeId: string;
  medicineId: string;
  batchNumber: string;
  expiryDate: string;
  availableQty: number;
  reservedQty: number;
  incomingQty: number;
  outgoingQty: number;
  reorderLevel: number;
  safetyStock: number;
  dailyDemandHistory: number[];
  unitCostInr: number;
  dataStatus: DataStatus;
  source: string;
  updatedAt: string;
}

export interface OrderRecord {
  id: string;
  requestingNodeId: string;
  supplyingNodeId: string;
  medicineId: string;
  requestedQty: number;
  fulfilledQty: number;
  status: 'FULFILLED' | 'PARTIAL' | 'PENDING' | 'DELAYED';
  createdAt: string;
  fulfilledAt: string | null;
  promisedMinutes: number;
  actualMinutes: number | null;
  dataStatus: DataStatus;
  source: string;
}

export interface RouteCoordinate {
  lat: number;
  lng: number;
}

export interface Shipment {
  id: string;
  shipmentCode: string;
  originNodeId: string;
  destinationNodeId: string;
  medicineId: string;
  quantity: number;
  vehicleId: string;
  vehicleCapacityUnits: number;
  coldChainVehicle: boolean;
  coldChainRequired: boolean;
  status: 'SCHEDULED' | 'IN_TRANSIT' | 'DELAYED' | 'REROUTED' | 'DELIVERED';
  distanceKm: number;
  estimatedMinutes: number;
  baselineMinutes: number;
  delayMinutes: number;
  routingProvider: 'OSRM_LIVE' | 'MP_HIGHWAY_SIMULATED';
  geometry: RouteCoordinate[];
  alternativeGeometry?: RouteCoordinate[];
  alternativeDistanceKm?: number;
  alternativeMinutes?: number;
  disruptionIds: string[];
  dataStatus: DataStatus;
  source: string;
  updatedAt: string;
}

export interface DisruptionEvent {
  id: string;
  districtId: string;
  roadName: string;
  severity: Severity;
  cause: string;
  description: string;
  lat: number;
  lng: number;
  delayImpactMinutes: number;
  active: boolean;
  dataStatus: DataStatus;
  source: string;
  updatedAt: string;
}

export interface CorrectiveActionOption {
  title: string;
  evidence: string;
  expectedBenefit: string;
  estimatedTimeMinutes: number;
  estimatedCostInr: number | null;
  riskNote: string;
  requiresApproval: boolean;
}

export interface AlertIncident {
  id: string;
  incidentCode: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  rootCauseCategory: RootCauseCategory;
  causeCertainty: CauseCertainty;
  rootCauseSummary: string;
  districtId: string;
  nodeId: string | null;
  distributionLevel: DistributionLevel | null;
  relatedEntityId: string;
  evidence: string[];
  recommendations: CorrectiveActionOption[];
  assignedTo: string | null;
  escalated: boolean;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  dataStatus: DataStatus;
  source: string;
}

export interface ApprovalRecommendation {
  id: string;
  recommendationType: 'REDISTRIBUTION' | 'REPLENISHMENT';
  title: string;
  medicineId: string;
  sourceNodeId: string;
  targetNodeId: string;
  quantity: number;
  rationale: string;
  expectedImpact: string;
  estimatedTransportCostInr: number;
  estimatedEtaMinutes: number;
  routeFeasible: boolean;
  coldChainCompatible: boolean;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  relatedIncidentId: string | null;
  requestedByAgent: AgentName;
  reviewedBy: string | null;
  reviewerRole: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
  dataStatus: DataStatus;
  source: string;
}

export interface PharmaDocument {
  id: string;
  title: string;
  category: 'REGULATORY' | 'PRICING' | 'CLINICAL' | 'FACILITY' | 'NEWS';
  sourceName: string;
  sourceUrl: string;
  effectiveDate: string;
  districtId: string;
  approved: boolean;
  content: string;
  dataStatus: DataStatus;
  createdAt: string;
}

export interface PharmaChunk {
  id: string;
  documentId: string;
  title: string;
  category: PharmaDocument['category'];
  sourceName: string;
  sourceUrl: string;
  effectiveDate: string;
  districtId: string;
  text: string;
  embedding?: number[];
}

export interface PharmaNewsItem {
  id: string;
  headline: string;
  publicationDate: string;
  source: string;
  districtId: string | null;
  category: string;
  summary: string;
  originalLink: string;
  dataStatus: DataStatus;
}

export interface HealthcareFacility {
  id: string;
  name: string;
  facilityType: string;
  districtId: string;
  city: string;
  lat: number;
  lng: number;
  bedCapacity: number | null;
  hfrId: string;
  source: string;
  dataStatus: DataStatus;
  updatedAt: string;
}

export interface DataSourceRegistryItem {
  id: string;
  name: string;
  url: string;
  category: string;
  reliability: 'HIGH' | 'MEDIUM' | 'DEMO_SYNTHETIC';
  permittedUsage: string;
  updateFrequency: string;
  availability: 'ACCESSIBLE' | 'SIMULATED_FALLBACK';
  dataStatus: DataStatus;
  lastCheckedAt: string;
}

export interface AuditLogEntry {
  id: string;
  actorId: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  details: string;
  timestamp: string;
}

export interface OperationalNeedProfile {
  level: DistributionLevel;
  label: string;
  primaryNeed: string;
  relatedInfo: string;
  upstreamDependency: string;
  downstreamImpact: string;
  regulatoryConstraint: string;
  targetResponseSlaMinutes: number;
}

export interface PredictiveOutcomeOption {
  key: string;
  label: string;
  strategySummary: string;
  stockoutRiskPct: number;
  projectedDaysOfCover: number;
  spoilageRiskPct: number;
  estimatedEtaMinutes: number | null;
  estimatedCostInr: number;
  patientServiceImpact: string;
  feasibilityStatus: 'OPTIMAL' | 'VIABLE' | 'CONSTRAINED' | 'HIGH_RISK';
}

export interface PredictiveEvaluationResult {
  entityType: 'INVENTORY' | 'INCIDENT' | 'SHIPMENT';
  entityId: string;
  title: string;
  definedNeed: string;
  relatedInfo: string;
  outcomes: PredictiveOutcomeOption[];
  recommendedOutcomeKey: string;
  predictiveSolutionSummary: string;
  confidenceLabel: 'HIGH' | 'MEDIUM' | 'BOUNDED_SIMULATION';
  requiresHumanApproval: boolean;
  dataStatus: DataStatus;
  evaluatedAt: string;
}

export interface NodeContactSeed {
  nodeId: string;
  deskName: string;
  directChannel: string;
  maskedChannel: string;
  slaMinutes: number;
  shiftHours: string;
}

export interface ScopedContactView {
  nodeId: string;
  nodeName: string;
  level: DistributionLevel;
  districtId: string;
  city: string;
  fullAddress: string;
  deskName: string;
  slaMinutes: number;
  shiftHours: string;
  contactVisibility: 'DIRECT_ADJACENT' | 'SELF_LEVEL' | 'ADMIN_OVERSIGHT' | 'REDACTED_BEYOND_SCOPE';
  directChannel: string | null;
  maskedChannel: string;
  privacyNote: string;
}

export interface FastReachRequest {
  id: string;
  requesterRole: UserRole;
  targetNodeId: string;
  targetNodeName: string;
  targetLevel: DistributionLevel;
  urgency: 'IMMEDIATE_10M' | 'URGENT_30M';
  needSummary: string;
  shareScope: 'SINGLE_HOP_ONLY';
  slaMinutes: number;
  status: 'DISPATCHED_TO_ADJACENT_DESK';
  createdAt: string;
}

export const MP_BOUNDS = {
  minLat: 21.05,
  maxLat: 26.90,
  minLng: 74.00,
  maxLng: 82.85,
};

export function isValidMPCoordinate(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= MP_BOUNDS.minLat &&
    lat <= MP_BOUNDS.maxLat &&
    lng >= MP_BOUNDS.minLng &&
    lng <= MP_BOUNDS.maxLng
  );
}
