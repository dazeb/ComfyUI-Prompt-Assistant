<div align="center">

<h1 align="center">ComfyUI Prompt Assistant ✨ 提示詞小助手 V2.0</h1>

<img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/yawiii/ComfyUI-Prompt-Assistant">
<a href="https://space.bilibili.com/520680644"><img alt="bilibili" src="https://img.shields.io/badge/詳細視頻教程-blue?style=flat&logo=bilibili&logoColor=2300A5DC&labelColor=%23FFFFFF&color=%2307A3D7"></a>
<a href="https://data.xflow.cc/wechat.png"><img alt="weChat" src="https://img.shields.io/badge/歡迎加入交流群-blue?logo=wechat&logoColor=green&labelColor=%23FFFFFF&color=%2307A3D7"></a>
<a href="https://ycn58r88iss5.feishu.cn/share/base/form/shrcnJ1AzbUJCynW9qrNJ2zPugy"><img alt="bug" src="https://img.shields.io/badge/Bug-反饋-orange"></a>

</div>

<div align="center">

[简体中文](README.md) | [English](README.en.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md) | [繁體中文](README.zh-TW.md)

</div>

<h4 align="center">🎉🎉 全新版本的提示詞小助手上線啦！功能更強，響應速度更快！適配 ComfyUI node2.0！🎉🎉</h4>

> 支持調用雲端大模型 API、本地 Ollama 大模型。實現提示詞、Markdown 節點、節點文檔翻譯；提示詞優化、圖像反推和視頻反推；常用標籤收藏、歷史記錄等功能。是一個全能 all in one 的提示詞插件！

## **📣 更新**

<details open>
<summary><strong>[2026-04-21] 🔥 V2.0.6</strong></summary>

**變更事項:**
* **V3 架構升級**：全面重構節點底層邏輯，適配 ComfyUI V3 API 標準，大幅提升響應速度與運行穩定性。

**修正事項:**
* **影片反推報錯修復**：修復由於部分模型（如 Qwen3.5-Plus）被誤判為不支援多圖分析而導致的報錯問題。現在支援自動截斷與智慧上限推斷。
* **Ollama 請求優化與修復**：優化 Ollama 請求邏輯，支援智慧路由（`base_url` 不加 `/v1` 走原生 API，加 `/v1` 走 OpenAI 相容 API），同時修復串流過濾邏輯導致部分模型返回空內容引發崩潰的報補問題。
* **子圖掛載優化**：修復子圖（Subgraph）節點在 Node 2.0 (Vue) 和 LiteGraph 模式下的掛載穩定性問題。

</details>

<details>
<summary><strong>V2.0.5</strong></summary>

**Changes:**

* **節點隨機種子**：為所有節點添加了統一的隨機種子小部件實現節點重複執行，移除通過觸發詞「[R]」機制實現可重複執行的機制；
  
  
* **前端 UI 新增多語言支持**：感謝 @rafek1241。添加了 ui-i18n 功能，目前支持（中、英、日、韓、法、西、俄、德等）；

**Fixes:**
* **節點寬度被鎖死**：修復 node2.0 下導致節點無法修改寬度問題。

* **置灰內置服務商 baseUrl 輸入框**：避免誤修改導致請求出現異常。

* **網絡異常報錯**：修復因為強制直連機制，導致修復 xflow 等中轉站請求出現網絡異常報錯。
* **圖像節點 ✨ 圖標移至右側**: 避免 node2.0 下與節點 id 信息重疊。

</details>

<details>
<summary><strong>V2.0.4</strong></summary>

* **bug 修復**：修復標籤和歷史功能無法使用的問題；

</details>

<details>
<summary><strong>V2.0.3</strong></summary>

* **小助手 UI**：修復子圖節小助手創建不穩定的情況，圖像節點丟失圖像的情況下無法創建小助手的情況；
  
* **Ollama**：修復因為代理原因導致 HTTP 502 錯誤

</details>

<details>
<summary><strong>V2.0.2</strong></summary>

* **標籤模塊**：修復格式問題，現在可以自由新建分類和管理標籤了。修復預設創建和遷移出錯問題；
  
* **小助手 UI**：優化 node2.0 下的掛載方法，修復子圖無法創建小助手和某些情況下不穩定的問題，並提升性能；
  
* **交互優化**：請求過程新增流式輸入效果、優化交互細節；
  
* **翻譯模塊**：新增混合語言翻譯規則參數，可以設置默認翻譯成中文/英文、完善了節點文檔翻譯；

* **內置規則**：修復部分規則，出現中英混合、kontext 輸出沒有翻譯等問題；
  
* **API 請求**：修復 gemimi-3-pro 無法請求的問題；修復 ollama 404 問題；
  
* **節點優化**：完善視頻反推節點；
  
* **控制台日誌**：優化日誌輸出，修復進度日誌無限輸出的 bug；
 
* **依賴更新**：避免缺少依賴無法啟動問題；

</details>

<details>
<summary><strong>V2.0.0</strong></summary>

* **調用優化**：全面重構小助手，提升 API、Ollama 調用和穩定度、響應速度；
  
* **UI 優化**：重構前端小助手組件，更加穩定，支持 **node2.0** 模式，可以自定義顯示位置、拖動按鈕排序；
  
* **標籤模塊優化**：全新標籤機制。改為加載 csv 模式，支持多套 csv 隨時切換、支持標籤收藏；
* **規則模塊優化**：全新配置窗口、支持分類、定義規則顯示的位置；加入多個預置規則；
* **API 服務模塊優化**：全新 **api** 配置界面。支持自定義服務、支持添加多個模型作為備選；擴寫、翻譯、反推可獨立選擇服務
* **節點重構**：重構所有節點，支持多語言，添加視頻反推節點（**beta**）；
* **用戶配置文件遷移**：遷移到 `\user\default\prompt-assistant` 避免重裝時用戶數據丟失；
* **新增功能**：節點文檔翻譯、markdown 節點翻譯

</details>

<details>
<summary><strong>V1.x.x</strong></summary>

<details>
<summary><strong>V1.2.x </strong></summary>

<details>
<summary>[2025-11-12] V1.2.3 </summary>

* 修復 ollama 和自定義服務時，返回為空的問題；
* Ollama 改用原生接口，更好支持 qwen3vl；
* 新增 http api 作為保底，避免出現請求異常；

</details>

<details>
<summary>[2025-10-14] V1.2.2 </summary>

* 移除兼容代碼，不再支持 comfyUI 0.3.27 以下的版本。避免小助手 UI 出現問題；
* 修復擴寫、翻譯使用 302.ai 服務時報錯問題，ollama 無法自動釋放問題；
* 所有節點添加獨立的 ollama 釋放選項；
* 移除 llm 和 vlm 的強制直連參數，避免偶發請求報錯問題，在設置界面中添加是否直連選項；
* 優化控制台日誌輸出格式，顯示更加清晰直觀；

</details>

<details>
<summary>[2025-10-14] V1.2.1 </summary>

* 優化小助手 UI 的反應靈敏度；
* 增強 api 請求重試機制；
* 設置界面新增翻譯標點符號、自動移除多餘空格、移除多餘連續點號、保留換行符等選項；
* 標籤窗口記憶窗口大小，記憶上次選中的分類，以及標籤欄滾動；
* API 配置界面，新增自動獲取模型列表功能；
* Ollama 新增自動釋放顯存選項；
* 修復預覽任意節點在列表情況無法為每個文本框創建小助手的 bug。

</details>

<details>
<summary>[2025-09-16] V1.2.0 </summary>

* 新增提示詞擴寫節點
* 新增 302.AI、Ollama 服務
* 標籤面板新增記憶功能
* 右鍵菜單支持快速切換服務
* 針對某些主流模型支持關閉思維鏈
* 優化反推和翻譯節點
* 新增交流反饋入口徽標
* 修復下拉菜單 bug
* 修復標籤面板搜索標籤無法插入 bug
* 修復 base_url 裁剪錯誤，解決偶發性請求報錯

</details>

</details>

<details>
<summary><strong>V1.1.x </strong></summary>

<details>
<summary>[2025-08-28] V1.1.3 </summary>

* 優化 Assistant UI to automatically avoid scrollbars and prevent overlapping accidental triggers.
* 修復 an issue where the tag popup lacked a scrollbar, causing incomplete content display.

</details>

<details>
<summary>[2025-08-23] V1.1.2 </summary>

* Refactored nodes to resolve multiple queues and duplicate execution issues during runtime.
* 新增 model parameters to the API config interface; some errors can be resolved by adjusting the max token count.
* Simplified image captioning workflow to improve captioning speed.
* 修復 an issue where unloaded tags couldn't be searched during on-demand loading.

</details>

<details>
<summary>[2025-08-10] V1.1.1 </summary>

* 修復 image caption node errors.

</details>

<details>
<summary>[2025-08-10] V1.1.0 </summary>

* 修改 UI interactions.
* 支持 all OpenAI SDK compatible APIs.
* 新增 custom rules.
* 新增 custom tags.
* 新增 Image Caption, Kontext Preset, and Translation nodes.

</details>

</details>

<details>
<summary><strong>V1.0.x</strong> </summary>

<details>
<summary>[2025-06-24] V1.0.6</summary>

* 修復 some UI bugs.

</details>

<details>
<summary>[2025-06-24] V1.0.5</summary>

* 修復 assistant UI anomaly when creating a kontext node using the selection toolbar.
* 修復 Zhipu service unavailability likely caused by network conditions.
* 修復 workflow loading failures caused by instance clearing errors.
* 修復 an issue where the AIGODLIKE-COMFYUI-TRANSLATION plugin caused the tag popup to freeze.
* 新增 resizable tag panel.
* 優化 UI resource loading mechanism.

</details>

<details>
<summary>[2025-06-24] V1.0.3</summary>

* Refactored API request service to prevent API keys from being exposed to the frontend.
* 修改 config save/load mechanism to fix config saving issues.
* 修復 minor bugs.

</details>

<details>
<summary>[2025-06-21] V1.0.2</summary>

* 修復 minor bugs.

</details>

<details>
<summary>[2025-06-15] V1.0.0</summary>

* One-click tag insertion.
* LLM expansion support.
* Toggle between Baidu Translate and LLM Translate.
* Image to prompt captioning.
* History, undo, and redo.

</details>

</details>
</details>

## **✨ 功能介紹**

#### 💡 提示詞優化 + 翻譯
`支持預設多套提示詞優化規則（如擴寫、qwen-edit 指令優化，kontext 指令優化並翻譯等`
`無需設置目標語言，自動中英互譯，自帶翻譯緩存功能，避免重複翻譯導致原文偏差`

![翻譯擴寫](https://github.com/user-attachments/assets/a37b715e-ecfd-47d6-a4b8-a0b1e6bb9fcd) 

#### 🖼 圖像反推
`在圖像節點上快速實現將圖片反推成提示詞，支持（中/英），支持多種反推風格（如自然語言、Tag 風格...）`

![反推](https://github.com/user-attachments/assets/3713ddc5-4e2e-4412-88ee-077d86f21b99)

#### 🔖 標籤、短語預設與收藏
`可將常用標籤、短語、Lora 觸發詞收集，快速插入。標籤可收藏、自定義、排序、並且支持多套標籤切換。`

![標籤功能](https://github.com/user-attachments/assets/944173be-8167-42eb-93d9-e0c05256ccf8)

#### 🕐 歷史、撤銷、重做
`可以按句為單位記錄（輸入框失焦觸發記錄），撤銷和重做提示詞，支持跨節點查看提示詞歷史記錄。`

![歷史](https://github.com/user-attachments/assets/85868b9e-1bf5-4789-9a71-97af80ef2bc8)

#### 📜 Markdown 和節點文檔翻譯
`支持翻譯 note 節點和 Markdown 節點，並保持格式`

![markdown](https://github.com/user-attachments/assets/c2ac1266-f8c1-4b27-ba41-13c5b5e5e689)

`支持翻譯英文節點文檔（beta：僅在英文節點才會出現翻譯按鈕）`

![nodedoc](https://github.com/user-attachments/assets/32c9a712-20c3-4b5e-b331-bfb885b7b5d4)

### 📒 節點介紹
節點分類 `✨Prompt Assistant`

#### **🔹 翻譯節點**
`✨Prompt Assistant → 提示詞翻譯`
<img width="1700" height="700" alt="翻譯節點" src="https://github.com/user-attachments/assets/9dbc9fc9-1b91-43b6-822e-d598b2c8168f" />

#### **🔹 提示詞優化節點**
`✨Prompt Assistant → 提示詞優化`
<img width="1700" height="911" alt="擴寫節點" src="https://github.com/user-attachments/assets/ea821506-d684-4526-9119-621bb0467ddf" />

#### **🔹 圖像反推節點**
`✨Prompt Assistant → 圖像反推提示詞`
`可以反推圖像、結合視覺模型優化圖像編輯指令`
<img width="1700" height="800" alt="圖像反推節點" src="https://github.com/user-attachments/assets/8ff3ac96-724a-48d0-8e15-23fe0b28bec1" />
<img width="1700" height="800" alt="編輯模型配合視覺理解" src="https://github.com/user-attachments/assets/a95dc0f4-1d46-438f-a242-4087f6e8361a" />

#### **🔹 視頻反推節點**
`✨Prompt Assistant → 視頻反推提示詞`
<img width="1700" height="1080" alt="視頻反推節點" src="https://github.com/user-attachments/assets/0143096b-24d5-4308-82ff-e0a99144db0b" />
<img width="1700" height="1102" alt="選取幀工具" src="https://github.com/user-attachments/assets/96c2bd08-b26c-4df1-b32c-be8e20328c97" />

## **📦 安裝方法**

### ⚠️ 舊版本遷移注意事項
`如果您安裝過提示詞小助手 2.0 之前的版本，請注意備份原插件目錄下的 config 目錄。避免 api 配置、自定義規則、自定義標籤數據丟失！`

如果您之前是通過 **Manager** 安裝則直接更新即可，如果您使用的是手動安裝，建議刪除舊的插件目錄（記得備份 config 目錄！！）將新的插件放入到 `custom\custom_nodes` 目錄，再將需要恢復的配置文件放回 config 目錄

#### **從 ComfyUI Manager 中安裝**
在 Manager 中輸入 `Prompt Assistant` 或 `提示詞小助手`，點擊 `Install`，選擇最新版本安裝。

<img width="1800" height="1098" alt="安裝" src="https://github.com/user-attachments/assets/167eb467-a77d-4a37-a95b-e935ca354284" />

#### **克隆代碼倉庫**
1. 導航到您的 ComfyUI 自定義節點文件夾:
   ```bash
   cd ComfyUI/custom_nodes
   ```
2. 克隆這個代碼倉庫:
   ```bash
   git clone https://github.com/yawiii/ComfyUI-Prompt-Assistant.git
   ```
3. 重啟 ComfyUI：

#### **下載插件壓縮包**
1. 從[克隆倉庫](https://github.com/yawiii/comfyui_prompt_assistant/releases)中下載最新版本
2. 解壓縮到 `ComfyUI/custom_nodes` 目录下
`⚠️ 注意：建議將插件目錄名稱修改為：prompt-assistant，以符合 ComfyUI 規範`

<img width="600" height="276" alt="github安裝" src="https://github.com/user-attachments/assets/99783a78-6e0b-42aa-8f9e-7146ebcef5fd" />

### 數據自動遷移
新版本能自動將用戶的 api 配置、自定義規則、自定義標籤進行升級和遷移。您可以根據自己的需要，將要做遷移的文件，放置在 `prompt-assistant\config` 目錄下。如果不選擇遷移，重新安裝後，API 配置信息，需要重新手動配置！ 可遷移文件有
新版本的小助手配置文件儲存在 `ComfyUI\user\default\prompt-assistant` 目錄下，

<img width="600" height="419" alt="遷移" src="https://github.com/user-attachments/assets/90b8f90f-51df-4537-b735-ae07c3cdff7f" />

## **⚙️ 配置說明**

### 配置 API Key，並配置模型
<img width="1593" height="1119" alt="進入配置頁面" src="https://github.com/user-attachments/assets/ea01c0bc-fe0f-40be-991c-d7833965213a" />
<img width="1569" height="1137" alt="apI配置窗口" src="https://github.com/user-attachments/assets/9d982773-2939-480b-a691-bb89a227a9ff" />

### 服務說明
您可以需求新增服務商，或者選擇內置的服務商進行使用：
`⚠️ 免責聲明：本插件僅提供 API 調用工具，第三方服務責任與本插件無關，插件所涉用戶配置信息均存儲於本地。對於因賬號使用產生的任何問題，本插件不承擔責任！`

* **百度翻譯（機器翻譯）**：[百度通用文本翻譯申請入口](https://fanyi-api.baidu.com/product/11)
  `速度快，但是翻譯質量一般。使用魔法時可能會導致無法請求每個月有免費 500w 額度`
* **智譜（大語言模型模型）：**[智譜 API 申請入口](https://www.bigmodel.cn/invite?icode=Wz1tQAT40T9M8vwp%2F1db7nHEaazDlIZGj9HxftzTbt4%3D)
  `速度快，無限額度；注意：模型有審查，如果請求內容違規，會返回空結果。並非插件 bug。最近智譜開始限制請求頻率了。`
* **xFlow-API 聚合：**[xFlow API 申請入口](https://api.xflow.cc/register?aff=Z063)
  `提供各類模型 API 聚合（如 Gemini、nano Bannana、Grok、ChatGTP...），實現一個 APIkey 調用所有主流大模型，無需解決網絡問題；`

## **🎀 特別感謝以下朋友！**
感謝群友為 V2.0.0 版本提供規則模板：阿丹、CJL、諾曼底
