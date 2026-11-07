//@ contract Evidence acceptance requires all six independent checks.
//@ ensures \result === (complete && scoped && successful && fresh && authentic && approved)
export function canAcceptEvidence(
  complete: boolean,
  scoped: boolean,
  successful: boolean,
  fresh: boolean,
  authentic: boolean,
  approved: boolean,
): boolean {
  return complete && scoped && successful && fresh && authentic && approved;
}
