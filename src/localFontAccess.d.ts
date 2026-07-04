/**
 * Ambient types for the Local Font Access API (Chromium-only; not yet in
 * TypeScript's DOM lib). https://wicg.github.io/local-font-access/
 */

interface FontData {
  readonly family: string
  readonly fullName: string
  readonly postscriptName: string
  readonly style: string
  blob(): Promise<Blob>
}

interface Window {
  queryLocalFonts?(options?: { postscriptNames?: string[] }): Promise<FontData[]>
}
