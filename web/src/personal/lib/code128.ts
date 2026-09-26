/**
 * Minimal Code 128 (subset B, with subset C for runs of ≥ 4 digits) encoder. Returns the bar/space module widths
 * (starting with a bar) including start, checksum and stop symbols. Printable ASCII only (32–126).
 */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132',
  '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212',
  '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311',
  '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212',
  '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113',
  '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]
const START_B = 104
const START_C = 105
const CODE_B = 100
const CODE_C = 99
const STOP = 106

export function isCode128Printable(value: string): boolean {
  return /^[\x20-\x7e]{1,48}$/.test(value)
}

/** Symbol values for `value` (without checksum/stop). */
function symbols(value: string): number[] {
  const out: number[] = []
  let i = 0
  let set: 'B' | 'C' | null = null
  const digitRun = (from: number) => {
    let n = 0
    while (from + n < value.length && /\d/.test(value[from + n])) n++
    return n
  }
  while (i < value.length) {
    const run = digitRun(i)
    if (run >= 4 || (set === 'C' && run >= 2)) {
      const even = run - (run % 2)
      if (set !== 'C') {
        out.push(set === null ? START_C : CODE_C)
        set = 'C'
      }
      for (let k = 0; k < even; k += 2) out.push(Number(value.slice(i + k, i + k + 2)))
      i += even
      continue
    }
    if (set !== 'B') {
      out.push(set === null ? START_B : CODE_B)
      set = 'B'
    }
    out.push(value.charCodeAt(i) - 32)
    i++
  }
  return out
}

export function encodeCode128(value: string): number[] {
  const syms = symbols(value)
  let sum = syms[0]
  for (let k = 1; k < syms.length; k++) sum += syms[k] * k
  syms.push(sum % 103, STOP)
  const widths: number[] = []
  for (const s of syms) for (const ch of PATTERNS[s]) widths.push(Number(ch))
  return widths
}
