import type { Path } from 'opentype.js'
import type { Mat2d } from './mat2d'
import type { PathSeg } from './pathData'
import { segsToD, transformSegs } from './pathData'

/**
 * opentype.js Path → normalized segs / path data.
 *
 * getPath() already emits y-down SVG coordinates, so no axis flip happens
 * here. Quadratics are converted to cubics (exact) so every consumer — warp,
 * export, booleans later — deals with one curve type. Affine transforms of
 * bezier control points are exact, so glyph outlines stay true curves all the
 * way to the die file.
 */
export function opentypePathToSegs(path: Path): PathSeg[] {
  const segs: PathSeg[] = []
  let curX = 0
  let curY = 0
  for (const cmd of path.commands) {
    switch (cmd.type) {
      case 'M':
        segs.push({ type: 'M', x: cmd.x, y: cmd.y })
        curX = cmd.x
        curY = cmd.y
        break
      case 'L':
        segs.push({ type: 'L', x: cmd.x, y: cmd.y })
        curX = cmd.x
        curY = cmd.y
        break
      case 'C':
        segs.push({ type: 'C', x1: cmd.x1, y1: cmd.y1, x2: cmd.x2, y2: cmd.y2, x: cmd.x, y: cmd.y })
        curX = cmd.x
        curY = cmd.y
        break
      case 'Q': {
        // exact Q→C: c1 = p0 + ⅔(q − p0), c2 = p1 + ⅔(q − p1)
        const c1x = curX + (2 / 3) * (cmd.x1 - curX)
        const c1y = curY + (2 / 3) * (cmd.y1 - curY)
        const c2x = cmd.x + (2 / 3) * (cmd.x1 - cmd.x)
        const c2y = cmd.y + (2 / 3) * (cmd.y1 - cmd.y)
        segs.push({ type: 'C', x1: c1x, y1: c1y, x2: c2x, y2: c2y, x: cmd.x, y: cmd.y })
        curX = cmd.x
        curY = cmd.y
        break
      }
      case 'Z':
        segs.push({ type: 'Z' })
        break
    }
  }
  return segs
}

export function glyphPathD(path: Path, m: Mat2d): string {
  return segsToD(transformSegs(opentypePathToSegs(path), m))
}
