export type DataStatus = 'VERIFIED' | 'UNVERIFIED' | 'SIMULATED' | 'STALE';

export type DistributionLevel =
  | 'MANUFACTURER'
  | 'CNF_AGENT'
  | 'SUPER_STOCKIST'
  | 'WHOLESALER'
  | 'LOCAL_DISTRIBUTOR'
  | 'RETAIL_PHARMACY'
  | 'HOSPITAL_PHARMACY';

export type UserRole = 'STATE_ADMIN' | DistributionLevel;
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type IncidentStatus = 'OPEN' | 'ACKNOWLEDGED' | 'INVESTIGATING' | 'ESCALATED' | 'RESOLVED';

export interface MPDistrict {
  id: string;
  name: string;
  division: string;
  lat: number;
  lng: number;
  populationEstimate: number;
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

export interface EnrichedInventoryRow {
  id: string;
  nodeId: string;
  nodeName: string;
  nodeLevel: DistributionLevel;
  districtId: string;
  city: string;
  coldChainCapable: boolean;
  medicineId: string;
  medicineBrand: string;
  genericName: string;
  coldChainRequired: boolean;
  batchNumber: string;
  expiryDate: string;
  availableQty: number;
  reservedQty: number;
  incomingQty: number;
  outgoingQty: number;
  reorderLevel: number;
  safetyStock: number;
  dailyForecast: number;
  demandTrendPct: number;
  daysOfCover: number | null;
  daysToExpiry: number;
  unitCostInr: number;
  dataStatus: DataStatus;
  source: string;
  updatedAt: string;
  flags: {
    shortage: boolean;
    criticalShortage: boolean;
    excess: boolean;
    expiryRisk: boolean;
    highDemand: boolean;
    lowDemand: boolean;
  };
}

export interface ShipmentView {
  id: string;
  shipmentCode: string;
  originNodeId: string;
  originName: string;
  destinationNodeId: string;
  destinationName: string;
  medicineId: string;
  medicineName: string;
  genericName: string;
  quantity: number;
  vehicleId: string;
  vehicleCapacityUnits: number;
  capacityUtilizationPct: number;
  coldChainVehicle: boolean;
  coldChainRequired: boolean;
  coldChainMismatch: boolean;
  status: string;
  distanceKm: number;
  estimatedMinutes: number;
  baselineMinutes: number;
  delayMinutes: number;
  routingProvider: string;
  geometry: { lat: number; lng: number }[];
  alternativeGeometry?: { lat: number; lng: number }[];
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
  requestedByAgent: string;
  reviewedBy: string | null;
  reviewerRole: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
  dataStatus: DataStatus;
  source: string;
}

export interface AlertIncident {
  id: string;
  incidentCode: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  rootCauseCategory: string;
  causeCertainty: 'CONFIRMED' | 'PROBABLE' | 'SUSPECTED';
  rootCauseSummary: string;
  districtId: string;
  nodeId: string | null;
  distributionLevel: DistributionLevel | null;
  relatedEntityId: string;
  evidence: string[];
  recommendations: {
    title: string;
    evidence: string;
    expectedBenefit: string;
    estimatedTimeMinutes: number;
    estimatedCostInr: number | null;
    riskNote: string;
    requiresApproval: boolean;
  }[];
  assignedTo: string | null;
  escalated: boolean;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  dataStatus: DataStatus;
  source: string;
}

export interface AgentEvent {
  event_id: string;
  event_type: string;
  source_agent: string;
  timestamp: string;
  district_id: string;
  distribution_node_id: string | null;
  entity_id: string;
  priority: Severity;
  data_status: DataStatus;
  payload: Record<string, unknown>;
  requires_approval: boolean;
}

export interface KpiMetric {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  status: 'AVAILABLE' | 'UNAVAILABLE';
  unavailableReason?: string;
  formula: string;
  dataStatus: DataStatus;
}

export interface DataSourceRegistryItem {
  id: string;
  name: string;
  url: string;
  category: string;
  reliability: string;
  permittedUsage: string;
  updateFrequency: string;
  availability: string;
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

export interface LevelMatrixRow {
  level: DistributionLevel;
  label: string;
  nodeCount: number;
  totalCapacityUnits: number;
  availableStockUnits: number;
  reservedUnits: number;
  incomingUnits: number;
  outgoingUnits: number;
  capacityUtilizationPct: number;
  shortageSkuCount: number;
  openIncidentCount: number;
  activeShipmentCount: number;
  orderCount: number;
  fulfilmentRatePct: number | null;
  onTimeDeliveryPct: number | null;
  primaryAddress: string;
  pinCode: string;
  needProfile: OperationalNeedProfile | null;
  dataStatus: DataStatus;
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
  confidenceLabel: string;
  requiresHumanApproval: boolean;
  dataStatus: DataStatus;
  evaluatedAt: string;
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
  status: string;
  createdAt: string;
}

export interface ActiveLevelSession {
  level: UserRole;
  organizationName: string;
  districtId: string;
  districtName: string;
  fullAddress: string;
  pinCode: string;
  licenseNumber: string;
  responseSlaMinutes: number;
  privateContactStored: boolean;
}

