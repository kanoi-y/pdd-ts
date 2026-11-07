/** The pinned verifier's text format is an external protocol; reject incomplete parses. */
export function evaluateDafnyLog(text: string, expectedMember: string): 'verified' | 'failed' | 'unknown' {
  const headers = [...text.matchAll(/^Results for /gm)];
  const rows = [...text.matchAll(/^Results for (.+?) \([a-z-]+\)\r?\n\s+Overall outcome: (\S+)/gm)];
  if (!rows.length || headers.length !== rows.length || !rows.some(row => row[1] === expectedMember)) return 'unknown';
  if (rows.some(row => row[2] !== 'Correct')) return 'failed';
  return 'verified';
}

export function evaluateDafnyAudit(text: string): 'clean' | 'findings' | 'unknown' {
  const summaries = [...text.matchAll(/^Dafny auditor completed with (\d+) findings\r?$/gm)];
  if (summaries.length !== 1) return 'unknown';
  return summaries[0]![1] === '0' ? 'clean' : 'findings';
}
