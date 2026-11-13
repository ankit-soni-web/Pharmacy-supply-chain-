import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { eventBus } from '../eventBus.ts';
import { store } from '../store.ts';
import {
  DataStatus,
  DisruptionEvent,
  isValidMPCoordinate,
  RouteCoordinate,
  Shipment,
} from '../types.ts';

function haversineKm(a: RouteCoordinate, b: RouteCoordinate): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const c =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * R * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
}

function interpolateCorridor(a: RouteCoordinate, b: RouteCoordinate, offsetSign = 0): RouteCoordinate[] {
  const mid1 = {
    lat: a.lat + (b.lat - a.lat) * 0.33 + offsetSign * 0.14,
    lng: a.lng + (b.lng - a.lng) * 0.33 - offsetSign * 0.12,
  };
  const mid2 = {
    lat: a.lat + (b.lat - a.lat) * 0.67 + offsetSign * 0.11,
    lng: a.lng + (b.lng - a.lng) * 0.67 - offsetSign * 0.09,
  };
  return [a, mid1, mid2, b];
}

export interface CalculatedRouteResult {
  distanceKm: number;
  baselineMinutes: number;
  estimatedMinutes: number;
  delayMinutes: number;
  routingProvider: 'OSRM_LIVE' | 'MP_HIGHWAY_SIMULATED';
  dataStatus: DataStatus;
  source: string;
  geometry: RouteCoordinate[];
  alternativeGeometry: RouteCoordinate[];
  alternativeDistanceKm: number;
  alternativeMinutes: number;
  affectingDisruptions: DisruptionEvent[];
  updatedAt: string;
}

export async function calculateRouteBetweenCoordinates(
  origin: RouteCoordinate,
  destination: RouteCoordinate
): Promise<CalculatedRouteResult> {
  if (!isValidMPCoordinate(origin.lat, origin.lng) || !isValidMPCoordinate(destination.lat, destination.lng)) {
    throw new Error('Coordinates must fall within Madhya Pradesh boundaries (21.05°N–26.90°N, 74.00°E–82.85°E).');
  }

  let distanceKm = 0;
  let baselineMinutes = 0;
  let geometry: RouteCoordinate[] = [];
  let alternativeGeometry: RouteCoordinate[] = [];
  let alternativeDistanceKm = 0;
  let alternativeMinutes = 0;
  let routingProvider: 'OSRM_LIVE' | 'MP_HIGHWAY_SIMULATED' = 'MP_HIGHWAY_SIMULATED';
  let dataStatus: DataStatus = 'SIMULATED';
  let source = 'MP Highway Road Estimator (Simulated Fallback)';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&alternatives=true`;
    const resp = await fetch(osrmUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (resp.ok) {
      const json = (await resp.json()) as {
        code?: string;
        routes?: Array<{
          distance: number;
          duration: number;
          geometry: { coordinates: [number, number][] };
        }>;
      };
      if (json.code === 'Ok' && json.routes && json.routes.length > 0) {
        const primary = json.routes[0];
        distanceKm = Number((primary.distance / 1000).toFixed(1));
        baselineMinutes = Math.max(15, Math.round(primary.duration / 60));
        geometry = primary.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
        routingProvider = 'OSRM_LIVE';
        dataStatus = 'VERIFIED';
        source = 'OpenStreetMap / OSRM Live Driving Route';

        if (json.routes.length > 1) {
          const alt = json.routes[1];
          alternativeDistanceKm = Number((alt.distance / 1000).toFixed(1));
          alternativeMinutes = Math.max(15, Math.round(alt.duration / 60));
          alternativeGeometry = alt.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
        }
      }
    }
  } catch {
    // Graceful fallback to MP highway distance model
  }

  if (geometry.length === 0) {
    const straightKm = haversineKm(origin, destination);
    distanceKm = Number((straightKm * 1.24).toFixed(1)); // MP highway tortuosity factor
    baselineMinutes = Math.max(20, Math.round((distanceKm / 48) * 60));
    geometry = interpolateCorridor(origin, destination, 0);
  }

  if (alternativeGeometry.length === 0) {
    alternativeDistanceKm = Number((distanceKm * 1.11).toFixed(1));
    alternativeMinutes = Math.max(20, Math.round(baselineMinutes * 1.13));
    alternativeGeometry = interpolateCorridor(origin, destination, 1);
  }

  // Check active MP disruptions along corridor proximity
  const affectingDisruptions = store.disruptions.filter((d) => {
    if (!d.active) return false;
    return geometry.some((pt) => haversineKm(pt, { lat: d.lat, lng: d.lng }) <= 32);
  });

  const delayMinutes = affectingDisruptions.reduce((sum, d) => sum + d.delayImpactMinutes, 0);
  const estimatedMinutes = baselineMinutes + delayMinutes;

  return {
    distanceKm,
    baselineMinutes,
    estimatedMinutes,
    delayMinutes,
    routingProvider,
    dataStatus: delayMinutes > 0 && dataStatus === 'VERIFIED' ? 'SIMULATED' : dataStatus,
    source:
      delayMinutes > 0
        ? `${source} + Active Disruption Overlay (Simulated Delay)`
        : source,
    geometry,
    alternativeGeometry,
    alternativeDistanceKm,
    alternativeMinutes,
    affectingDisruptions,
    updatedAt: new Date().toISOString(),
  };
}

export async function calculateRouteBetweenNodes(originNodeId: string, destinationNodeId: string) {
  const originNode = store.getNodeById(originNodeId);
  const destinationNode = store.getNodeById(destinationNodeId);
  if (!originNode || !destinationNode) {
    throw new Error('Origin or destination MP distribution node not found.');
  }
  const route = await calculateRouteBetweenCoordinates(
    { lat: originNode.lat, lng: originNode.lng },
    { lat: destinationNode.lat, lng: destinationNode.lng }
  );
  return { originNode, destinationNode, ...route };
}

export function registerRouteAgentRoutes(router: Router) {
  router.get('/routes', (_req, res) => {
    const shipments = store.shipments.map((s) => {
      const origin = store.getNodeById(s.originNodeId);
      const destination = store.getNodeById(s.destinationNodeId);
      const medicine = store.getMedicineById(s.medicineId);
      return {
        ...s,
        originName: origin?.name ?? s.originNodeId,
        originDistrictId: origin?.districtId ?? '',
        destinationName: destination?.name ?? s.destinationNodeId,
        destinationDistrictId: destination?.districtId ?? '',
        medicineName: medicine?.brandName ?? s.medicineId,
        genericName: medicine?.genericName ?? '',
        capacityUtilizationPct: Math.min(100, Math.round((s.quantity / s.vehicleCapacityUnits) * 100)),
        coldChainMismatch: s.coldChainRequired && !s.coldChainVehicle,
      };
    });

    res.json({
      shipments,
      disruptions: store.disruptions,
      nodes: store.nodes,
      districts: store.districts,
    });
  });

  router.post('/routes/calculate', async (req, res) => {
    try {
      const { originNodeId, destinationNodeId, medicineId, quantity, coldChainVehicle, vehicleCapacityUnits } =
        req.body as {
          originNodeId: string;
          destinationNodeId: string;
          medicineId?: string;
          quantity?: number;
          coldChainVehicle?: boolean;
          vehicleCapacityUnits?: number;
        };

      const route = await calculateRouteBetweenNodes(originNodeId, destinationNodeId);
      const medicine = medicineId ? store.getMedicineById(medicineId) : undefined;
      const coldChainRequired = medicine?.coldChainRequired ?? false;
      const hasColdChain = coldChainVehicle ?? (route.originNode.coldChainCapable && route.destinationNode.coldChainCapable);
      const capacity = vehicleCapacityUnits ?? 10000;
      const qty = quantity ?? 0;

      const warnings: string[] = [];
      if (coldChainRequired && !hasColdChain) {
        warnings.push('Cold-chain (2°C–8°C) medicine requires a refrigerated vehicle.');
      }
      if (qty > capacity) {
        warnings.push(`Requested quantity (${qty}) exceeds vehicle capacity (${capacity} units).`);
      }
      if (coldChainRequired && route.estimatedMinutes > 360) {
        warnings.push('Transit exceeds 6 hours; active refrigerated telemetry & gel-pack validation required.');
      }

      res.json({
        ...route,
        coldChainRequired,
        coldChainVehicle: hasColdChain,
        capacityFeasible: qty <= capacity,
        coldChainFeasible: !coldChainRequired || hasColdChain,
        warnings,
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Route calculation failed.' });
    }
  });

  router.post('/routes/optimize', async (req, res) => {
    try {
      const { shipmentId } = req.body as { shipmentId: string };
      const shipment = store.shipments.find((s) => s.id === shipmentId);
      if (!shipment) {
        return res.status(404).json({ error: 'Shipment not found.' });
      }
      const originNode = store.getNodeById(shipment.originNodeId);
      const destinationNode = store.getNodeById(shipment.destinationNodeId);
      if (!originNode || !destinationNode) {
        return res.status(404).json({ error: 'Shipment nodes not found.' });
      }

      const calculated = await calculateRouteBetweenCoordinates(
        { lat: originNode.lat, lng: originNode.lng },
        { lat: destinationNode.lat, lng: destinationNode.lng }
      );

      const useAlt =
        calculated.delayMinutes > 0 &&
        calculated.alternativeMinutes < calculated.estimatedMinutes;

      shipment.geometry = useAlt ? calculated.alternativeGeometry : calculated.geometry;
      shipment.distanceKm = useAlt ? calculated.alternativeDistanceKm : calculated.distanceKm;
      shipment.estimatedMinutes = useAlt ? calculated.alternativeMinutes : calculated.estimatedMinutes;
      shipment.delayMinutes = useAlt
        ? Math.max(0, calculated.alternativeMinutes - calculated.baselineMinutes)
        : calculated.delayMinutes;
      shipment.status = useAlt ? 'REROUTED' : shipment.delayMinutes > 15 ? 'DELAYED' : 'IN_TRANSIT';
      shipment.routingProvider = calculated.routingProvider;
      shipment.updatedAt = new Date().toISOString();

      await eventBus.publish({
        event_type: 'ROUTE_RECALCULATED',
        source_agent: 'ROUTE_LOGISTICS_AGENT',
        district_id: destinationNode.districtId,
        distribution_node_id: destinationNode.id,
        entity_id: shipment.id,
        priority: shipment.delayMinutes > 45 ? 'HIGH' : 'MEDIUM',
        data_status: shipment.dataStatus,
        payload: {
          shipmentCode: shipment.shipmentCode,
          reroutedToAlternative: useAlt,
          distanceKm: shipment.distanceKm,
          estimatedMinutes: shipment.estimatedMinutes,
          delayMinutes: shipment.delayMinutes,
        },
      });

      await eventBus.publish({
        event_type: 'DELIVERY_ESTIMATE_UPDATED',
        source_agent: 'ROUTE_LOGISTICS_AGENT',
        district_id: destinationNode.districtId,
        distribution_node_id: destinationNode.id,
        entity_id: shipment.id,
        priority: 'LOW',
        data_status: shipment.dataStatus,
        payload: {
          shipmentCode: shipment.shipmentCode,
          estimatedMinutes: shipment.estimatedMinutes,
        },
      });

      store.addAuditLog({
        actorId: 'route-logistics-agent',
        actorRole: 'SYSTEM_AGENT',
        action: 'ROUTE_OPTIMIZED',
        entityType: 'Shipment',
        entityId: shipment.id,
        details: `${shipment.shipmentCode} ${useAlt ? 'rerouted via alternative MP corridor' : 'recalculated'}; ETA ${shipment.estimatedMinutes} min.`,
      });

      res.json({ shipment, reroutedToAlternative: useAlt });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Route optimization failed.' });
    }
  });

  router.post('/routes/disruption', async (req, res) => {
    try {
      const { districtId, roadName, severity, cause, description, lat, lng, delayImpactMinutes } = req.body as {
        districtId: string;
        roadName: string;
        severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
        cause: string;
        description: string;
        lat?: number;
        lng?: number;
        delayImpactMinutes: number;
      };

      const district = store.getDistrictById(districtId);
      if (!district) {
        return res.status(400).json({ error: 'Invalid Madhya Pradesh district ID.' });
      }
      const finalLat = lat ?? district.lat;
      const finalLng = lng ?? district.lng;
      if (!isValidMPCoordinate(finalLat, finalLng)) {
        return res.status(400).json({ error: 'Disruption coordinates outside Madhya Pradesh bounds.' });
      }

      const disruption: DisruptionEvent = {
        id: `dis-${uuidv4().slice(0, 8)}`,
        districtId,
        roadName: roadName || `${district.name} Highway Corridor`,
        severity: severity || 'HIGH',
        cause: cause || 'Reported Highway Disruption',
        description: description || 'Operator-reported road blockage affecting pharmaceutical transit.',
        lat: finalLat,
        lng: finalLng,
        delayImpactMinutes: Number(delayImpactMinutes) || 60,
        active: true,
        dataStatus: 'UNVERIFIED',
        source: 'Operator Road Disruption Report',
        updatedAt: new Date().toISOString(),
      };
      store.disruptions.unshift(disruption);

      const impactedShipments: Shipment[] = [];
      for (const shp of store.shipments) {
        if (shp.status === 'DELIVERED') continue;
        const hitsRoute = shp.geometry.some(
          (pt) => haversineKm(pt, { lat: disruption.lat, lng: disruption.lng }) <= 40
        );
        if (hitsRoute) {
          shp.delayMinutes += disruption.delayImpactMinutes;
          shp.estimatedMinutes += disruption.delayImpactMinutes;
          shp.status = 'DELAYED';
          shp.disruptionIds.push(disruption.id);
          shp.updatedAt = new Date().toISOString();
          impactedShipments.push(shp);

          const dest = store.getNodeById(shp.destinationNodeId);
          await eventBus.publish({
            event_type: 'SHIPMENT_DELAY_PREDICTED',
            source_agent: 'ROUTE_LOGISTICS_AGENT',
            district_id: dest?.districtId ?? districtId,
            distribution_node_id: shp.destinationNodeId,
            entity_id: shp.id,
            priority: disruption.severity,
            data_status: disruption.dataStatus,
            payload: {
              shipmentCode: shp.shipmentCode,
              medicineId: shp.medicineId,
              delayMinutes: shp.delayMinutes,
              estimatedMinutes: shp.estimatedMinutes,
              disruptionId: disruption.id,
            },
          });
        }
      }

      await eventBus.publish({
        event_type: 'ROUTE_DISRUPTION_DETECTED',
        source_agent: 'ROUTE_LOGISTICS_AGENT',
        district_id: districtId,
        distribution_node_id: null,
        entity_id: disruption.id,
        priority: disruption.severity,
        data_status: disruption.dataStatus,
        payload: {
          roadName: disruption.roadName,
          cause: disruption.cause,
          delayImpactMinutes: disruption.delayImpactMinutes,
          impactedShipmentCount: impactedShipments.length,
        },
      });

      store.addAuditLog({
        actorId: 'operator',
        actorRole: 'OPERATOR',
        action: 'DISRUPTION_REPORTED',
        entityType: 'DisruptionEvent',
        entityId: disruption.id,
        details: `${disruption.roadName} (${disruption.delayImpactMinutes} min impact); ${impactedShipments.length} shipments impacted.`,
      });

      res.status(201).json({ disruption, impactedShipments });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to log disruption.' });
    }
  });

  router.get('/routes/alternatives/:shipment_id', async (req, res) => {
    const shipment = store.shipments.find((s) => s.id === req.params.shipment_id);
    if (!shipment) {
      return res.status(404).json({ error: 'Shipment not found.' });
    }
    try {
      const calculated = await calculateRouteBetweenNodes(shipment.originNodeId, shipment.destinationNodeId);
      res.json({
        shipmentId: shipment.id,
        shipmentCode: shipment.shipmentCode,
        primaryRoute: {
          distanceKm: shipment.distanceKm,
          estimatedMinutes: shipment.estimatedMinutes,
          delayMinutes: shipment.delayMinutes,
          geometry: shipment.geometry,
        },
        alternativeRoute: {
          distanceKm: calculated.alternativeDistanceKm,
          estimatedMinutes: calculated.alternativeMinutes,
          timeSavedMinutes: Math.max(0, shipment.estimatedMinutes - calculated.alternativeMinutes),
          geometry: calculated.alternativeGeometry,
        },
        routingProvider: calculated.routingProvider,
        dataStatus: calculated.dataStatus,
        source: calculated.source,
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to compute alternatives.' });
    }
  });

  router.get('/routes/:shipment_id', (req, res) => {
    const shipment = store.shipments.find((s) => s.id === req.params.shipment_id);
    if (!shipment) {
      return res.status(404).json({ error: 'Shipment not found.' });
    }
    const origin = store.getNodeById(shipment.originNodeId);
    const destination = store.getNodeById(shipment.destinationNodeId);
    const medicine = store.getMedicineById(shipment.medicineId);
    const activeDisruptions = store.disruptions.filter((d) => shipment.disruptionIds.includes(d.id));
    res.json({ shipment, origin, destination, medicine, activeDisruptions });
  });
}
