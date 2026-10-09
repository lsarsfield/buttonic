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
  opts: { px: number; lightDeg: number; backdrop: Backdrop; rowCount?: number; fontsRevision: number; assetsRevision: number },
): Promise<Blob> {
  const field = await computeHeightField(doc, opts.fontsRevision, opts.assetsRevision)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = opts.px
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, stencil: true })
  renderer.setPixelRatio(1)
  renderer.setSize(opts.px, opts.px, false)
  const scene = new ButtonScene(renderer)
  try {
    scene.setSpec({ ...specOfDoc(doc), lightDeg: opts.lightDeg, backdrop: opts.backdrop })
    scene.setHeightField(field)
    scene.setRow(opts.rowCount ?? 1)
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

/**
 * The print sheet's image: the button straight down through an ORTHOGRAPHIC
 * camera whose frustum is exactly `spanMM` square — every pixel is the same
 * fraction of a millimetre, so the print is true size edge to edge (a
 * perspective top view would print the rim smaller than the face). No
 * backdrop: transparent past the rim. 12 o'clock is the image's top.
 */
export async function renderButtonTopRgba(
  doc: ButtonDoc,
  opts: { px: number; spanMM: number; lightDeg: number; fontsRevision: number; assetsRevision: number },
): Promise<Uint8ClampedArray> {
  const field = await computeHeightField(doc, opts.fontsRevision, opts.assetsRevision)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = opts.px
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, stencil: true })
  renderer.setPixelRatio(1)
  renderer.setSize(opts.px, opts.px, false)
  const scene = new ButtonScene(renderer)
  try {
    scene.setSpec({ ...specOfDoc(doc), lightDeg: opts.lightDeg, backdrop: 'none' })
    scene.setHeightField(field)
    scene.setRow(1)
    const h = opts.spanMM / 2
    const cam = new THREE.OrthographicCamera(-h, h, h, -h, 1, 400)
    cam.position.set(0, 200, 0)
    cam.up.set(0, 0, -1) // 12 o'clock (−Z) at the top of the image
    cam.lookAt(0, 0, 0)
    cam.updateProjectionMatrix()
    scene.render(cam)
    const out = document.createElement('canvas')
    out.width = out.height = opts.px
    const ctx = out.getContext('2d')
    if (!ctx) throw new Error('No 2D canvas available.')
    ctx.drawImage(canvas, 0, 0)
    return ctx.getImageData(0, 0, opts.px, opts.px).data
  } finally {
    scene.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
