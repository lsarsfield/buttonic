import type { ParsedSvgAsset } from '../geometry/svgAsset'
import type { AssetId, ButtonDoc } from '../model/types'
import { newId } from '../model/types'
import { useEngraver } from '../state/store'
import { base64ToBuffer, bufferToBase64 } from './base64'
import { importSvg, type ImportReportItem } from './svgImport'

/**
 * SVG asset registry: raw file text lives base64 in doc.assets (portable
 * projects); parsed geometry lives in this runtime cache. assetsRevision
 * bumps when a parse lands so dependent layers recompile.
 */

const cache = new Map<AssetId, ParsedSvgAsset>()
const reports = new Map<AssetId, ImportReportItem[]>()
const errors = new Map<AssetId, string>()
const attempted = new Set<AssetId>()

export function getSvgAsset(assetId: AssetId): ParsedSvgAsset | null {
  return cache.get(assetId) ?? null
}

export function getSvgReport(assetId: AssetId): ImportReportItem[] {
  return reports.get(assetId) ?? []
}

export function getSvgError(assetId: AssetId): string | null {
  return errors.get(assetId) ?? null
}

/** Idempotent parse of a doc-embedded SVG asset (e.g. after project load). */
export function ensureSvgParsed(assetId: AssetId, doc: ButtonDoc): void {
  if (!assetId || attempted.has(assetId)) return
  const asset = doc.assets[assetId]
  if (!asset || asset.kind !== 'svg') return
  attempted.add(assetId)
  try {
    const text = new TextDecoder().decode(base64ToBuffer(asset.dataBase64))
    const result = importSvg(text)
    if (result.ok) {
      cache.set(assetId, result.asset)
      reports.set(assetId, result.report)
    } else {
      errors.set(assetId, result.error)
    }
  } catch (e) {
    errors.set(assetId, e instanceof Error ? e.message : String(e))
  }
  useEngraver.getState().bumpAssetsRevision()
}

export async function uploadSvg(
  file: File,
): Promise<{ ok: true; assetId: AssetId; report: ImportReportItem[] } | { ok: false; error: string }> {
  const text = await file.text()
  const result = importSvg(text)
  if (!result.ok) return { ok: false, error: `${file.name}: ${result.error}` }
  const assetId = `svg-${newId()}`
  cache.set(assetId, result.asset)
  reports.set(assetId, result.report)
  attempted.add(assetId)
  const state = useEngraver.getState()
  state.updateDocAssets({
    [assetId]: {
      kind: 'svg',
      name: file.name,
      dataBase64: bufferToBase64(new TextEncoder().encode(text).buffer as ArrayBuffer),
    },
  })
  state.bumpAssetsRevision()
  return { ok: true, assetId, report: result.report }
}

export function svgAssetOptions(doc: ButtonDoc): { value: string; label: string }[] {
  return Object.entries(doc.assets)
    .filter(([, a]) => a.kind === 'svg')
    .map(([id, a]) => ({ value: id, label: a.name.replace(/\.svg$/i, '') }))
}
