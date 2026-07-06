import { useMemo, useState } from 'react'
import { BUILTIN_MOTIFS, type BuiltinMotif } from '../../geometry/motifs/builtins'

export interface MotifPickerProps {
  label?: string
  value: string
  onChange: (id: string) => void
}

/** Display order for the motif groups; unknown groups sort to the end. */
const GROUP_ORDER = [
  'Basic',
  'Celestial',
  'Floral',
  'Bandana',
  'Kilim',
  'Groovy',
  'Workwear',
  'Tarot',
  'Old Book',
]

interface Group {
  name: string
  motifs: BuiltinMotif[]
}

function buildGroups(): Group[] {
  const map = new Map<string, BuiltinMotif[]>()
  for (const m of BUILTIN_MOTIFS) {
    const g = m.group ?? 'Basic'
    const list = map.get(g) ?? []
    list.push(m)
    map.set(g, list)
  }
  return [...map.keys()]
    .sort((a, b) => {
      const ia = GROUP_ORDER.indexOf(a)
      const ib = GROUP_ORDER.indexOf(b)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })
    .map((name) => ({ name, motifs: map.get(name)! }))
}

function MotifSwatch({
  motif,
  active,
  onSelect,
}: {
  motif: BuiltinMotif
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className={'motif-swatch' + (active ? ' active' : '')}
      aria-pressed={active}
      title={motif.label}
      onClick={onSelect}
    >
      <svg viewBox="-0.6 -0.6 1.2 1.2" aria-hidden="true">
        <path
          d={motif.d}
          fill={motif.paintType === 'fill' ? 'currentColor' : 'none'}
          stroke={motif.paintType === 'stroke' ? 'currentColor' : 'none'}
          strokeWidth={motif.paintType === 'stroke' ? 0.09 : undefined}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

/**
 * Grouped motif chooser. With a large library the flat grid would swamp the
 * inspector, so groups are a collapsible accordion (the group holding the
 * current value opens by default) behind a search box, inside a capped scroll
 * area. Typing filters across every group and auto-expands the matches.
 */
export function MotifPicker({ label = 'Motif', value, onChange }: MotifPickerProps) {
  const groups = useMemo(buildGroups, [])
  const selectedGroup = useMemo(
    () => groups.find((g) => g.motifs.some((m) => m.id === value))?.name ?? groups[0]?.name,
    [groups, value],
  )
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    selectedGroup ? { [selectedGroup]: true } : {},
  )

  const q = query.trim().toLowerCase()
  const searching = q.length > 0

  const shown = useMemo(() => {
    if (!searching) return groups
    return groups
      .map((g) => ({
        name: g.name,
        motifs: g.motifs.filter(
          (m) =>
            m.label.toLowerCase().includes(q) ||
            m.id.includes(q) ||
            g.name.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.motifs.length > 0)
  }, [groups, q, searching])

  const toggle = (name: string) => setOpen((o) => ({ ...o, [name]: !o[name] }))

  return (
    <div className="motif-picker">
      {label && <span className="field-label">{label}</span>}
      <input
        type="search"
        className="motif-search"
        placeholder="Search motifs…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="motif-scroll">
        {shown.length === 0 && <div className="motif-empty">No motifs match “{query}”.</div>}
        {shown.map((g) => {
          const isOpen = searching || !!open[g.name]
          return (
            <div key={g.name} className="motif-group">
              <button
                type="button"
                className="motif-group-head"
                aria-expanded={isOpen}
                onClick={() => {
                  if (!searching) toggle(g.name)
                }}
              >
                <span className={'motif-chevron' + (isOpen ? ' open' : '')}>▸</span>
                <span className="motif-group-name">{g.name}</span>
                <span className="motif-group-count">{g.motifs.length}</span>
              </button>
              {isOpen && (
                <div className="motif-grid">
                  {g.motifs.map((m) => (
                    <MotifSwatch
                      key={m.id}
                      motif={m}
                      active={m.id === value}
                      onSelect={() => onChange(m.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
