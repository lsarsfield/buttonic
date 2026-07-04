export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function downloadText(text: string, filename: string, mime: string): void {
  downloadBlob(new Blob([text], { type: mime }), filename)
}

export function safeFilename(name: string): string {
  const cleaned = name.trim().replace(/[^\w\d-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned.length > 0 ? cleaned.toLowerCase() : 'button'
}
