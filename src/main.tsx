import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './theme.css'
import { redo, undo, useEngraver } from './state/store'
import { useViewport } from './state/viewport'
import { exportSvg, extractEmbeddedProject } from './io/exportSvg'
import { exportPng } from './io/exportPng'
import { loadProjectFile } from './io/project'
import * as workspace from './io/workspace'
import { presetBlank, presetGroovy, presetOldBook, presetReferenceA, presetReferenceB } from './model/presets'
import { parseDoc } from './model/serialize'

// Dev-only console access for debugging and scripted verification.
if (import.meta.env.DEV) {
  Object.assign(window as unknown as Record<string, unknown>, {
    __engraver: {
      useEngraver,
      useViewport,
      undo,
      redo,
      exportSvg,
      exportPng,
      extractEmbeddedProject,
      parseDoc,
      loadProjectFile,
      workspace,
      presets: { presetBlank, presetReferenceA, presetReferenceB, presetGroovy, presetOldBook },
    },
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
