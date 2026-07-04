import { useRef, useState } from 'react'
import { getSvgError, getSvgReport, svgAssetOptions, uploadSvg } from '../../io/svgAssets'
import { useEngraver } from '../../state/store'

export interface SvgAssetPickerProps {
  label?: string
  value: string | null
  onChange: (assetId: string) => void
}

/** Doc-embedded SVG assets with upload; shows the import report inline. */
export function SvgAssetPicker({ label = 'SVG', value, onChange }: SvgAssetPickerProps) {
  const doc = useEngraver((s) => s.doc)
  const assetsRevision = useEngraver((s) => s.assetsRevision)
  void assetsRevision // re-render when parses land
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  const options = svgAssetOptions(doc)
  const report = value ? getSvgReport(value) : []
  const parseError = value ? getSvgError(value) : null

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    const result = await uploadSvg(file)
    if (result.ok) onChange(result.assetId)
    else setError(result.error)
  }

  return (
    <>
      <label className="field">
        <span className="field-label">{label}</span>
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>
            {options.length === 0 ? '— upload an SVG —' : '— choose —'}
          </option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button type="button" title="Upload an SVG file" onClick={() => fileRef.current?.click()}>
          ⤒
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".svg,image/svg+xml"
          style={{ display: 'none' }}
          onChange={onFile}
        />
      </label>
      {error && <div className="warning-note">{error}</div>}
      {parseError && <div className="warning-note">{parseError}</div>}
      {report.length > 0 && (
        <div className="import-report">
          {report.map((item, i) => (
            <div key={i} className={item.kind === 'skipped' ? 'warning-note' : 'readout'}>
              {item.what}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
