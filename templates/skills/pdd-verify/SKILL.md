---
name: pdd-verify
description: Use when running PDD verification or checking the scope freshness and omissions of existing evidence.
---
# 検証と証拠を確認する

## 入力と正本

信頼して実行できる対象プロジェクト、固定CLI、必要な検証ツール。登録要件・ソース契約・obligations・信頼境界を正本として読む。

## 手順と成果物

1. `pdd-ts plan --project <対象> --json` で未決事項を確認し、阻害事項があればworkerを開始しない。
2. `pdd-ts doctor --project <対象> --json` は設定確認。現在の証拠や本人承認の成功に読み替えない。
3. `pdd-ts verify --project <対象> --json` の終了コード、欠落・skip・stale・unknown・前提を確認する。
4. `pdd-ts report --project <対象>` で現在の入力と証拠を照合する。証拠のファイル・入力ハッシュ・runを保持する。

## 禁止と完了条件

ローカル成功はtrial。Source proof / Test / Trusted Boundary / Unverifiedを分ける。0件・skip・欠落を成功とせず、出力の成功文だけを信用しない。実際の検証結果と保証範囲を提示したら完了。本人承認や保護CIは別の認証済み確認が必要。
