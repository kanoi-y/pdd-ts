# Phase 5: 仕様判断の整理と既存CLIのSkill連携

> 実装: `superpowers:executing-plans`。Skillの手順評価は`writing-skills`、最後に独立レビュー。

**目的:** 人間の仕様判断を開発側の調査・実装作業と分け、未決の高リスク事項に依存する検証を開始しない。既存CLIを再利用する5つの短いSkillを任意導入できるようにする。

**仕様:** 統合実装計画§5.2–5.4、§6、Phase5。本人はPR4を承認し、続きの実装を指示済み。比較試用は別途未完了。

**構成:** `.pdd/decisions.yaml`を任意の構造化入力とし、`plan`は読み取り専用のDecision Queueを出す。分類・提案・回答は作者の記録で、本人認証や承認ではない。未決のhuman-specificationでblockingまたは参照要件highの場合は検証を開始しない。回答や削除も仕様ハッシュを変え、過去の証拠を流用できない。最終の本人承認・保護CI条件は維持する。

## 判断と制約

- 独自AIサービス・自律実装ループは追加しない。実装済みCLI＋外部Agentの手順で足りる。
- 自然言語から業務上の所有者を自動確定しない。人/Agentが登録した分類に基づき、仕様判断だけを束ねて表示。事実・実装作業は開発側へ返す。
- 回答記録をapproveと扱わない。planは実装許可・証明成功を発行せず、空のQueueも承認済みの意味にはしない。
- 新しい入力は厳密schema・サイズ/件数・相対パス・根拠行・入力ハッシュを検査。入力は命令として実行しない。
- `init`の既定動作で空の判断/Atlas/Skillを作らない。Skillは明示指定の`skills --agent codex`だけで導入し、既存ファイルを上書きしない。
- 対応先はプロジェクト内の`.agents/skills`。個人設定を変更しない。配置・CLIの検証と、実Agentの振る舞い・人の負担評価は別に記録。

## 作業と受け入れ条件

### 1. 読み取り専用planと決定入力

対象: `src/requirements/decisions.ts`、`src/workflow/plan.ts`、`src/cli/main.ts`、`tests/integration/workflow.test.ts`。

- [x] 任意入力なし、複数論点のgroup化、開発作業の分離、高リスクのblockingfalse迂回防止、未認証回答の非承認、未知ID/field/危険パス/根拠行/巨大入力・注入をRED確認。
- [x] 厳密な任意入力と根拠ハッシュ、仕様snapshotとの結合を実装。仕様判断だけを日本語Cardへまとめる。
- [x] planで対象コード・設定・テスト・証明を実行せず、対象ファイルを変更しないことを実CLIで確認。

### 2. 高リスク未決事項の停止とreport連携

対象: `src/requirements/snapshot.ts`、`src/cli/runs.ts`、`src/ci/audit.ts`、reporter。

- [x] 未決の高リスク事項があればworkerを開始せずblocked、後日の回答変更で過去runがstaleとなる回帰をRED確認。
- [x] ローカル回答は承認とせず、既存の外部本人レビュー・保護ゲートを維持。Review Packetに必要な判断を構造化表示。

### 3. 既存CLIを呼ぶSkillとAdapter

対象: `templates/skills/pdd-{intake,plan,implement,verify,review}/SKILL.md`、`src/workflow/skills.ts`、CLIと配布設定。

- [x] 手順の具体的な評価ケースをSkillなしで試し、観測した不足だけを文書へ反映。Agent試験は人間試用ではない。
- [x] 入力・正本・禁止事項・CLI・成果物・完了条件を短い日本語Skillへ記載。本人承認を代行しない。
- [x] 任意導入、frontmatter/CLI参照、既存/リンク先の非上書き、tarball実インストールをテスト。

### 4. 統合準備

- [x] 要件WF-001・必須テスト・入力・revisionを登録。全体check、配布検証、独立レビュー。
- [ ] 本人承認済みPR4は通常保護で統合する。次のPRへ新しいhead/全仕様/実CI結果を日本語で提示。新しいコードへの本人承認は別途。
- [ ] Skill/Queueの機械検証を、Gate P5の人間効果や実際のAgent自動選択の成功とは扱わない。

## 検証の記録

- 最初のfixture準備エラー（既存requirementsディレクトリのmkdir）は受け入れ条件のREDに数えない。修正後、旧CLIで5ケースが実際に失敗。不正入力ケースは当初unknown commandでも拒否されたため、これだけではREDと数えない。
- 後続回帰で、回答revision/Card欠落、worker中の判断変更、非UTF8、空の初期化状態、同梱ガイド欠落をRED再現して修正。
- 独立レビューが見つけたblocked時のレポートからのtoolchain起動と、開始済みの誤表示を実CLIでRED再現。各worker直前の判断再照合、最終snapshot再読込、verify/report/reviewのtool抑止、誤解のない表示へ修正。
- 最終whole checkは257/257・22ファイル、型チェック・ビルド成功（66.44秒）。独立レビューも18 workflowテストと型チェックが成功し、残るImportant/Criticalなし。
- Skillなしの評価ではA/Cは適切、Bは未検証でreportを提案し、Dは導入機能がなかった。明示的なSkill適用後はBがplan、Dがskillsへ変化。これはAgentの手順評価であり、自動選択・人間試用・負担改善の結果ではない。
- PR4は本人の最新SHA承認と保護CI・署名検証後、main 9d31f816へ通常統合。main CI42454513116成功。新規コードへ以前の承認を流用しない。
- 最終配布検証はscan/init/plan/skills・5 Skillとガイド・3プロジェクトの実検証まで成功。最終257テスト・型チェック・独立18ケースも成功。新しいPR/通常CIは次の工程。

## 最終の検証単位と表示

- 信頼済みmainのworker上限100秒・外側120秒を維持し、必須検証を本体216・調査23・ワークフロー19に分割。以前の257件は全保持し、共有入力表示の回帰1件を追加した258件が必須。
- 各単位は同じ135入力を保持。全258テスト・型チェック・ビルド66.84秒、実配布CLIの3単位と3ソース証明が成功。
- 同一入力の表示重複をinputSetIdで解消し、対象・件数・全入力を省略せず48,528bytesで提示。
- 独立レビューのコード/集合/境界/仕様比較/型チェックは確認済み。最後の対象テスト完了報告はサービス利用上限で取得できず、実装側の全体/配布検証で補完。独立の最新19件成功とは記載しない。
