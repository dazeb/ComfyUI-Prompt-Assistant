<div align="center">

<h1 align="center">ComfyUI Prompt Assistant ✨ プロンプトアシスタント V2.0</h1>

<img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/yawiii/ComfyUI-Prompt-Assistant">
<a href="https://space.bilibili.com/520680644"><img alt="bilibili" src="https://img.shields.io/badge/詳細ビデオチュートリアル-blue?style=flat&logo=bilibili&logoColor=2300A5DC&labelColor=%23FFFFFF&color=%2307A3D7"></a>
<a href="https://data.xflow.cc/wechat.png"><img alt="weChat" src="https://img.shields.io/badge/コミュニティに参加-blue?logo=wechat&logoColor=green&labelColor=%23FFFFFF&color=%2307A3D7"></a>
<a href="https://ycn58r88iss5.feishu.cn/share/base/form/shrcnJ1AzbUJCynW9qrNJ2zPugy"><img alt="bug" src="https://img.shields.io/badge/バグ-フィードバック-orange"></a>

</div>

<div align="center">

[简体中文](README.md) | [English](README.en.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md) | [繁體中文](README.zh-TW.md)

</div>

<h4 align="center">🎉🎉 新バージョンのプロンプトアシスタントが登場！機能が強化され、レスポンスがさらに高速化！ComfyUI node2.0に対応！🎉🎉</h4>

> クラウド大規模モデルAPIおよびローカルOllamaモデルの呼び出しをサポート。プロンプト、Markdownノード、ノードドキュメントの翻訳、プロンプトの最適化、画像および動画のキャプション生成、よく使うタグの保存、履歴記録など、多機能なオールインワンのプロンプトプラグインです！

## **📣 更新情報**

<details open>
<summary><strong>[2026-04-21] 🔥 V2.0.6</strong></summary>

**変更内容:**
* **V3 アーキテクチャのアップグレード**: ComfyUI V3 API 標準に完全に適合するようにノードのバックエンドをリファクタリングし、安定性とパフォーマンスを向上させました。

**修正内容:**
* **ビデオキャプションの修正**: 一部のモデル（Qwen3.5-Plusなど）がマルチ画像分析をサポートしていないと誤判定される問題を修正。フレーム制限の自動推論と切り捨て機能を追加。
* **Ollama リクエストの最適化と修正**: Ollama のリクエストロジックを最適化し、スマートルーティング（`base_url` に `/v1` がない場合はネイティブ API、ある場合は OpenAI 互換 API）に対応しました。また、ストリーミングフィルタリングロジックにより一部のモデルが空の内容を返し、クラッシュする問題を修正しました。
* **サブグラフマウントの最適化**: Node 2.0 (Vue) および LiteGraph モードでのサブグラフノードにおけるアシスタントの安定性を修正。

</details>

<details>
<summary><strong>V2.0.5</strong></summary>

**変更点:**

* **ノードのランダムシード**: すべてのノードに統一されたランダムシードウィジェットを追加し、ノードの繰り返し実行を実現。従来のトリガーワード「[R]」による実行メカニズムを廃止しました。
  
  
* **フロントエンド UI の多言語対応強化**: @rafek1241 氏に感謝します。ui-i18n 機能を追加し、現在（中、英、日、韓、仏、西、露、独など）をサポートしています。

**修正点:**
* **ノード幅のロック問題**: node2.0 においてノードの幅を変更できない問題を修正しました。

* **内蔵サービスプロバイダーの baseUrl 入力欄を無効化**: 誤った変更によるリクエストエラーを防止しました。

* **ネットワーク例外エラー**: 強制直連メカニズムにより、xflow などのプロキシ経由のリクエストでネットワーク例外が発生していた問題を修正しました。
* **画像ノードの ✨ アイコンを右側に移動**: node2.0 においてノード ID 情報と重なるのを回避しました。

</details>

<details>
<summary><strong>V2.0.4</strong></summary>

* **バグ修正**: タグおよび履歴機能が利用できなかった問題を修正しました。

</details>

<details>
<summary><strong>V2.0.3</strong></summary>

* **アシスタント UI**: サブグラフでのアシスタント生成の不安定さ、および画像ノードに画像がない場合にアシスタントが生成されない問題を修正しました。
  
* **Ollama**: プロキシ設定による HTTP 502 エラーを修正しました。

</details>

<details>
<summary><strong>V2.0.2</strong></summary>

* **タグモジュール**: フォーマットの問題を修正。カテゴリの新規作成やタグ管理が自由に行えるようになりました。プリセットの作成および移行時のエラーを修正しました。
  
* **アシスタント UI**: node2.0 でのマウント方法を最適化し、サブグラフでのアシスタント生成の問題や不安定さを修正し、パフォーマンスを向上させました。
  
* **インタラクションの最適化**: リクエスト中のストリーミング入力効果を追加し、UI の詳細を最適化しました。
  
* **翻訳モジュール**: 混合言語翻訳ルールパラメータを追加。デフォルトの翻訳先を中国語/英語に設定可能になり、ノードドキュメントの翻訳を強化しました。

* **内蔵ルール**: 中国語/英語が混合する問題や Kontext の出力が翻訳されない問題などを修正しました。
  
* **API リクエスト**: Gemini-1.5-Pro の不具合および Ollama 404 エラーを修正しました。
  
* **ノードの最適化**: 動画キャプション生成ノードを改善しました。
  
* **コンソールログ**: ログ出力を最適化し、プログレスログの無限ループバグを修正しました。

</details>

<details>
<summary><strong>V2.0.0</strong></summary>

* **呼び出しの最適化**: アシスタントを全面的に再構築し、API および Ollama の呼び出しの安定性とレスポンス速度を向上させました。
  
* **UI の最適化**: フロントエンドコンポーネントを再構築し、安定性を向上。**node2.0** モードをサポートし、表示位置のカスタマイズやボタンの並べ替えが可能になりました。
  
* **タグモジュールの最適化**: 新しい CSV ベースのタグメカニズム。複数の CSV をいつでも切り替え可能になり、タグのコレクション機能をサポートしました。
* **ルールモジュールの最適化**: 新しい設定ウィンドウ、カテゴリ分け、ルールの表示位置定義をサポート。複数のプリセットルールを追加しました。
* **API サービスモジュールの最適化**: 新しい **API** 設定画面。カスタムサービスや複数モデルのバックアップをサポート。最適化、翻訳、キャプション生成ごとに個別のサービスを選択可能になりました。
* **ノードの再構築**: すべてのノードを再構築し、多言語をサポート。動画キャプション生成ノード（**Beta**）を追加しました。
* **ユーザー設定の移行**: `\user\default\prompt-assistant` へ移行し、再インストール時のデータ紛失を防止しました。
* **新機能**: ノードドキュメント翻訳、Markdown ノード翻訳。

</details>

<details>
<summary><strong>V1.x.x</strong></summary>

<details>
<summary><strong>V1.2.x </strong></summary>

<details>
<summary>[2025-11-12] V1.2.3 </summary>

* Ollamaおよびカスタムサービス使用時に空の結果が返る問題を修正しました。
* OllamaはネイティブAPIを使用し、qwen3vlのサポートを改善しました。
* リクエストの例外を回避するため、フォールバックとしてHTTP APIを追加しました。

</details>

<details>
<summary>[2025-10-14] V1.2.2 </summary>

* 互換性コードを削除し、ComfyUI 0.3.27未満のバージョンはサポート対象外となりました。
* 302.aiサービスによるプロンプト拡張・翻訳時のエラー、およびOllamaが自動的にアンロードされない問題を修正しました。
* すべてのノードに独立したOllamaアンロードオプションを追加しました。
* 偶発的なリクエストエラーを避けるため、LLM/VLMの強制直接接続パラメータを削除し、設定画面に直接接続オプションを追加しました。
* コンソールログの出力形式を最適化し、より直感的にしました。

</details>

<details>
<summary>[2025-10-14] V1.2.1 </summary>

* アシスタントUIのレスポンス感度を向上させました。
* APIリクエストの再試行メカニズムを強化しました。
* 句読点の翻訳、不要な空白や連続したドットの自動削除、改行の保持などのオプションを設定画面に追加しました。
* タグウィンドウのサイズ、前回選択したカテゴリ、およびタグバーのスクロール位置を記憶するようにしました。
* API設定画面にモデルリストの自動取得機能を追加しました。
* Ollamaの自動VRAMアンロードオプションを追加しました。
* リストビューで任意のノードをプレビューする際、各テキストボックスにアシスタントを生成できないバグを修正しました。

</details>

<details>
<summary>[2025-09-16] V1.2.0 </summary>

* プロンプト拡張ノードを追加しました。
* 302.AI、Ollamaサービスを追加しました。
* タグパネルに記憶機能を追加しました。
* 右クリックメニューでサービスを素早く切り替えられるようにしました。
* 一部の主流モデルにおける思考チェーン(CoT)の無効化をサポートしました。
* キャプション生成および翻訳ノードを最適化しました。
* コミュニティフィードバックのバッジを追加しました。
* ドロップダウンメニューのバグを修正しました。
* タグパネルで検索したタグを挿入できないバグを修正しました。
* まれにリクエストエラーを引き起こす base_url の切り捨てエラーを修正しました。

</details>

</details>

<details>
<summary><strong>V1.1.x </strong></summary>

<details>
<summary>[2025-08-28] V1.1.3 </summary>

* スクロールバーを自動的に回避し、重複による誤操作を防ぐようUIを最適化しました。
* タグのポップアップにスクロールバーがなく、内容が完全に表示されない問題を修正しました。

</details>

<details>
<summary>[2025-08-23] V1.1.2 </summary>

* ノードをリファクタリングし、実行時に複数のキューが発生し重複して実行される問題を解決しました。
* API設定画面にモデルパラメータを追加しました（最大トークン数を調整することで一部のエラーを回避できます）。
* 画像キャプションのワークフローを簡略化し、キャプション速度を向上させました。
* タグのオンデマンド読込時に、まだ読み込まれていないタグが検索できない問題を修正しました。

</details>

<details>
<summary>[2025-08-10] V1.1.1 </summary>

* 画像キャプションノードのエラーを修正しました。

</details>

<details>
<summary>[2025-08-10] V1.1.0 </summary>

* UIインタラクションを変更しました。
* OpenAI SDK互換のすべてのAPIをサポートしました。
* カスタムルールを追加しました。
* カスタムタグを追加しました。
* 画像キャプション、Kontextプリセット、翻訳ノードを追加しました。

</details>

</details>

<details>
<summary><strong>V1.0.x</strong> </summary>

<details>
<summary>[2025-06-24] V1.0.6</summary>

* いくつかのUIのバグを修正しました。

</details>

<details>
<summary>[2025-06-24] V1.0.5</summary>

* 選択ツールバーを使用してKontextノードを作成した際のアシスタントUIの異常を修正しました。
* ネットワーク環境に起因すると思われるZhipuサービスの利用不能問題を修正しました。
* インスタンスのクリアエラーによるワークフローの読み込み失敗を修正しました。
* AIGODLIKE-COMFYUI-TRANSLATIONプラグインによってタグのポップアップがフリーズする問題を修正しました。
* タグパネルのサイズ変更が可能になりました。
* UIリソースの読み込みメカニズムを最適化しました。

</details>

<details>
<summary>[2025-06-24] V1.0.3</summary>

* APIキーがフロントエンドに公開されるのを防ぐため、APIリクエストサービスをリファクタリングしました。
* 設定が保存されない問題を解決するため、設定の保存および読込のメカニズムを変更しました。
* 軽微なバグを修正しました。

</details>

<details>
<summary>[2025-06-21] V1.0.2</summary>

* 軽微なバグを修正しました。

</details>

<details>
<summary>[2025-06-15] V1.0.0</summary>

* ワンクリックでのタグ挿入。
* LLMを用いたプロンプト拡張をサポート。
* Baidu翻訳とLLM翻訳の切り替えに対応。
* 画像からプロンプトへのキャプション機能。
* 履歴、元に戻す、やり直し機能。

</details>

</details>

</details>

## **✨ 機能紹介**

#### 💡 プロンプトの最適化 + 翻訳
`複数の最適化ルール（拡張、qwen-edit 命令、kontext 命令など）をプリセット可能`
`ターゲット言語の設定不要。中国語と英語の自動相互翻訳をサポートし、キャッシュ機能により原文のニュアンス変化を防止。`

![翻訳拡張](https://github.com/user-attachments/assets/a37b715e-ecfd-47d6-a4b8-a0b1e6bb9fcd) 

#### 🖼 画像キャプション生成
`画像ノード上で画像をプロンプトへ素早く変換。中国語/英語をサポートし、多様なスタイル（自然言語、タグ形式など）を選択可能。`

![キャプション](https://github.com/user-attachments/assets/3713ddc5-4e2e-4412-88ee-077d86f21b99)

#### 🔖 タグ・フレーズプリセットとコレクション
`よく使うタグ、フレーズ、Lora トリガーワードを収集し、素早く挿入可能。タグの保存、カスタマイズ、並べ替え、複数セットの切り替えをサポート。`

![タグ機能](https://github.com/user-attachments/assets/944173be-8167-42eb-93d9-e0c05256ccf8)

#### 🕐 履歴・元に戻す・やり直し
`文単位での記録（入力欄のフォーカスが外れた際に記録）。プロンプトの元に戻す/やり直しをサポートし、ノードを跨いだ履歴の閲覧が可能。`

![履歴](https://github.com/user-attachments/assets/85868b9e-1bf5-4789-9a71-97af80ef2bc8)

#### 📜 Markdown とノードドキュメントの翻訳
`Note ノードおよび Markdown ノードを書式を維持したまま翻訳。`

![markdown](https://github.com/user-attachments/assets/c2ac1266-f8c1-4b27-ba41-13c5b5e5e689)

`英語のノードドキュメントの翻訳をサポート（Beta：英語のドキュメントがあるノードにのみ翻訳ボタンが表示されます）。`

![nodedoc](https://github.com/user-attachments/assets/32c9a712-20c3-4b5e-b331-bfb885b7b5d4)

### 📒 ノード紹介
カテゴリ: `✨Prompt Assistant`

#### **🔹 翻訳ノード**
`✨Prompt Assistant → プロンプト翻訳`
<img width="1700" height="700" alt="翻訳ノード" src="https://github.com/user-attachments/assets/9dbc9fc9-1b91-43b6-822e-d598b2c8168f" />

#### **🔹 プロンプト最適化ノード**
`✨Prompt Assistant → プロンプト最適化`
<img width="1700" height="911" alt="拡張ノード" src="https://github.com/user-attachments/assets/ea821506-d684-4526-9119-621bb0467ddf" />

#### **🔹 画像キャプション生成ノード**
`✨Prompt Assistant → 画像キャプションプロンプト`
`画像をキャプションし、視覚モデルを組み合わせて編集指示を最適化します。`
<img width="1700" height="800" alt="画像キャプション生成ノード" src="https://github.com/user-attachments/assets/8ff3ac96-724a-48d0-8e15-23fe0b28bec1" />
<img width="1700" height="800" alt="視覚理解を伴う編集モデル" src="https://github.com/user-attachments/assets/a95dc0f3-1d46-438f-a242-4087f6e8361a" />

#### **🔹 動画キャプション生成ノード**
`✨Prompt Assistant → 動画キャプションプロンプト`
<img width="1700" height="1080" alt="動画キャプション生成ノード" src="https://github.com/user-attachments/assets/0143096b-24d5-4308-82ff-e0a99144db0b" />
<img width="1700" height="1102" alt="フレーム選択ツール" src="https://github.com/user-attachments/assets/96c2bd08-b26c-4df1-b32c-be8e20328c97" />

## **📦 インストール方法**

### ⚠️ 旧バージョンからの移行に関する注意
`V2.0.0 以前のバージョンをインストールされている場合は、API設定、カスタムルール、カスタムタグデータの紛失を防ぐため、プラグインディレクトリ内の "config" ディレクトリを必ずバックアップしてください。`

**Manager** を通じてインストールした場合は、そのまま更新してください。手動でインストールした場合は、古いプラグインディレクトリを削除し（configを忘れずにバックアップ！！）、新しいプラグインディレクトリを `custom/custom_nodes` に入れ、必要な設定ファイルを config に戻すことを推奨します。

#### **ComfyUI Manager からインストール**
Manager で `Prompt Assistant` または `提示词小助手` と入力し、`Install` をクリックして最新バージョンをインストールします。

<img width="1800" height="1098" alt="インストール" src="https://github.com/user-attachments/assets/167eb467-a77d-4a37-a95b-e935ca354284" />

#### **リポジトリをクローンする**
1. ComfyUI のカスタムノードフォルダへ移動します:
   ```bash
   cd ComfyUI/custom_nodes
   ```
2. リポジトリをクローンします:
   ```bash
   git clone https://github.com/yawiii/ComfyUI-Prompt-Assistant.git
   ```
3. ComfyUI を再起動します。

#### **zipファイルをダウンロードする**
1. [リポジトリのリリース](https://github.com/yawiii/comfyui_prompt_assistant/releases)から最新バージョンをダウンロードします。
2. `ComfyUI/custom_nodes` ディレクトリに解凍します。
`⚠️ 注意：ComfyUIの規約に基づき、プラグインのディレクトリ名を "prompt-assistant" に変更することを推奨します。`

<img width="600" height="276" alt="githubインストール" src="https://github.com/user-attachments/assets/99783a78-6e0b-42aa-8f9e-7146ebcef5fd" />

### データの自動移行
新バージョンでは、ユーザーの API 設定、カスタムルール、カスタムタグを自動的にアップグレードし、移行します。移行したいファイルを `prompt-assistant/config` ディレクトリに配置してください。
設定ファイルは `ComfyUI\user\default\prompt-assistant` ディレクトリに保存されます。

<img width="600" height="419" alt="移行" src="https://github.com/user-attachments/assets/90b8f90f-51df-4537-b735-ae07c3cdff7f" />

## **⚙️ 設定について**

### API Key とモデルの設定
<img width="1593" height="1119" alt="設定ページへ" src="https://github.com/user-attachments/assets/ea01c0bc-fe0f-40be-991c-d7833965213a" />
<img width="1569" height="1137" alt="API設定ウィンドウ" src="https://github.com/user-attachments/assets/9d982773-2939-480b-a691-bb89a227a9ff" />

### サービス内容
必要に応じて新しいプロバイダーを追加したり、内蔵のプロバイダーを選択して使用できます。
`⚠️ 免責事項：本プラグインは API 呼び出しツールのみを提供し、サードパーティサービスの責任は当プラグインとは無関係です。ユーザー設定情報はローカルに保存されます。`

* **Baidu 翻訳（機械翻訳）**: [Baidu 翻訳 API 申請サイト](https://fanyi-api.baidu.com/product/11)
  `速度は速いですが、品質は標準的です。ネットワーク環境によりリクエストが失敗する場合があります。毎月 500 万文字の無料枠があります。`
* **Zhipu (LLM)**: [Zhipu API 申請サイト](https://www.bigmodel.cn/invite?icode=Wz1tQAT40T9M8vwp%2F1db7nHEaazDlIZGj9HxftzTbt4%3D)
  `高速でクォータ制限なし。注意：検閲があり、不適切な内容は空の結果を返す場合があります。`
* **xFlow-API アグリゲーション**: [xFlow API 申請サイト](https://api.xflow.cc/register?aff=Z063)
  `様々なモデル（Gemini, Grok, ChatGPT...）を 1 つの API Key で呼び出し可能。ネットワーク問題を気にする必要がありません。`

## **🎀 謝辞**
V2.0.0 のルールテンプレートを提供してくださったコミュニティメンバー、阿丹、CJL、诺曼底に感謝します。
