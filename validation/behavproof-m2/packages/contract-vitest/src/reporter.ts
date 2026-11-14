import { writeFile } from "node:fs/promises";
import type { Reporter, TestModule } from "vitest/node";
export default class BehavProofReporter implements Reporter {
  private registrations = new Map<string, Record<string, unknown>[]>();
  onTestModuleCollected(module: TestModule): void {
    const rows = Array.from(module.children.allTests()).flatMap((t) => {
      const row = (t.meta() as { behavproof?: Record<string, unknown> })
        .behavproof;
      if (!row) return [];
      return [
        {
          contractId: row.contractId,
          caseId: row.caseId,
          revisionHash: row.revisionHash,
          bindingHash: row.bindingHash,
          bindingScope: row.bindingScope,
          comparisonCount: row.comparisonCount,
          status: row.status,
          testId: t.id,
        },
      ];
    });
    this.registrations.set(module.id, rows);
  }
  async onTestRunEnd(modules: ReadonlyArray<TestModule>): Promise<void> {
    const output = process.env.BEHAVPROOF_REPORT;
    if (!output) return;
    const files = modules.map((m) => m.moduleId).sort();
    const suites = modules.flatMap((m) => [
      m.id,
      ...Array.from(m.children.allSuites(), (s) => s.id),
    ]);
    const tests = modules.flatMap((m) => Array.from(m.children.allTests()));
    const contracts = tests.flatMap((t) => {
      const row = (t.meta() as { behavproof?: Record<string, unknown> })
        .behavproof;
      if (!row) return [];
      return [{ ...row, testId: t.id, testState: t.result().state }];
    });
    await writeFile(
      output,
      JSON.stringify({
        schemaVersion: 1,
        inventory: {
          suiteCount: suites.length,
          testCount: tests.length,
          files,
          suiteIds: suites,
          testIds: tests.map((t) => t.id),
        },
        registrations: modules.flatMap(
          (m) => this.registrations.get(m.id) ?? [],
        ),
        contracts,
      }) + "\n",
    );
  }
}
