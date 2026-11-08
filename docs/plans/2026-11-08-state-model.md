# Phase 5残件・Phase 6 実装計画

> 実装はexecuting-plans。既存codexブランチを再利用し、最後に独立レビュー。

**目的:** 高リスクレビューに必要な確認点を示し、ジョブキューの有限状態モデルを検査して、反例と実装との対応を説明する。

**仕様:** 統合実装計画§6・Phase5/6・Example C。ユーザーはPhase5/6の実装完了を指示。比較試用は後日。

## 設計判断

- 最初のAdapterは組込み`job-queue-v1`。1ジョブ、2–4 worker、1–5実行試行の有限モデルを幅優先で検査する。一般的な分散システムや任意TSを検証するDSLは作らない。
- 原子的claimと、read/writeを分離した危険なclaimをモデル化。完了・失敗・再試行・worker停止・復旧を含め、同時実行数、試行上限、非終端デッドロックを検査する。
- 状態/深さ/遷移/時間の上限到達はunknown。全到達状態の閉包を確認したときだけpassed。公平性なし、安全性と到達可能デッドロックのみ。最終的成功・外部副作用のexactly-onceを主張しない。
- `modelTargets`は任意設定。モデルJSONとモデル→実装対応ファイルを仕様ダイジェスト・revision・証拠入力に結び付ける。既存プロジェクトの未指定時の仕様ダイジェストは維持する。
- 結果は既存model-check Evidenceとしてverify/report/reviewへ統合。反例は最短の操作列、図は固定ラベル。コードのProofと混同しない。
- サンプルのSQLite条件付き更新と再試行を実際に動かし、観測トレースがモデルの遷移と一致するか検査する。対応表の存在や有限トレースの一致は、実装全体の証明ではない。
- 外部汎用検査器は導入負荷と追加の実行権限を増やすため今回採用しない。必要性が生じたら別Adapterとする。

## Review Focus

- 探索上限と反例の優先順位、深さ上限で未探索後続が残る場合は成功にしない。
- 非原子的claimで同じジョブを2 workerが取得する実行列を検出する。
- model/mapping/実装入力の変更・削除・リンク・不正JSON・未知fieldは偽の成功を作らない。
- traceの初期状態・action・worker・全状態が一致しなければ拒否。単なる部分一致を採用しない。
- 高リスク案内やAtlas未指定を検証成功として表現しない。

## 作業

1. [x] `tests/integration/model.test.ts`でCLIのunknown commandをRED確認。検査器の正例・二重取得・デッドロック・上限・入力拒否をテストから実装。
2. [x] `src/model/{queue,adapter}.ts`、config・snapshot・diff・runsへEvidence統合。実CLIで成功、反例、stale、未決停止を確認。
3. [x] SQLiteジョブ例・モデル/実装対応表・トレース照合を追加。独立接続による競合と上限/復旧を検証。
4. [x] Phase5の高リスクレビュー深度とAtlas比較案内をreport/Skillに追加。既存の仕様・承認ゲートは維持。
5. [ ] 必須検証に新テスト/入力を登録しrevision更新。全体check・実配布・独立レビュー・簡潔な日本語PR（操作→実結果）まで完了する。

## 完了の区別

実装・機械検証と、人の効果評価・外部本人承認は別。人の試用結果や承認を代作しない。信頼済みmainは新Adapterを未搭載のため、今回rootの必須検証は従来のtest種類で新機能を実行し、サンプルでmodel-checkの実ゲートを検証する。保護CIの基準コードを差し替えたり迂回したりしない。

## 実行結果

- 最初のCLI3件は未知のmodelオプションで実際にRED。その後、Adapter3件・trace CLI・高リスクCard・doctor・成果物保存/欠落の回帰を実際にRED→GREEN。SQLiteの最初の未作成module読み込みエラーとcorepack権限エラーは、振る舞いのREDとは数えない。
- 独立レビューで成果物保存EEXIST後にpassedが残る問題を再現。catchのerror化、結果ファイルの必須化・現在モデル/完了条件との照合で修正。不要なDafnyを要求するdoctorも、登録したbackendだけの診断へ修正。
- 初回の必須登録は共有配列からYAML aliasを生成し、既存の厳密パーサが拒否。配列を複製し、パーサを緩めず修正。途中のwhole実行はこの不具合と修正前doctorで失敗し、最終版で再検証。
- 最終whole: 280/280・24ファイル・型チェック/ビルド成功（84.17秒）。既存258件・22ファイルは保持し、新規22件を独立した必須単位に登録。4単位すべて151入力、worker100秒/外側120秒、ソース契約/保護ゲートは維持。
- 独立レビュー: 48/48・型チェック成功、残るImportant/Criticalなし。全15パラメータの正常/二重実行/デッドロック計45モデル検査、反例30本の再生一致。
- 実配布: offline tarball導入、scan/init/plan/5 Skill/model-check、既存Hono・金額配分・ジョブキュー・自身のverify成功。3ソース証明と各24/34/3/280テスト。ジョブキューのmodel-checkは別Evidence、ローカル実行はtrial/pending。
- 実操作: 12状態19遷移の正常閉包、4操作での同時二重実行、取得→停止のdeadlock、1状態上限のunknown、SQLite競合の1成功/1null、観測6状態のtrace一致。公開記録は`docs/evidence/phase6-behavior.json`。
- 既存pdd-review Skillは必要なreview/previous/高リスク差分の手順をすでに持つため再利用。新しいSkillの効果評価や自動選択の成功を主張しない。
- 新しいPRの通常CIと本人承認・保護CIは別途。比較試用の負担改善は未評価。
