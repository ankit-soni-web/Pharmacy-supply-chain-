import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { DisruptionEvent, DistributionNode, ShipmentView } from '../types/platform.ts';

interface MpMapProps {
  nodes: DistributionNode[];
  shipments?: ShipmentView[];
  disruptions?: DisruptionEvent[];
  previewRoute?: {
    primary: { lat: number; lng: number }[];
    alternative?: { lat: number; lng: number }[];
  } | null;
  selectedDistrictId?: string;
  heightClass?: string;
  onSelectNode?: (node: DistributionNode) => void;
}

const LEVEL_COLORS: Record<string, string> = {
  MANUFACTURER: '#0f172a',
  CNF_AGENT: '#0f766e',
  SUPER_STOCKIST: '#0369a1',
  WHOLESALER: '#4338ca',
  LOCAL_DISTRIBUTOR: '#7c3aed',
  RETAIL_PHARMACY: '#d97706',
  HOSPITAL_PHARMACY: '#dc2626',
};

export function MpMap({
  nodes,
  shipments = [],
  disruptions = [],
  previewRoute = null,
  selectedDistrictId,
  heightClass = 'h-[420px]',
  onSelectNode,
}: MpMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const mpBounds = L.latLngBounds([20.8, 73.7], [27.2, 83.2]);
    const map = L.map(containerRef.current, {
      center: [23.45, 78.2],
      zoom: 6,
      minZoom: 6,
      maxZoom: 15,
      maxBounds: mpBounds,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors · Madhya Pradesh Corridor',
      maxZoom: 18,
    }).addTo(map);

    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerGroupRef.current = group;

    const resizeTimer = window.setTimeout(() => {
      map.invalidateSize();
    }, 120);

    return () => {
      window.clearTimeout(resizeTimer);
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const group = layerGroupRef.current;
    const map = mapRef.current;
    if (!group || !map) return;

    group.clearLayers();

    // Active shipment routes
    for (const shp of shipments) {
      if (!shp.geometry || shp.geometry.length < 2) continue;
      const color =
        shp.status === 'DELAYED'
          ? '#dc2626'
          : shp.status === 'REROUTED'
            ? '#d97706'
            : '#0f766e';

      const poly = L.polyline(
        shp.geometry.map((p) => [p.lat, p.lng] as [number, number]),
        { color, weight: 3.5, opacity: 0.85 }
      );
      poly.bindPopup(
        `<div style="font-size:12px;line-height:1.4">
          <strong>${shp.shipmentCode}</strong> (${shp.status})<br/>
          ${shp.originName} &rarr; ${shp.destinationName}<br/>
          Medicine: ${shp.medicineName} (${shp.quantity} units)<br/>
          Distance: ${shp.distanceKm} km · ETA: ${shp.estimatedMinutes} min
          ${shp.delayMinutes > 0 ? `<br/><span style="color:#dc2626">Delay: +${shp.delayMinutes} min</span>` : ''}
        </div>`
      );
      poly.addTo(group);

      if (shp.alternativeGeometry && shp.alternativeGeometry.length >= 2 && shp.status === 'DELAYED') {
        L.polyline(
          shp.alternativeGeometry.map((p) => [p.lat, p.lng] as [number, number]),
          { color: '#475569', weight: 2.5, dashArray: '6 6', opacity: 0.75 }
        )
          .bindPopup(
            `<div style="font-size:12px">Alternative Corridor: ${shp.alternativeDistanceKm ?? '--'} km · ${shp.alternativeMinutes ?? '--'} min</div>`
          )
          .addTo(group);
      }
    }

    // Calculated preview route
    if (previewRoute && previewRoute.primary.length >= 2) {
      const pLine = L.polyline(
        previewRoute.primary.map((p) => [p.lat, p.lng] as [number, number]),
        { color: '#0284c7', weight: 4.5, opacity: 0.95 }
      ).addTo(group);

      if (previewRoute.alternative && previewRoute.alternative.length >= 2) {
        L.polyline(
          previewRoute.alternative.map((p) => [p.lat, p.lng] as [number, number]),
          { color: '#64748b', weight: 2.5, dashArray: '5 6', opacity: 0.8 }
        ).addTo(group);
      }

      map.fitBounds(pLine.getBounds(), { padding: [36, 36], maxZoom: 9 });
    }

    // Disruptions
    for (const dis of disruptions) {
      if (!dis.active) continue;
      L.circleMarker([dis.lat, dis.lng], {
        radius: 9,
        color: '#991b1b',
        fillColor: '#ef4444',
        fillOpacity: 0.85,
        weight: 2,
      })
        .bindPopup(
          `<div style="font-size:12px;line-height:1.4">
            <strong style="color:#dc2626">${dis.severity} Disruption</strong><br/>
            ${dis.roadName}<br/>
            Cause: ${dis.cause}<br/>
            Delay Impact: +${dis.delayImpactMinutes} min (${dis.dataStatus})
          </div>`
        )
        .addTo(group);
    }

    // MP distribution nodes
    for (const node of nodes) {
      const highlighted = selectedDistrictId && selectedDistrictId !== 'ALL' && node.districtId === selectedDistrictId;
      const color = LEVEL_COLORS[node.level] || '#0f766e';
      const marker = L.circleMarker([node.lat, node.lng], {
        radius: highlighted ? 9 : 6.5,
        color: '#ffffff',
        fillColor: color,
        fillOpacity: 0.95,
        weight: highlighted ? 2.5 : 1.5,
      });

      marker.bindPopup(
        `<div style="font-size:12px;line-height:1.45">
          <strong>${node.name}</strong><br/>
          ${node.level.replace(/_/g, ' ')} · ${node.city}<br/>
          Cold Chain: ${node.coldChainCapable ? '2°C–8°C Ready' : 'Ambient Only'}<br/>
          Status: ${node.dataStatus} · ${node.source}
        </div>`
      );
      if (onSelectNode) {
        marker.on('click', () => onSelectNode(node));
      }
      marker.addTo(group);
    }
  }, [nodes, shipments, disruptions, previewRoute, selectedDistrictId, onSelectNode]);

  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
      <div ref={containerRef} className={`w-full ${heightClass}`} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-900" /> Manufacturer
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-teal-700" /> C&amp;F Hub
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-sky-700" /> Super-Stockist
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-600" /> Retail / Dist.
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-600" /> Hospital / Disruption
          </span>
        </div>
        <span className="font-mono text-[11px] text-slate-500">
          Scope: Madhya Pradesh Only (21.05°N–26.90°N)
        </span>
      </div>
    </div>
  );
}
