import { TEMPLATES } from '../../model/presets'
import { useEngraver } from '../../state/store'

export function TemplatePicker({ onClose }: { onClose: () => void }) {
  const setDoc = useEngraver((s) => s.setDoc)
  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="modal-title">New button</div>
        <p className="modal-blurb">
          Every template is fully parametric — counts, radii and angles computed from the centre
          axis.
        </p>
        <div className="template-cards">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              className="template-card"
              onClick={() => {
                setDoc(t.make())
                useEngraver.temporal.getState().clear()
                onClose()
              }}
            >
              <span className="template-name">{t.name}</span>
              <span className="template-blurb">{t.blurb}</span>
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
