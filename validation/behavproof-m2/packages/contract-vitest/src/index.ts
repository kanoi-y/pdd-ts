import { test, expect } from "vitest";
import { hash } from "@behavproof/core";
export type ContractDefinition<I = unknown, E = unknown> = {
  id: string;
  intent: string;
  risk: "basic" | "standard" | "critical";
  cases: readonly { id: string; input: I; expected: E; negative?: boolean }[];
};
export function defineContract<const T extends ContractDefinition>(
  value: T,
): T {
  if (
    !value.id ||
    !value.intent ||
    !value.cases.length ||
    new Set(value.cases.map((c) => c.id)).size !== value.cases.length
  )
    throw Error("Invalid contract or duplicate case IDs");
  hash(value);
  return value;
}
type CaseOf<T extends ContractDefinition> = T["cases"][number];
export const contractTest = {
  each<T extends ContractDefinition>(
    contract: T,
    callback: (entry: CaseOf<T>) => unknown,
  ): void {
    const captured = structuredClone(contract);
    const revisionHash = hash({
      id: captured.id,
      intent: captured.intent,
      risk: captured.risk,
      cases: captured.cases,
    });
    const bindingHash = hash({
      scope: "runtime-function-string-v1",
      function: callback.toString(),
    });
    for (const entry of captured.cases) {
      const identity = {
        contractId: contract.id,
        caseId: entry.id,
        revisionHash,
        bindingHash,
        bindingScope: "runtime-function-string-v1",
        comparisonCount: 0,
        status: "unknown",
      };
      test(
        `${contract.id}: ${entry.id}`,
        { meta: { behavproof: identity } as {} },
        async ({ task }) => {
          const meta = (
            task.meta as typeof task.meta & { behavproof: typeof identity }
          ).behavproof;
          const actual = await callback(structuredClone(entry) as CaseOf<T>);
          meta.comparisonCount++;
          try {
            expect(actual).toEqual(entry.expected);
            meta.status = "pass";
          } catch (error) {
            meta.status = "fail";
            throw error;
          }
        },
      );
    }
  },
};
