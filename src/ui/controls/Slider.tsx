import { useRef } from 'react'
import { beginGesture, endGesture } from '../../state/store'

export interface SliderProps {
  label: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  unit?: string
}

/** Range slider + live value; the whole drag is one undo step. */
export function Slider({ label, value, onChange, min, max, step = 1, unit }: SliderProps) {
  const dragging = useRef(false)

  const start = () => {
    if (!dragging.current) {
      dragging.current = true
      beginGesture()
    }
  }
  const stop = () => {
    if (dragging.current) {
      dragging.current = false
      endGesture()
    }
  }

  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-slider">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onPointerDown={start}
          onPointerUp={stop}
          onLostPointerCapture={stop}
          onBlur={stop}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="field-slider-value">
          {value}
          {unit ?? ''}
        </span>
      </span>
    </label>
  )
}
