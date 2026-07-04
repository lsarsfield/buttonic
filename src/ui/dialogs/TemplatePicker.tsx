import { TEMPLATES } from '../../model/presets'
import { createFromDoc } from '../../io/workspace'

export function TemplatePicker({ onClose }: { onClose: () => void }) {
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
                // creates a NEW workspace entry — the current button stays cached
                void createFromDoc(t.make()).then(onClose)
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
