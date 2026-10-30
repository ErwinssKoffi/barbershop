/**
 * Export CSV compatible Microsoft Excel / Apple Numbers en français
 * (UTF-8 avec BOM + séparateur point-virgule `;`).
 */

function escapeCsvCell(val: string | number | null | undefined): string {
  const raw = val === null || val === undefined ? '' : String(val)
  if (raw.includes(';') || raw.includes('"') || raw.includes('\n')) {
    return `"${raw.replace(/"/g, '""')}"`
  }
  return raw
}

export function downloadCsvFile(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
): void {
  const lines = [
    headers.map(escapeCsvCell).join(';'),
    ...rows.map((row) => row.map(escapeCsvCell).join(';')),
  ]
  const csvContent = `\uFEFF${lines.join('\r\n')}`
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
