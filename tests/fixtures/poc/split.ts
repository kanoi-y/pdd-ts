type Shares = { first: bigint; second: bigint };

//@ contract Clamp the first share to the available total and preserve every unit.
//@ requires total >= 0n
//@ requires requested >= 0n
//@ ensures \result.first >= 0n && \result.second >= 0n
//@ ensures \result.first + \result.second === total
export function split(total: bigint, requested: bigint): Shares {
  if (requested > total) {
    return { first: total, second: 0n };
  }
  return { first: requested, second: total - requested };
}
