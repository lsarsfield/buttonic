import { describe, expect, it } from 'vitest'
import type { ProductStyle } from '../../model/types'
import { baseProfile, capGeometry, reliefParamsOf } from './heightField'
import { buildTackHead } from './scene'

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
