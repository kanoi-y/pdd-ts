//@ requires x > 0n && x < 0n
//@ ensures \result === 42n
export function vacuous(x: bigint): bigint {
  return 0n;
}
