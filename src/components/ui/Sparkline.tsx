export function Sparkline({
  id,
  color,
  values,
}: {
  id: string
  color: string
  values: number[]
}) {
  const pts = values.length >= 2 ? values : [8, 12, 11, 16, 15, 20]
  const min = Math.min(...pts)
  const max = Math.max(...pts)
  const span = Math.max(1, max - min)
  const width = 240
  const height = 42

  const coords = pts.map((v, idx) => {
    const x = (idx / (pts.length - 1)) * width
    const norm = (v - min) / span
    const y = height - 5 - norm * (height - 12)
    return { x, y }
  })

  let d = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`
  for (let i = 0; i < coords.length - 1; i++) {
    const c = coords[i]
    const n = coords[i + 1]
    const mx = ((c.x + n.x) / 2).toFixed(1)
    d += ` C ${mx} ${c.y.toFixed(1)}, ${mx} ${n.y.toFixed(1)}, ${n.x.toFixed(1)} ${n.y.toFixed(1)}`
  }
  const area = `${d} L ${width} ${height} L 0 ${height} Z`

  return (
    <svg
      className="kpi-sparkline"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.2} />
          <stop offset="100%" stopColor={color} stopOpacity={0.01} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}
