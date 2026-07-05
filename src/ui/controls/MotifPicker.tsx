import { BUILTIN_MOTIFS, type BuiltinMotif } from '../../geometry/motifs/builtins'

export interface MotifPickerProps {
  label?: string
  value: string
  onChange: (id: string) => void
}

const GROUP_ORDER = ['Basic', 'Groovy', 'Old Book']

/** Grouped grid of rendered motif swatches — each swatch is the motif's own path. */
export function MotifPicker({ label = 'Motif', value, onChange }: MotifPickerProps) {
  const groups = new Map<string, BuiltinMotif[]>()
  for (const m of BUILTIN_MOTIFS) {
    const g = m.group ?? 'Basic'
    const list = groups.get(g) ?? []
    list.push(m)
    groups.set(g, list)
  }
  const keys = [...groups.keys()].sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a)
    const ib = GROUP_ORDER.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })

  return (
    <div className="motif-picker">
      <span className="field-label">{label}</span>
      {keys.map((g) => (
        <div key={g} className="motif-group">
          <div className="motif-group-label">{g}</div>
          <div className="motif-grid">
            {groups.get(g)!.map((m) => (
              <button
                key={m.id}
                type="button"
                className={'motif-swatch' + (m.id === value ? ' active' : '')}
                aria-pressed={m.id === value}
                title={m.label}
                onClick={() => onChange(m.id)}
              >
                <svg viewBox="-0.6 -0.6 1.2 1.2" aria-hidden="true">
                  <path
                    d={m.d}
                    fill={m.paintType === 'fill' ? 'currentColor' : 'none'}
                    stroke={m.paintType === 'stroke' ? 'currentColor' : 'none'}
                    strokeWidth={m.paintType === 'stroke' ? 0.09 : undefined}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
