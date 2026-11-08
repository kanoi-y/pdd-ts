# pdd-ts

TypeScriptの要件・ソース内契約・証明・テスト・レビューを、追跡できる証拠としてまとめるCLIです。PDD Kitの考え方をTypeScriptプロジェクトで使うことが作成動機です。

LemmaScriptとDafnyによる**実際のTypeScriptソースの検証**を利用し、必須検証の欠落、前提条件、鮮度、承認、CI来歴を扱います。独自の契約言語やAIサービスは不要です。

## 試す

Node 22.12以上（検証環境は24.14.1）、pnpm 10.32.1、Git、unzipが必要です。Dafnyの自動導入はmacOS arm64/x64・Linux x64に対応します。

```sh
git clone https://github.com/kanoi-y/pdd-ts.git
cd pdd-ts
pnpm install --frozen-lockfile --ignore-scripts --store-dir .tools/pnpm-store
node scripts/install-dafny.mjs
pnpm build
pnpm check
node scripts/demo.mjs
```

依存関係のinstall scriptは実行しません。Dafnyは公式リリースをSHA-256照合して`.tools/`へ導入します。パッケージはまだnpmへ公開していません。`pnpm pack`によるローカルインストールを検証しています。

## 導入前に構造を調べる

`scan`は、対象プロジェクトを変更せずにTypeScriptの構造と根拠を調べます。対象側のPDD設定・Git・Dafnyは不要です。設定スクリプトやアプリ、テストは実行しません。tsconfigのJSONCはデータとして読みます。

```sh
node /path/to/pdd-ts/dist/cli/main.js scan --project /path/to/project
node /path/to/pdd-ts/dist/cli/main.js scan --project /path/to/project --json
```

日本語のArchitecture Atlasには、次の5つを含みます。JSONの`atlas.documents`から個別に保存できます。`scan`自身はファイルを作成しません。

- **概要**：調査範囲、入口・テスト・CIの記載、読み取れなかった対象。
- **構造と境界**：相対importの図、外部・動的呼び出しの候補と根拠。
- **フロー候補**：ルートの返却構文などから最大3件。重要度・実行順・到達性は未確認。
- **契約と検証候補**：ソースの契約コメント、呼び出し構文のない同期関数の候補。純粋性や証明可能性を判定した結果ではありません。
- **変更の波及**：静的な関数参照。実行時の全影響を保証しません。

### 変更前の調査と比較する

変更前のJSONを、調査対象から除外される`.pdd/`などへ自分で保存します。保存先のディレクトリは事前に用意してください。

```sh
node /path/to/pdd-ts/dist/cli/main.js scan --project /path/to/project --json > /path/to/project/.pdd/scan-before.json
# ソースを変更した後
node /path/to/pdd-ts/dist/cli/main.js scan --project /path/to/project --previous .pdd/scan-before.json
# 既存の検証レポートにも更新候補を添える
node /path/to/pdd-ts/dist/cli/main.js report --project /path/to/project --previous .pdd/scan-before.json
```

`--previous`は対象内の相対パスです。比較元は形式とハッシュの整合性を調べますが、過去の実行を認証するものではありません。不完全な調査や範囲の違う結果からは追加・削除を推定しません。Atlas更新候補は、仕様承認や検証ゲートの合否を変更しません。

### 調査の限界

通常のTS/TSXと、ルートのREADME・package.json、標準名のtsconfig JSONC、CI定義のファイルを対象にします。ルートtsconfigのローカル継承から、baseUrl/pathsだけをメモリー内の参照解決へ適用します。継承元の相対基準と子設定の上書きを区別し、設定の根拠ファイルも入力ハッシュへ含めます。

外部パッケージの継承、標準名以外の設定、循環やプロジェクト外の参照は未解決として表示します。tsconfigのpluginsや設定スクリプトは実行しません。実行時の別名解決、外部モジュール内部、業務上の重要度は未確認です。CI定義はファイルの存在とハッシュの観測です。シンボリックリンク・除外ディレクトリは辿りません。

1ファイル1MiB・合計16MiB・最大2,000ファイルなどの上限があります。構文エラーや制限超過は不完全な調査として表示し、終了コード1を返します。確認済みの構文・推測・未確認を分け、既存コードを正しい仕様として自動承認しません。

### 必要な場合だけ変更頻度を調べる

```sh
node /path/to/pdd-ts/dist/cli/main.js scan --project /path/to/project --history
```

`--history`を指定した場合だけ、インストール済みのGitを使います。対象ディレクトリを変更したfirst-parent履歴の最近100件と、その中で各調査ファイルが変更されたコミット数を表示します。基準コミットと打切りの有無を記録し、重要度や欠陥リスクの判定とは分けます。

Git未導入・未コミット・リポジトリ外では「取得できず」、浅い履歴では頻度を「不完全」とします。自動取得を避けるため、promisor設定のある部分cloneは調査しません。fetch・ネットワーク取得・index更新は行わず、各Gitプロセスは3秒・出力1MiBまでに制限します。Git設定によるpager・fsmonitor・外部diff等の補助コマンドは無効化します。

履歴を取得できなくても、静的なファイル調査とは別に状態を表示します。履歴は証明・本人承認・保護CIの根拠にしません。

## プロジェクトに導入する

```sh
node /path/to/pdd-ts/dist/cli/main.js init --project /path/to/project
node /path/to/pdd-ts/dist/cli/main.js doctor --project /path/to/project --json
node /path/to/pdd-ts/dist/cli/main.js verify --project /path/to/project
node /path/to/pdd-ts/dist/cli/main.js report --project /path/to/project --json
```

対象プロジェクトには初期Git commitが必要です。`init`は既存ファイルを上書きしません。`.pdd/config.yaml`に対象を、`.pdd/requirements/`に要件・契約への参照を、`.pdd/obligations.yaml`に必須検証を登録します。ソースの`//@ requires`・`//@ ensures`が形式仕様の正本です。設定の具体例は次の2つにあります。

- [Honoへの段階的導入](examples/existing-hono/README.md)：サーバー側の認証結果を検証するルートと純粋な認可判断。24ケース。
- [bigint金額配分](examples/greenfield-domain/README.md)：金額保存・非負性のソース証明と公開APIの入力検証。34ケース。

`verify`は対象コードのテストを実行します。ローカルでは信頼できるプロジェクトだけで実行してください。CIの候補テストは、ネットワーク・権限を制限した使い捨てコンテナーで動かします。

## 仕様の未決事項を整理する

初期化済みプロジェクトでは、検証前に`plan`で仕様判断と開発側の作業を整理できます。対象のコード・テスト・証明を実行せず、ファイルも変更しません。

```sh
node /path/to/pdd-ts/dist/cli/main.js plan --project /path/to/project
node /path/to/pdd-ts/dist/cli/main.js plan --project /path/to/project --json
```

任意の`.pdd/decisions.yaml`へ質問・推奨・代替・影響・根拠を登録します。[入力形式と制限](templates/skills/pdd-plan/references/decisions.md)を参照してください。分類は作者の記録で、自然言語から業務上の所有者を自動認定する機能ではありません。

- **人の仕様判断**：同じgroupの未決事項を1枚のDecision Cardへまとめます。
- **事実調査・内部実装**：開発側の作業として表示します。
- **高リスク・blockingの未決事項**：依存する作業を先に進めず、`verify`もworkerを開始しません。高リスク要件はblockingをfalseにしても停止します。
- **回答済み**：作者が回答を記録した状態です。本人承認にはしません。

回答・根拠は仕様ハッシュへ結び付けます。変更を含む要件はrevisionを上げ、再検証してください。検証中の仕様変更も終了時に読み直します。空のQueueや初期化だけで実装が許可されたことにはなりません。planの終了コードは0＝整理完了（承認ではない）、1＝未決の阻害事項・開発側の不足、2＝入力エラーです。

`review`は`report`と同じく、実在するrunと現在の入力を再照合して人向け資料を出します。検証前の仕様整理にはplanを使います。

```sh
node /path/to/pdd-ts/dist/cli/main.js review --project /path/to/project
```

## Codex向けの手順を任意導入する

```sh
node /path/to/pdd-ts/dist/cli/main.js skills --project /path/to/project --agent codex
```

対象プロジェクトの`.agents/skills/`へ調査・仕様整理・実装・検証・レビューの5つのSkillと判断入力ガイドを配置します。既存の導入先やシンボリックリンクは拒否し、個人設定やAGENTS.mdを変更しません。CLIや証明ツール自体をインストールする操作ではありません。initはSkillや空の判断ファイルを自動作成しません。

配置先は[公式OpenAIドキュメント](https://developers.openai.com/api/reference/cli)に従います。配置・配布と、Skillを明示適用した手順評価を確認しています。Codexの自動選択、実際の開発ループ、人の負担を減らす効果は未評価です。独自のAIサービスや実装ループは追加していません。

## 結果の読み方

- **Source proof**：宣言した制限付き意味論とツールチェーンを前提としたソース証明。
- **Test**：登録した実ケースによる経験的な検証。証明とは区別します。
- **Trusted / Unverified**：明示した信頼境界、未実装・欠落・非対応の義務。

成功したローカル検証も`trial`です。`unknown`・`unsupported`・`stale`・skip・0件・必須検証の欠落は合格になりません。レポートは`.pdd/reports/`、実行ごとの証拠は`.pdd/evidence/`に保存します。`report`は現在のソース・仕様・ツール・証拠を再照合します。終了コードは0＝成功した操作／trial、1＝検証ゲート不成立、2＝設定・ツール・認証のエラーです。

外部承認とCI監査は[CI運用手順](docs/runbooks/ci.md)を参照してください。ローカルの承認ファイルや`GITHUB_*`環境変数だけで保護ゲートを合格にすることはできません。

## 保証範囲と現状

同期の名前付き純粋関数の、boolean、文字列リテラルのunion、検証済みのbigint加減算・比較・分岐・新しい値レコードを対象とします。number、async、I/O、呼び出し・import、可変共有状態などは初期プロファイル外です。[互換性と信頼基盤](docs/compatibility.md)を確認してください。翻訳器全体の意味保存を証明したものではありません。

このリポジトリ自身と両サンプルの3つのソース証明・239ケース・本人レビュー・専用Appの保護CIを通し実行し、mainへ取り込みました。Hono例は再現用サンプルで、既存の外部プロジェクトへの導入実績ではありません。PR本文の読みやすさには否定的なフィードバックがあり、理解度・認知負荷の比較評価は未完了です。[監査記録](docs/mvp-audit.md)と[評価プロトコル](docs/evaluation.md)に結果と残る条件を記録します。

MIT License。

### 人が読む検証レポート

Markdownは日本語で、対象の要件、開発側が先に直す問題、確認できた範囲、本人への仕様確認を順に示します。要件と契約の説明には、プロジェクトで登録した文章を使います。識別子から業務上の意味や変更理由を推測して補うことはありません。

テスト不足や未説明の信頼前提がある場合は、開発側の対応として表示します。証明の入力条件を説明できない場合も、確認済みの振る舞いとして提示しません。根拠の原文、ソース契約、対象コミット、ハッシュは詳細欄に残します。手元の検証成功と、本人承認・署名を照合したCIの成功は区別します。

この表示の自動検査と、人間の読みやすさ・判断負担の評価は別です。後者の改善効果はまだ確認されていません。

## 有限状態のジョブキュー検査（Phase 6）

```sh
node dist/cli/main.js model-check --project examples/job-queue --model model.json --json
node dist/cli/main.js verify --project examples/job-queue
```

`job-queue-v1`は1ジョブ・2–4 worker・最大1–5試行の有限モデルです。同時二重実行・試行上限・非終端デッドロックを幅優先で検査し、上限による打切りは`unknown`にします。`model-check --trace trace.json`は観測トレースの遷移を照合します。

モデル検査は**本番コードの証明ではありません**。公平性や最終的成功、外部副作用のexactly-onceは主張しません。`verify`ではモデル検査とSQLiteの実テストを別々の必須Evidenceにし、モデル・対応表・実装入力の変更で過去の結果をstaleにします。[設定・モデルと実装の対応・制約](examples/job-queue/README.md)を参照してください。

高リスクのReview Packetには、主要Diff・失敗後の状態・境界・Atlas差分の未確認チェックリストを表示します。これは確認作業の案内で、承認済みや証明成功の印ではありません。
