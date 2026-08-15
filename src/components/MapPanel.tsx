'use client'

import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, CircleMarker, Marker, Popup, Circle, useMap } from 'react-leaflet'
import L from 'leaflet'
import type { RankedResult, SearchParams } from '@/lib/types'
import { minutes } from '@/lib/format'
import { prefilterRadiusMeters } from '@/lib/geo'

/**
 * Map panel.
 *
 * OpenStreetMap tiles via Leaflet rather than Google Maps: it needs no API key,
 * which keeps the zero-config promise intact. Swapping the TileLayer for a
 * Google raster layer is a one-line change if a key is available.
 *
 * The translucent circle is the stage-1 prefilter radius — the straight-line
 * ceiling the search actually used. Drawing it makes the two-stage commute
 * model legible rather than a claim in a README.
 */

const ORIGIN_ICON = L.divIcon({
  className: '',
  html: `<div style="width:14px;height:14px;border-radius:50%;background:#0b0b0b;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

function Recenter({ lat, lng, radius }: { lat: number; lng: number; radius: number }) {
  const map = useMap()
  useEffect(() => {
    const bounds = L.latLng(lat, lng).toBounds(radius * 2.2)
    map.fitBounds(bounds, { padding: [24, 24], animate: true })
  }, [lat, lng, radius, map])
  return null
}

export function MapPanel({
  results,
  params,
  highlightedId,
  onHover,
  onOpen,
}: {
  results: RankedResult[]
  params: SearchParams
  highlightedId: string | null
  onHover: (id: string | null) => void
  onOpen: (id: string) => void
}) {
  const radius = useMemo(
    () => prefilterRadiusMeters(params.mode, params.maxCommuteMinutes),
    [params.mode, params.maxCommuteMinutes],
  )

  return (
    <MapContainer
      center={[params.lat, params.lng]}
      zoom={13}
      scrollWheelZoom
      className="h-full w-full"
      // Keyboard users get pan/zoom without a mouse.
      keyboard
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
      />

      <Recenter lat={params.lat} lng={params.lng} radius={radius} />

      <Circle
        center={[params.lat, params.lng]}
        radius={radius}
        pathOptions={{ color: '#2a78d6', weight: 1, opacity: 0.35, fillOpacity: 0.04 }}
      />

      <Marker position={[params.lat, params.lng]} icon={ORIGIN_ICON}>
        <Popup>
          <strong>Your origin</strong>
          <br />
          {params.address}
        </Popup>
      </Marker>

      {results.map((r, i) => {
        const active = highlightedId === r.record.venue.id
        return (
          <CircleMarker
            key={r.record.venue.id}
            center={[r.record.venue.lat, r.record.venue.lng]}
            radius={active ? 11 : 8}
            pathOptions={{
              color: '#ffffff',
              weight: 2,
              fillColor: active ? '#1c5cab' : '#2a78d6',
              fillOpacity: 0.95,
            }}
            eventHandlers={{
              mouseover: () => onHover(r.record.venue.id),
              mouseout: () => onHover(null),
              click: () => onOpen(r.record.venue.id),
            }}
          >
            <Popup>
              <strong>
                #{i + 1} {r.record.venue.name}
              </strong>
              <br />
              {r.capacity.best ? r.capacity.best.label : 'Capacity not published'}
              {r.commute && (
                <>
                  <br />
                  {minutes(r.commute.durationSeconds)} {params.mode}
                </>
              )}
            </Popup>
          </CircleMarker>
        )
      })}
    </MapContainer>
  )
}
