import { useRef, useState } from 'react'
import { beginGesture, endGesture } from '../../state/store'

export interface NumberFieldProps {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
  /** Show a live "⌀ 2×value mm" caption below the field (for radius inputs). */
  diameter?: boolean
}

const decimalsOf = (step: number) => {
  const s = String(step)
  const dot = s.indexOf('.')
  return dot === -1 ? 0 : s.length - dot - 1
}

/**
 * Numeric input with the full design-tool contract:
 *  - typing commits on Enter/blur as one undo step; Escape reverts
 *  - ↑/↓ nudge by step, Shift = ×10, Alt = ×0.1
 *  - dragging the label scrubs the value (one undo step for the whole scrub)
 */
export function NumberField({ label, value, onChange, min, max, step = 1, unit, diameter }: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const scrub = useRef<{ startX: number; startValue: number } | null>(null)
  const decimals = Math.min(4, decimalsOf(step) + 1)

  const clamp = (v: number) => {
    if (min !== undefined) v = Math.max(min, v)
    if (max !== undefined) v = Math.min(max, v)
    return v
  }
  const round = (v: number) => Number(v.toFixed(decimals))
  const shown = draft ?? String(round(value))

  const commit = () => {
    if (draft === null) return
    const parsed = Number(draft.replace(',', '.'))
    if (Number.isFinite(parsed)) onChange(clamp(round(parsed)))
    setDraft(null)
  }

  const nudge = (dir: 1 | -1, e: { shiftKey: boolean; altKey: boolean }) => {
    const factor = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
    const next = clamp(round(value + dir * step * factor))
    setDraft(null)
    onChange(next)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commit()
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      setDraft(null)
      e.currentTarget.blur()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      nudge(1, e)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      nudge(-1, e)
    }
  }

  const onLabelPointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    scrub.current = { startX: e.clientX, startValue: value }
    beginGesture()
  }

  const onLabelPointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!scrub.current) return
    const factor = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
    const steps = Math.round((e.clientX - scrub.current.startX) / 4)
    onChange(clamp(round(scrub.current.startValue + steps * step * factor)))
  }

  const onLabelPointerUp = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!scrub.current) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    scrub.current = null
    endGesture()
  }

  return (
    <label className={'field' + (diameter ? ' field--dia' : '')}>
      <span
        className="field-label scrubbable"
        onPointerDown={onLabelPointerDown}
        onPointerMove={onLabelPointerMove}
        onPointerUp={onLabelPointerUp}
        onLostPointerCapture={onLabelPointerUp}
        title="Drag to scrub · ↑↓ to nudge (Shift ×10, Alt ×0.1)"
      >
        {label}
      </span>
      <span className="field-input">
        <input
          type="text"
          inputMode="decimal"
          value={shown}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => {
            setDraft(String(round(value)))
            e.target.select()
          }}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
        {unit && <span className="field-unit">{unit}</span>}
      </span>
      {diameter && <span className="field-dia" aria-hidden="true">{`⌀ ${round(value * 2)} mm`}</span>}
    </label>
  )
}
