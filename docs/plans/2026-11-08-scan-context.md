# scan設定・変更履歴調査の実装計画

> 実装担当: `superpowers:executing-plans`で実施し、最後に独立レビューする。

**目的:** 実装計画§5.1の未対応だったtsconfig別名と変更頻度を、根拠・範囲・制限付きの調査へ追加する。

**構成:** tsconfigは収集済みJSONCのみを解析し、ローカルの標準名tsconfig継承からbaseUrl/pathsだけをメモリー内のAST解決へ適用する。Git履歴は`scan --history`の明示指定だけで、既存の制限付きプロセス実行を使う。普段のscanはGit不要。

**使用技術:** 既存ts-morph/TypeScript、Node filesystem、Git、Vitest。追加依存なし。

**仕様:** `docs/PDD_for_TypeScript_統合実装計画.md` §5.1・Phase4、および前段の`2026-11-08-architecture-scan.md`。

## 制約と設計判断

- 本人が「後で確認するので続きを」と指示したため、未承認PR #4へ追加する。承認・合格を偽造せず、main保護は維持する。
- 全tsconfigをそのまま適用する方法は採らず、標準名`tsconfig*.json`の局所継承とbaseUrl/pathsのみを扱う。project外、外部パッケージ継承、循環、読めない設定は未解決として表示し、部分設定から参照先を断定しない。
- Gitは初期化・ネットワーク・fetch・index更新を行わない。global/system設定、pager、fsmonitor、署名表示、外部diff/textconvを無効化し、シェルを使わない。履歴は最近100件のfirst-parentに限定し、浅い履歴・打切り・失敗を表示する。
- 変更頻度は調査したファイルに関する観測。重要度・欠陥リスク・所有者承認や試用効果へ昇格しない。
- 比較試用、業務上の重要3フローの確定、ドメイン責務や完全な実行時フローは未評価のまま残す。

## レビュー重点

- 継承元のディレクトリを基準にしたpathsと、子設定のbaseUrl上書き。
- 継承循環・範囲外パス・壊れたJSONCで、既存の未解決を隠さない。
- Gitの未導入・unborn・shallow・サブディレクトリ・未追跡ファイル・100件超を正しく限定。
- 未信頼のGit設定からコマンドが実行されず、Git調査が対象を変更しない。
- 保存結果の比較は範囲変更を区別し、履歴を証明やゲートへ昇格しない。

## 作業

### 1. 設定の読み取りと別名import

対象: `src/analysis/configuration.ts`（新規）、`src/analysis/scan.ts`、`src/analysis/atlas.ts`、`tests/integration/scan.test.ts`。

- [x] 標準名ローカル継承、JSONC、子baseUrl上書き、循環・外部・範囲外、非実行をテストしRED確認。
- [x] `readScanConfiguration(files): {metadata, compilerOptions, issues}` を追加。ファイル/継承/別名件数を制限し、読んだ設定を相対パスと入力ハッシュへ関連付ける。
- [x] メモリー内Projectへ限定設定を渡し、相対/別名のローカル参照を根拠付きで解決。外部依存と未解決を区別。
- [x] 焦点テストGREEN確認。

### 2. 任意のGit履歴

対象: `src/analysis/history.ts`（新規）、`src/cli/main.ts`、`src/analysis/atlas.ts`、`tests/integration/scan.test.ts`。

- [x] 実Git fixtureでopt-in、変更件数、サブディレクトリ、unborn/非Git、危険な設定の非実行・非改変、打切りをテストしRED確認。
- [x] `scanHistory(root, observedFiles): Promise<ScanHistory>` を追加。headとfirst-parent100件・shallow・入力整合性を記録。shallowでは頻度を保留し、promisor設定のある部分cloneはオブジェクト読み取り前に拒否する。各Gitプロセスは3秒/1MiB以内。失敗・不完全を明示する。
- [x] `--history`はscan専用。JSON/日本語Atlasへ観測と制限を表示し、ゲートには渡さない。
- [x] 焦点テストGREEN確認。

### 3. 検証・統合準備

- [x] SCAN-001要件・必須テスト・入力・既存要件revisionを更新。
- [x] 全体check、実Honoの走査前後バイト比較、配布用CLIの確認。
- [x] 独立レビューの指摘を再現・修正し、必要な最終再検証。
- [ ] 通常pushでPR #4を更新。日本語の見出し・チェックリスト・図と、最新head・実CI結果を同期。本人承認は後日に残す。

Gitの転送許可とlazy fetch抑止は[公式Git文書](https://git-scm.com/docs/git)を参照。古いGitでは抑止環境変数だけに依存せず、promisor設定を先に拒否し、転送プロトコルの許可リストを空にする。

## 検証結果

- 最終239テスト・型チェック・ビルドが成功（56.63秒）。独立レビューで23 scanテストと型チェックが成功し、残るImportant/Criticalなし。
- 指摘されたファイル名による偽コミット混入と、pathsだけの設定による偽baseUrl解決は、RED再現後に修正。新しいパーサーはraw記録とパス名を区別し、別名は仮想絶対パスで対応付ける。
- 配布パッケージの実scan/JSONC別名/任意historyと、3プロジェクトの実検証が成功。ローカル成功はdirty trial・本人承認pendingのまま。
- Honoの174ファイルと、Git HEAD/index/config/HEADログの走査前後バイトが一致。履歴は限定した3コミットを観測。
- PR更新後の通常CIと、後日の本人レビュー・保護CIは別途必要。人への効果は未評価。
