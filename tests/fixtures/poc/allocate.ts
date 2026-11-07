//@ contract Allocate a nonnegative total between two accounts without losing units.
//@ requires total >= 0n
//@ requires first >= 0n && first <= total
//@ ensures \result >= 0n
//@ ensures first + \result === total
export function remainder(total: bigint, first: bigint): bigint {
  return total - first;
}
