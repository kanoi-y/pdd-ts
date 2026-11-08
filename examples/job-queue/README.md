# ジョブキューの有限状態検査

1ジョブ・2 worker・最大2試行の例です。DBはローカルSQLite。モデル検査は本番コードの証明ではありません。

## 実行

サンプルのSQLiteテストはNode 24.14.1で確認します。CLI本体のmodel-checkは追加プロセスやSQLiteを起動しません。

```sh
pnpm build
node dist/cli/main.js model-check --project examples/job-queue --model model.json --json
node dist/cli/main.js verify --project examples/job-queue
```

`model-check`はモデルだけ、`verify`はモデル検査と実際のSQLiteテストを別の必須Evidenceとして実行します。手元の成功は`trial`で、本人承認ではありません。

## 検査すること

- 同じジョブの実行中worker数が1以下。
- 実行試行数がmaxAttempts以下（初回を含む）。
- 非終端状態に後続操作がなくなるデッドロックがない。
- 公平性なし。幅優先で全到達状態を探索し、状態数・深さ・遷移数・1秒の上限で未探索が残ればunknown。

`model.json`のclaimを`split-read-write`にしたコピーは、2 workerのread→startが交差する反例を返します。recoveryをfalseにすると、worker停止後のデッドロックを返します。元ファイルを変更すると証拠はstaleになり、新しい仕様revisionとレビューが必要です。

## モデルと実装

[mapping.json](mapping.json)は、モデルの操作と[src/queue.ts](src/queue.ts)を対応付けた作者の説明です。対応表と実装入力のハッシュを仕様・証拠へ結び付けますが、意味保存を証明するものではありません。

- claim：条件付きUPDATEを1文で実行し、状態と試行数を同時更新。
- complete/fail：workerとattemptの両方が一致するときだけ更新。
- crash/recover：**実際にworkerが停止したことを呼出側が確認した場合だけ**使う。単なるlease期限切れで生存workerを再投入するモデルではない。
- retry：失敗かつ試行上限未満の場合だけ再投入。

実テストは独立接続・2 workerによる競合、古いattemptの拒否、失敗→再試行→停止→復旧の観測トレースとモデルの一致を確認します。トレース照合は観測した操作列だけの証拠です。

## 保証しないこと

- 無限実行で最終的に成功すること、任意のworker数・ジョブ数。
- ネットワーク分断・生存確認・本番DBや外部APIの正しさ。
- 外部副作用がexactly-onceであること、lease期限後の旧workerの停止。

SQLiteの原子的更新と、停止確認を信頼する境界として登録しています。モデルに含めていない本番条件を、この結果から推測しません。
