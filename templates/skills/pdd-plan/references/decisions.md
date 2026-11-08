# 判断入力の形式

`.pdd/decisions.yaml`は任意の作者入力です。initやplanは自動作成しません。以下は形式の例で、仕様の推奨値・合意・本人承認ではありません。要件IDと根拠は実際のプロジェクトに置き換えてください。

```yaml
schemaVersion: 1
decisions:
  - id: QUESTION-001
    group: session
    kind: human-specification
    requirementIds: [REQ-001]
    state: open
    question: セッションの有効期間をどこまで認めるか
    recommendation: 利用条件を確認して短い期間を選ぶ案
    alternatives:
      - label: 短い期間
        tradeoff: 再認証の負担が増える
      - label: 長い期間
        tradeoff: 失効までの時間が長くなる
    impact: 認証境界と利用者の操作
    blocking: true
    evidence:
      - file: src/domain/session.ts
        line: 1
```

## 分類と回答

- `kind`は`human-specification` / `fact` / `implementation`。前者だけを人向けCardへまとめ、後者2つは開発側へ返します。分類自体は作者の記録で、AIが業務上の所有者を認定した結果ではありません。
- 同じ`group`の質問を1枚にまとめます。質問・推奨・代替2〜5件・影響・根拠は実際に把握した内容だけ記録し、不明な値を架空に補完しません。
- `state`は`open` / `answered`。`answered`には`answer`文字列が必要です。これは作者の回答記録で、認証済み本人承認ではありません。
- 未決の仕様判断は、`blocking: true`または参照要件のriskがhighなら検証を止めます。low/mediumの非blocking質問はOPENのまま残せます。依存する実装の可否はユーザーの実際の許可と仕様確認で判断します。

## 鮮度と制限

入力は最大256KiB・100件。ID・要件参照の重複、不明field、架空のapproved fieldは拒否します。根拠は通常のプロジェクト内相対パスと実在する行で、シンボリックリンクを辿りません。UTF-8の通常ファイル1MiB以内、最大200ファイル・合計8MiBです。

回答・対象要件・根拠の変更は仕様の鮮度へ反映されます。変更を含む対象要件はrevisionを上げ、再検証・外部本人レビューを行ってください。レジストリから質問を削除しても、過去の証拠や承認を新しい入力へ流用できません。

planは読み取り専用です。回答を採用する変更も作者が明示的に行い、検証・本人承認の正本を勝手に更新しないでください。
