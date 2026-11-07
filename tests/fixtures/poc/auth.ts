//@ contract Issue only when the caller is an administrator and authenticated.
//@ ensures \result === (role === "admin" && passwordOk)
export function canIssueAdminToken(role: "admin" | "user", passwordOk: boolean): boolean {
  return role === "admin" && passwordOk;
}
