import * as THREE from 'three'
import type { ButtonDoc } from '../../model/types'
import { computeHeightField } from './heightAsync'
import { ButtonScene, lastPose, specOfDoc, type Backdrop } from './scene'

/**
 * 3D PNG mockup: the same scene as the 3D view, rendered offscreen at the
 * requested size from the camera the user last left the view at (or the
 * reference "photo" pose). Reuses the canvas's cached height field.
 */
export async function renderButtonPng(
  doc: ButtonDoc,
  opts: { px: number; lightDeg: number; backdrop: Backdrop; fontsRevision: number; assetsRevision: number },
): Promise<Blob> {
  const field = await computeHeightField(doc, opts.fontsRevision, opts.assetsRevision)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = opts.px
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(opts.px, opts.px, false)
  const scene = new ButtonScene(renderer)
  try {
    scene.setSpec({ ...specOfDoc(doc), lightDeg: opts.lightDeg, backdrop: opts.backdrop })
    scene.setHeightField(field)
    scene.setPose(lastPose.pose, 1)
    if (lastPose.position && lastPose.target) {
      scene.camera.position.copy(lastPose.position)
      scene.camera.lookAt(lastPose.target)
      scene.camera.updateProjectionMatrix()
    }
    scene.render()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('PNG encoding failed.')
    return blob
  } finally {
    scene.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
