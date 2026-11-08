---
name: pdd-implement
description: Use when implementing a small change in a project with registered PDD requirements and source contracts.
---
# 承認された仕様を保って実装する

## 入力と正本

対象要件・ソース契約・必須検証と、ユーザーが許可した変更範囲を確認する。CLIは利用環境のpdd-tsを使う。

## 手順と成果物

1. `pdd-ts plan --project <対象> --json` で依存する未決事項を確認する。高リスクの未決事項は解消してから進める。
2. 小単位の変更と受け入れテストを用意し、実際の失敗を確認してから修正する。
3. `pdd-ts verify --project <対象> --json` と `pdd-ts review --project <対象>` で実結果を確認する。
4. 失敗は原因・変更・再検証結果を残す。あらかじめ決めた試行回数・予算に達したら失敗を隠さず返す。

## 禁止と完了条件

合格のための契約・要件・仮定の弱化、必須テスト削除、CIスキップ、本人承認の代行は禁止。仕様変更が必要なら理由と影響を示す。完了時は変更内容、実行した検証、未確認事項を報告する。独自の実装ループや外部送信をこのSkillだけで許可しない。
