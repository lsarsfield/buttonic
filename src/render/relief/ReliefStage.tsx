import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { useEngraver } from '../../state/store'
import { useDocResources } from '../DocRenderer'
import { computeHeightField, heightKey } from './heightAsync'
import { ButtonScene, lastPose, specOfDoc, type ButtonSpec, type Pose } from './scene'

/**
 * The 3D view: the struck button in a photo studio, orbitable. Lazy-loaded
 * (three.js stays out of the main bundle). Renders on demand — camera moves,
 * spec changes and new height fields each trigger one frame; nothing loops.
 *
 * Edits rebuild the height field off-thread after a short debounce; the last
 * relief stays on screen until the new one lands (StatusBar shows "3D…").
 */

const DEBOUNCE_MS = 250
const MAX_POLAR = 65 * (Math.PI / 180)

export default function ReliefStage() {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<{ scene: ButtonScene; controls: OrbitControls; render: () => void } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const doc = useEngraver((s) => s.doc)
  const fontsRevision = useEngraver((s) => s.fontsRevision)
  const assetsRevision = useEngraver((s) => s.assetsRevision)
  const lightDeg = useEngraver((s) => s.view.lightDeg)
  const backdrop = useEngraver((s) => s.view.backdrop)
  useDocResources(doc, fontsRevision, assetsRevision)

  // renderer + scene + controls, once
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    } catch (e) {
      setFailed(`3D view unavailable: ${e instanceof Error ? e.message : String(e)}`)
      return
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    host.appendChild(renderer.domElement)
    const scene = new ButtonScene(renderer)
    const controls = new OrbitControls(scene.camera, renderer.domElement)
    controls.enablePan = false
    controls.maxPolarAngle = MAX_POLAR
    controls.rotateSpeed = 0.6
    controls.zoomSpeed = 0.8

    let frame = 0
    const render = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        scene.render()
      })
    }
    controls.addEventListener('change', () => {
      lastPose.position = scene.camera.position.clone()
      lastPose.target = controls.target.clone()
      render()
    })

    const resize = () => {
      const w = host.clientWidth
      const h = host.clientHeight
      if (w === 0 || h === 0) return
      renderer.setSize(w, h)
      scene.camera.aspect = w / h
      scene.camera.updateProjectionMatrix()
      const fit = scene.fitDistance()
      controls.minDistance = fit * 0.3
      controls.maxDistance = fit * 2.5
      render()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(host)

    sceneRef.current = { scene, controls, render }
    // dev-only handle for scripted browser verification (like window.__engraver)
    if (import.meta.env.DEV) (window as unknown as { __relief?: unknown }).__relief = { scene, controls, render }
    const s = useEngraver.getState()
    scene.setSpec(specOf(s))
    resize()
    applyPose(lastPose.position ? null : lastPose.pose)
    if (lastPose.position && lastPose.target) {
      scene.camera.position.copy(lastPose.position)
      controls.target.copy(lastPose.target)
      controls.update()
    }
    render()

    return () => {
      ro.disconnect()
      if (frame) cancelAnimationFrame(frame)
      controls.dispose()
      scene.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      host.removeChild(renderer.domElement)
      sceneRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // spec (finish / size / hole / light / backdrop) → immediate re-shade
  useEffect(() => {
    const ref = sceneRef.current
    if (!ref) return
    ref.scene.setSpec(specOf(useEngraver.getState()))
    ref.render()
  }, [
    doc.diameterMM,
    doc.holeDiameterMM,
    doc.product,
    doc.style,
    doc.material,
    doc.logoDisplay,
    doc.distressed,
    doc.postMetal,
    doc.finish,
    lightDeg,
    backdrop,
  ])

  // reframe on a new backdrop / size unless the user has orbited to their own view
  useEffect(() => {
    if (!lastPose.position) applyPose(lastPose.pose)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backdrop, doc.diameterMM, doc.product])

  // relief: debounced off-thread rebuild, latest wins, last result stays up
  const key = heightKey(doc, fontsRevision, assetsRevision)
  useEffect(() => {
    let cancelled = false
    useEngraver.getState().setReliefPending(true)
    const t = setTimeout(() => {
      computeHeightField(doc, fontsRevision, assetsRevision)
        .then((field) => {
          if (cancelled || !sceneRef.current) return
          sceneRef.current.scene.setHeightField(field)
          sceneRef.current.render()
        })
        .catch((e) => {
          if (!cancelled) setFailed(`3D relief failed: ${e instanceof Error ? e.message : String(e)}`)
        })
        .finally(() => {
          if (!cancelled) useEngraver.getState().setReliefPending(false)
        })
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(t)
      useEngraver.getState().setReliefPending(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const applyPose = (pose: Pose | null) => {
    const ref = sceneRef.current
    if (!ref || !pose) return
    ref.scene.setPose(pose, ref.scene.camera.aspect)
    ref.controls.target.copy(ref.scene.target)
    ref.controls.update()
    lastPose.pose = pose
    lastPose.position = null
    lastPose.target = null
    ref.render()
  }

  return (
    <div className="relief-stage" ref={hostRef}>
      <div className="relief-poses">
        <button type="button" onClick={() => applyPose('photo')} title="Three-quarter product-shot view">
          Photo
        </button>
        <button type="button" onClick={() => applyPose('top')} title="Straight down">
          Top
        </button>
      </div>
      {failed && <div className="stage-banner">{failed}</div>}
    </div>
  )
}

function specOf(s: ReturnType<typeof useEngraver.getState>): ButtonSpec {
  return { ...specOfDoc(s.doc), lightDeg: s.view.lightDeg, backdrop: s.view.backdrop }
}
