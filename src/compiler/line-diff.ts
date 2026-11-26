/** 逐行 unified diff（LCS），給人看候選 prompt 與現行 prompt 差在哪。 */

interface Op { kind: ' ' | '-' | '+', line: string }

function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array.from<number>({ length: m + 1 }).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const row = dp[i] ?? []
      row[j] = a[i] === b[j] ? (dp[i + 1]?.[j + 1] ?? 0) + 1 : Math.max(dp[i + 1]?.[j] ?? 0, row[j + 1] ?? 0)
    }
  }
  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: ' ', line: a[i] ?? '' })
      i++
      j++
    }
    else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      ops.push({ kind: '-', line: a[i++] ?? '' })
    }
    else {
      ops.push({ kind: '+', line: b[j++] ?? '' })
    }
  }
  while (i < n) ops.push({ kind: '-', line: a[i++] ?? '' })
  while (j < m) ops.push({ kind: '+', line: b[j++] ?? '' })
  return ops
}

export function unifiedDiff(before: string, after: string, labels: { from: string, to: string }, context = 3): string {
  const ops = lcsOps(before.split('\n'), after.split('\n'))
  const changed = ops.map((op, idx) => (op.kind === ' ' ? -1 : idx)).filter(idx => idx >= 0)
  if (changed.length === 0)
    return ''
  const out = [`--- ${labels.from}`, `+++ ${labels.to}`]
  let k = 0
  while (k < changed.length) {
    const first = changed[k] ?? 0
    let last = first
    while (k + 1 < changed.length && (changed[k + 1] ?? 0) - last <= context * 2) last = changed[++k] ?? last
    k++
    const start = Math.max(0, first - context)
    const end = Math.min(ops.length, last + context + 1)
    const before = ops.slice(0, start)
    const hunk = ops.slice(start, end)
    const aStart = before.filter(o => o.kind !== '+').length + 1
    const bStart = before.filter(o => o.kind !== '-').length + 1
    const aLen = hunk.filter(o => o.kind !== '+').length
    const bLen = hunk.filter(o => o.kind !== '-').length
    out.push(`@@ -${aStart},${aLen} +${bStart},${bLen} @@`)
    for (const o of hunk) out.push(`${o.kind}${o.line}`)
  }
  return `${out.join('\n')}\n`
}
