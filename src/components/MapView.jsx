import { useEffect, useRef } from 'react'
import { MAP_W, MAP_H } from '../lib/db.js'

const S = 8 // px на клетку

export default function MapView({ pixelRows, accent }) {
  const ref = useRef(null)

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    cv.width = MAP_W * S
    cv.height = MAP_H * S
    ctx.fillStyle = '#161616'
    ctx.fillRect(0, 0, cv.width, cv.height)
    ctx.strokeStyle = '#262626'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = 0; x <= MAP_W; x++) { ctx.moveTo(x * S + 0.5, 0); ctx.lineTo(x * S + 0.5, cv.height) }
    for (let y = 0; y <= MAP_H; y++) { ctx.moveTo(0, y * S + 0.5); ctx.lineTo(cv.width, y * S + 0.5) }
    ctx.stroke()
    ctx.fillStyle = accent
    for (const p of pixelRows) {
      if (p.x < 0 || p.y < 0 || p.x >= MAP_W || p.y >= MAP_H) continue
      ctx.fillRect(p.x * S + 1, p.y * S + 1, S - 2, S - 2)
    }
  }, [pixelRows, accent])

  const pct = ((pixelRows.length / (MAP_W * MAP_H)) * 100).toFixed(1)

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-3 text-sm flex-wrap">
        <b>Pixel Map</b>
        <span className="opacity-50 text-xs">1 выполненный чанк = 1 пиксель</span>
        <div className="flex-1" />
        <span className="text-xs">открыто <b className="accent-text">{pixelRows.length}/{MAP_W * MAP_H}</b> · {pct}%</span>
      </div>
      <div className="panel rounded p-2">
        <canvas ref={ref} style={{ width: '100%', display: 'block', borderRadius: 4 }} />
      </div>
      <div className="w-full h-2 rounded mt-3 panel overflow-hidden">
        <div className="h-full accent-bg" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
