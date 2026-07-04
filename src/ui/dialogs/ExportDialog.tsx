import { useMemo, useRef, useState } from 'react'
import { DEFAULT_SVG_OPTIONS, exportSvg, type SvgExportOptions } from '../../io/exportSvg'
import { exportPng } from '../../io/exportPng'
import { downloadBlob, downloadText, safeFilename } from '../../io/download'
import { loadProjectFile, saveProject } from '../../io/project'
import { useEngraver } from '../../state/store'
import { Select } from '../controls/Select'
import { SegmentedControl } from '../controls/SegmentedControl'
import { Toggle } from '../controls/Toggle'

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const doc = useEngraver((s) => s.doc)
  const lightDeg = useEngraver((s) => s.view.lightDeg)
  const [svgOptions, setSvgOptions] = useState<SvgExportOptions>(DEFAULT_SVG_OPTIONS)
  const [pngPx, setPngPx] = useState('2048')
  const [pngMode, setPngMode] = useState<'metal' | 'flat'>('metal')
  const [pngTransparent, setPngTransparent] = useState(false)
  const [pngError, setPngError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Live warnings: run the die-file export whenever options change.
  const { warnings } = useMemo(() => exportSvg(doc, svgOptions), [doc, svgOptions])

  const downloadSvg = () => {
    const result = exportSvg(doc, svgOptions)
    downloadText(result.svg, `${safeFilename(doc.name)}.svg`, 'image/svg+xml')
  }

  const downloadPng = async () => {
    setPngError(null)
    setBusy(true)
    try {
      const blob = await exportPng(doc, {
        px: Number(pngPx),
        mode: pngMode,
        lightDeg,
        transparent: pngTransparent,
      })
      downloadBlob(blob, `${safeFilename(doc.name)}-${pngPx}px.png`)
    } catch (e) {
      setPngError(
        `${e instanceof Error ? e.message : e} — try the flat mode if your browser can't rasterize SVG filters.`,
      )
    } finally {
      setBusy(false)
    }
  }

  const onLoadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setLoadError(null)
    const result = await loadProjectFile(file)
    if (result.ok) onClose()
    else setLoadError(result.error)
  }

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="modal-title">Export</div>

        <div className="modal-section">
          <div className="modal-section-title">Die file · SVG ({doc.diameterMM} mm true size)</div>
          <Toggle
            label="Expand instances"
            value={svgOptions.expandInstances}
            onChange={(expandInstances) => setSvgOptions({ ...svgOptions, expandInstances })}
          />
          <Toggle
            label="Mirror for die"
            value={svgOptions.mirrorForDie}
            onChange={(mirrorForDie) => setSvgOptions({ ...svgOptions, mirrorForDie })}
          />
          <Toggle
            label="Blank outline"
            value={svgOptions.includeBlankOutline}
            onChange={(includeBlankOutline) => setSvgOptions({ ...svgOptions, includeBlankOutline })}
          />
          {warnings.length > 0 && (
            <div className="export-warnings">
              {warnings.map((w, i) => (
                <div key={i} className="warning-note">
                  ⚠ {w}
                </div>
              ))}
            </div>
          )}
          <button type="button" className="button-primary" onClick={downloadSvg}>
            Download SVG
          </button>
        </div>

        <div className="modal-section">
          <div className="modal-section-title">Mockup · PNG</div>
          <Select
            label="Size"
            value={pngPx}
            options={[
              { value: '1024', label: '1024 px' },
              { value: '2048', label: '2048 px' },
              { value: '4096', label: '4096 px' },
            ]}
            onChange={setPngPx}
          />
          <SegmentedControl
            label="Style"
            value={pngMode}
            options={[
              { value: 'metal', label: 'Metal' },
              { value: 'flat', label: 'Flat' },
            ]}
            onChange={setPngMode}
          />
          {pngMode === 'flat' && (
            <Toggle label="Transparent" value={pngTransparent} onChange={setPngTransparent} />
          )}
          {pngError && <div className="warning-note">{pngError}</div>}
          <button type="button" className="button-primary" disabled={busy} onClick={downloadPng}>
            {busy ? 'Rendering…' : 'Download PNG'}
          </button>
        </div>

        <div className="modal-section">
          <div className="modal-section-title">Project</div>
          <div className="modal-row">
            <button type="button" onClick={() => saveProject(doc)}>
              Save project (.json)
            </button>
            <button type="button" onClick={() => fileRef.current?.click()}>
              Open project / exported SVG…
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.svg,application/json,image/svg+xml"
              style={{ display: 'none' }}
              onChange={onLoadFile}
            />
          </div>
          {loadError && <div className="warning-note">{loadError}</div>}
          <div className="readout">Exported SVGs embed the project — they re-open as documents.</div>
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
