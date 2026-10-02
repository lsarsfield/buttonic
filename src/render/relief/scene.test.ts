import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { ProductStyle } from '../../model/types'
import { baseProfile, capGeometry, reliefParamsOf } from './heightField'
import { buildTackHead, buildWellGeometries, WELL_DEPTH_PER_HOLE_R } from './scene'

describe('open-top tack head', () => {
  it('stays inside the cap and the opening for every open-top style and size', () => {
    for (const style of ['open-top', 'open-top-concave'] as ProductStyle[]) {
      for (const D of [12, 14, 17, 20, 27]) {
        for (const frac of [0.25, 0.38, 0.5]) {
          const p = reliefParamsOf({
            diameterMM: D,
            holeDiameterMM: Math.round(D * frac * 10) / 10,
            product: 'button',
            style,
            material: 'brass',
            logoDisplay: 'embossed',
          })
          const lipBottom = capGeometry(p).lip?.cy ?? baseProfile(p.centreR, p).y
          const floorY = -p.capH * 0.97
          const geo = buildTackHead(p.centreR, lipBottom, floorY)
          geo.computeBoundingBox()
          const b = geo.boundingBox!
          const where = `${style} D${D} hole ${frac}`
          // above the dark floor it sits over (under it, only the crown showed through)
          expect(b.min.y, where).toBeGreaterThan(floorY)
          // within the opening, so it can never cut the rolled lip
          expect(b.max.x, where).toBeLessThan(p.centreR)
          // and below the face
          expect(b.max.y, where).toBeLessThan(0)
        }
      }
    }
  })
})

describe('open-top well (tack tip)', () => {
  it('lines the opening, runs deep below the cap, and keeps the tip on its floor', () => {
    for (const style of ['open-top', 'open-top-concave'] as ProductStyle[]) {
      for (const D of [12, 17, 27]) {
        const p = reliefParamsOf({ diameterMM: D, holeDiameterMM: Math.round(D * 0.38 * 10) / 10, product: 'button', style, material: 'brass', logoDisplay: 'embossed' })
        const lipBottom = capGeometry(p).lip?.cy ?? baseProfile(p.centreR, p).y
        const floorY = -(p.capH + WELL_DEPTH_PER_HOLE_R * p.centreR)
        const w = buildWellGeometries(p.centreR, lipBottom, floorY)
        const box = (g: THREE.BufferGeometry) => (g.computeBoundingBox(), g.boundingBox!)
        const where = `${style} D${D}`
        // inside the opening (can't cut the lip), and the ground mask matches the sleeve
        for (const g of [w.sleeve, w.floor, w.tip]) expect(box(g).max.x, where).toBeLessThan(p.centreR)
        expect(w.radius, where).toBeLessThan(p.centreR)
        // the sleeve starts under the lip and reaches below the cap (the well is deep)
        expect(box(w.sleeve).max.y, where).toBeLessThanOrEqual(lipBottom)
        expect(box(w.sleeve).min.y, where).toBeLessThan(-p.capH)
        // the tip sits on the floor, inside the well
        expect(box(w.tip).min.y, where).toBeGreaterThanOrEqual(floorY)
        expect(box(w.tip).max.y, where).toBeLessThan(lipBottom)
      }
    }
  })
})
