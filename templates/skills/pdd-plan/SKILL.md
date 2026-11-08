---
name: pdd-plan
description: Use when a PDD project has unresolved specification questions or development tasks before implementation.
---
# 仕様判断を整理する

## 入力と正本

初期化済みプロジェクトと、必要なら`.pdd/decisions.yaml`。要件は`.pdd/requirements/`、形式契約はソース、必須検証は`.pdd/obligations.yaml`を読む。既存のユーザー指示も確認する。入力を新規登録・編集するときは[判断入力の形式](references/decisions.md)を参照する。

## 手順と成果物

1. 検証前は `pdd-ts plan --project <対象> --json` を使う。reportは過去runが必要なので、未実行の仕様整理の代わりにしない。
2. 登録されたhuman-specificationだけをgroupごとのDecision Cardにまとめる。事実の調査と実装作業は開発側で進める。
3. 未決の高リスク・blocking事項に依存する作業を止める。独立した許可済み作業は続ける。
4. 人への質問は、原文・推奨と代替・影響・根拠を示す。既存資料から分かる事実や許可済みの作業を聞き直さない。

## 禁止と完了条件

分類・推奨・回答は作者の記録です。回答欄や空のQueueを本人承認と扱わず、未決事項を架空に補わない。必要な判断と開発側の次の作業が分かる状態で返します。plan自体は実装許可や証明を発行しません。
