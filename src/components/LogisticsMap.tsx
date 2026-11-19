import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin } from 'lucide-react';
import type { Pickup } from '../shared/types';

interface LogisticsMapProps {
  pickups: Pickup[];
  groupedStops?: Array<{
    pickupId: string;
    type: 'pickup' | 'dropoff';
    label: string;
    location: { lat: number; lng: number; area: string };
  }>;
  lowDataMode?: boolean;
}

export function LogisticsMap({ pickups, groupedStops, lowDataMode }: LogisticsMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [forceLoadInLowData, setForceLoadInLowData] = useState(false);

  const shouldRenderMap = !lowDataMode || forceLoadInLowData;

  useEffect(() => {
    if (!shouldRenderMap || !containerRef.current) return;

    if (!mapRef.current) {
      mapRef.current = L.map(containerRef.current).setView([12.9716, 77.615], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 18,
      }).addTo(mapRef.current);
    }

    const map = mapRef.current;
    // Remove non-tile layers
    map.eachLayer((layer) => {
      if (!(layer instanceof L.TileLayer)) {
        map.removeLayer(layer);
      }
    });

    const points: L.LatLngExpression[] = [];

    for (const pk of pickups) {
      const pCoord: L.LatLngExpression = [pk.pickupLocation.lat, pk.pickupLocation.lng];
      const dCoord: L.LatLngExpression = [pk.dropoffLocation.lat, pk.dropoffLocation.lng];
      points.push(pCoord, dCoord);

      L.circleMarker(pCoord, {
        radius: 7,
        color: '#15803d',
        fillColor: '#16a34a',
        fillOpacity: 0.9,
      })
        .bindPopup(`<strong>Pickup:</strong> ${pk.pickupLocation.area}<br/>Status: ${pk.status}`)
        .addTo(map);

      L.circleMarker(dCoord, {
        radius: 7,
        color: '#0f172a',
        fillColor: '#334155',
        fillOpacity: 0.9,
      })
        .bindPopup(`<strong>Dropoff NGO:</strong> ${pk.dropoffLocation.area}<br/>Distance: ${pk.distanceKm} km`)
        .addTo(map);

      L.polyline([pCoord, dCoord], {
        color: pk.status === 'In Transit' ? '#15803d' : '#94a3b8',
        weight: pk.status === 'In Transit' ? 3.5 : 2,
        dashArray: pk.status === 'Open' ? '6 6' : undefined,
      }).addTo(map);

      if (pk.simulatedVolunteerCoords) {
        const vCoord: L.LatLngExpression = [
          pk.simulatedVolunteerCoords.lat,
          pk.simulatedVolunteerCoords.lng,
        ];
        points.push(vCoord);
        L.circleMarker(vCoord, {
          radius: 8,
          color: '#b45309',
          fillColor: '#f59e0b',
          fillOpacity: 1,
        })
          .bindPopup(
            `<strong>${pk.volunteerName || 'Courier'}</strong><br/>Simulated location (${pk.status})`
          )
          .addTo(map);
      }
    }

    if (groupedStops && groupedStops.length >= 2) {
      const coords: L.LatLngExpression[] = groupedStops.map((s) => [
        s.location.lat,
        s.location.lng,
      ]);
      L.polyline(coords, { color: '#0284c7', weight: 3, dashArray: '4 4' }).addTo(map);
    }

    if (points.length > 0) {
      map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 14 });
    }
  }, [shouldRenderMap, pickups, groupedStops]);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  if (!shouldRenderMap) {
    return (
      <div className="p-6 border border-slate-200 rounded-xl bg-white text-center space-y-3">
        <MapPin className="w-6 h-6 text-emerald-700 mx-auto" />
        <p className="text-sm font-semibold text-slate-900">
          Map paused in Low-Data Mode
        </p>
        <p className="text-xs text-slate-600">
          {pickups.length} active route(s) available as text coordinates to conserve bandwidth.
        </p>
        <button
          type="button"
          onClick={() => setForceLoadInLowData(true)}
          className="px-4 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 cursor-pointer"
        >
          Load OpenStreetMap Tiles
        </button>
      </div>
    );
  }

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-slate-800">
          Live Logistics Map (OpenStreetMap)
        </span>
        <div className="flex flex-wrap items-center gap-3 text-slate-600">
          <span>Green: Donor Pickup</span>
          <span>·</span>
          <span>Slate: NGO Dropoff</span>
          <span>·</span>
          <span className="font-medium text-amber-800">Amber: Simulated location</span>
        </div>
      </div>
      <div ref={containerRef} className="w-full h-[320px]" data-testid="logistics-map" />
    </div>
  );
}
