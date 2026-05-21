<div align="center">

<h1 align="center">ComfyUI Prompt Assistant ✨ 프롬프트 어시스턴트 V2.0</h1>

<img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/yawiii/ComfyUI-Prompt-Assistant">
<a href="https://space.bilibili.com/520680644"><img alt="bilibili" src="https://img.shields.io/badge/상세 비디오 튜토리얼-blue?style=flat&logo=bilibili&logoColor=2300A5DC&labelColor=%23FFFFFF&color=%2307A3D7"></a>
<a href="https://data.xflow.cc/wechat.png"><img alt="weChat" src="https://img.shields.io/badge/커뮤니티 가입-blue?logo=wechat&logoColor=green&labelColor=%23FFFFFF&color=%2307A3D7"></a>
<a href="https://ycn58r88iss5.feishu.cn/share/base/form/shrcnJ1AzbUJCynW9qrNJ2zPugy"><img alt="bug" src="https://img.shields.io/badge/버그-피드백-orange"></a>

</div>

<div align="center">

[简体中文](README.md) | [English](README.en.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md) | [繁體中文](README.zh-TW.md)

</div>

<h4 align="center">🎉🎉 새로운 버전의 프롬프트 어시스턴트가 출시되었습니다! 기능은 강력해지고 응답은 더 빨라졌습니다! ComfyUI Node 2.0 지원! 🎉🎉</h4>

> 클라우드 대규모 모델 API 및 로컬 Ollama 모델 호출을 지원합니다. 프롬프트 노드, Markdown 노드, 노드 문서 번역; 프롬프트 최적화, 이미지 및 비디오 캡션; 자주 사용하는 태그 즐겨찾기, 히스토리 기록 등 기능을 제공합니다. 올인원 프롬프트 어시스턴트 플러그인입니다!

## **📣 업데이트**

<details open>
<summary><strong>[2026-04-21] 🔥 V2.0.6</strong></summary>

**변경 사항:**
* **V3 아키텍처 업그레이드**: 노드 백엔드를 ComfyUI V3 API 표준에 맞춰 완전히 리팩토링하여 안정성과 성능을 향상시켰습니다.

**수정 사항:**
* **비디오 역추론 오류 수정**: 일부 모델(예: Qwen3.5-Plus)이 다중 이미지 분석을 지원하지 않는 것으로 오해받던 오류 수정. 지능형 프레임 제한 추론 및 자동 절단 기능 추가.
* **Ollama 요청 최적화 및 수정**: Ollama 요청 로직을 최적화하여 스마트 라우팅(`base_url`에 `/v1`이 없으면 네이티브 API, 있으면 OpenAI 호환 API)을 지원합니다. 또한 스트리밍 필터링 로직으로 인해 일부 모델이 빈 내용을 반환하여 충돌하는 오류를 수정했습니다.
* **서브그래프 마운트 최적화**: Node 2.0 (Vue) 및 LiteGraph 모드에서 서브그래프 노드의 어시스턴트 안정성 문제 수정.

</details>

<details>
<summary><strong>V2.0.5</strong></summary>

**Changes:**

* **노드 랜덤 시드**: 모든 노드에 통합된 랜덤 시드 위젯을 추가하여 노드 실행의 반복성을 구현했습니다. 기존의 트리거 키워드 "[R]" 실행 방식은 제거되었습니다.
  
  
* **프론트엔드 UI 다국어 지원 강화**: @rafek1241님께 감사드립니다. ui-i18n 기능을 추가하여 현재 (중국어, 영어, 일본어, 한국어, 프랑스어, 스페인어, 러시아어, 독일어 등)를 지원합니다.

**Fixes:**
* **Ollama 요청 최적화 및 수정**: Ollama 요청 로직을 최적화하여 스마트 라우팅(`base_url`에 `/v1`이 없으면 네이티브 API, 있으면 OpenAI 호환 API)을 지원합니다. 또한 스트리밍 필터링 로직으로 인해 일부 모델이 빈 내용을 반환하여 충돌하는 오류를 수정했습니다.

</details>

<details>
<summary><strong>V2.0.4</strong></summary>

* **버그 수정**: 태그 및 기록 기능을 사용할 수 없던 문제를 수정했습니다.

</details>

<details>
<summary><strong>V2.0.3</strong></summary>

* **어시스턴트 UI**: 서브그래프에서 어시스턴트 생성의 불안정함과 이미지 노드에 이미지가 없을 때 생성되지 않던 문제를 수정했습니다.
  
* **Ollama**: 프록시 설정으로 인한 HTTP 502 오류를 수정했습니다.

</details>

<details>
<summary><strong>V2.0.2</strong></summary>

* **태그 모듈**: 포맷 문제를 수정하여 자유롭게 카테고리를 생성하고 태그를 관리할 수 있게 되었습니다. 프리셋 생성 및 마이그레이션 오류를 수정했습니다.
  
* **어시스턴트 UI**: Node 2.0 마운트 방식을 최적화하고, 서브그래프 생성 및 불안정성 문제를 해결하여 성능을 향상시켰습니다.
  
* **상호작용 최적화**: 요청 중 스트리밍 입력 효과를 추가하고 UI 세부 사항을 개선했습니다.
  
* **번역 모듈**: 혼합 언어 번역 규칙 매개변수(기본 중국어/영어 설정)를 추가하고 노드 문서 번역을 개편했습니다.

* **내장 규칙**: 일부 규칙에서 발생하는 중/영 혼합 문제와 Kontext 출력 번역 누락 등을 수정했습니다.
  
* **API 요청**: Gemini-1.5-Pro 요청 문제 및 Ollama 404 오류를 수정했습니다.
  
* **노드 최적화**: 비디오 캡션 노드를 개선했습니다.
  
* **콘솔 로그**: 로그 출력을 최적화하고 진행 로그 무한 루프 버그를 수정했습니다.

</details>

<details>
<summary><strong>V2.0.0</strong></summary>

* **핵심 리팩토링**: 어시스턴트의 API 및 Ollama 호출 안정성과 응답 속도를 대폭 개선했습니다.
  
* **UI 개선**: 프론트엔드 구성 요소를 재구축하여 안정성을 높였으며, **Node 2.0** 모드를 지원하여 위치 커스텀 및 버튼 정렬이 가능해졌습니다.
  
* **태그 모듈 최적화**: 새로운 CSV 기반 태그 방식. 여러 CSV 간 전환과 즐겨찾기 기능을 지원합니다.
* **규칙 모듈 최적화**: 새로운 설정 창, 카테고리화, 규칙 표시 위치 설정 등을 지원하며 다양한 프리셋 규칙을 추가했습니다.
* **API 서비스 최적화**: 새로운 **API** 설정 UI. 커스텀 서비스와 멀티 모델 백업을 지원합니다. 최적화, 번역, 캡션 작업에 독립적으로 서비스를 지정할 수 있습니다.
* **노드 리뉴얼**: 모든 노드를 다국어 지원으로 재구축했습니다. 비디오 캡션 노드(**Beta**)를 추가했습니다.
* **마이그레이션**: 사용자 구성을 `\user\default\prompt-assistant`로 이동하여 재설치 시 데이터 손실을 방지했습니다.
* **신규 기능**: 노드 문서 번역 및 Markdown 노드 번역 추가.

</details>

<details>
<summary><strong>V1.x.x</strong></summary>

<details>
<summary><strong>V1.2.x </strong></summary>

<details>
<summary>[2025-11-12] V1.2.3 </summary>

* Ollama 및 사용자 지정 서비스 사용 시 빈 결과가 반환되는 문제를 수정했습니다.
* Ollama는 qwen3vl 지원을 개선하기 위해 네이티브 API를 사용합니다.
* 요청 예외를 방지하기 위해 HTTP API 폴백을 추가했습니다.

</details>

<details>
<summary>[2025-10-14] V1.2.2 </summary>

* 호환성 코드를 제거했으며, ComfyUI 0.3.27 미만 버전은 더 이상 지원되지 않습니다.
* 302.ai 서비스로 프롬프트 확장 및 번역 시 발생하는 오류와 Ollama의 자동 언로드 실패 문제를 수정했습니다.
* 모든 노드에 독립적인 Ollama 언로드 옵션을 추가했습니다.
* 드문 요청 오류를 방지하기 위해 LLM/VLM에 대한 강제 직접 연결 파라미터를 제거하고, 설정에 직접 연결 옵션을 추가했습니다.
* 콘솔 로그 출력 형식을 보다 직관적으로 최적화했습니다.

</details>

<details>
<summary>[2025-10-14] V1.2.1 </summary>

* 어시스턴트 UI 반응 속도를 향상했습니다.
* API 요청 재시도 메커니즘을 강화했습니다.
* 구두점 번역, 불필요한 공백/연속 마침표 자동 제거, 줄바꿈 유지 옵션을 설정에 추가했습니다.
* 태그 창 크기, 마지막 선택 카테고리, 태그 바 스크롤 위치를 기억하도록 개선했습니다.
* API 설정 화면에 모델 목록 자동 가져오기 기능을 추가했습니다.
* Ollama 자동 VRAM 언로드 옵션을 추가했습니다.
* 리스트 뷰에서 노드를 미리 볼 때 각 텍스트 상자에 어시스턴트를 생성할 수 없던 버그를 수정했습니다.

</details>

<details>
<summary>[2025-09-16] V1.2.0 </summary>

* 프롬프트 확장 노드를 추가했습니다.
* 302.AI 및 Ollama 서비스를 추가했습니다.
* 태그 패널에 메모리 기능을 추가했습니다.
* 우클릭 메뉴를 통한 빠른 서비스 전환 기능을 추가했습니다.
* 일부 주류 모델에서 CoT(생각의 사슬) 비활성화를 지원합니다.
* 캡션 및 번역 노드를 최적화했습니다.
* 커뮤니티 피드백 배지를 추가했습니다.
* 드롭다운 메뉴 버그를 수정했습니다.
* 검색된 태그를 패널에서 삽입할 수 없던 버그를 수정했습니다.
* 간혹 요청 오류를 일으키던 base_url 자르기 오류를 수정했습니다.

</details>

</details>

<details>
<summary><strong>V1.1.x </strong></summary>

<details>
<summary>[2025-08-28] V1.1.3 </summary>

* 스크롤바를 자동으로 피하여 우발적인 터치 중복을 방지하도록 UI를 최적화했습니다.
* 태그 팝업에 스크롤바가 생기지 않아 내용이 잘리던 문제를 수정했습니다.

</details>

<details>
<summary>[2025-08-23] V1.1.2 </summary>

* 실행 중 다중 대기열 및 중복 실행 문제를 해결하기 위해 노드를 리팩터링했습니다.
* API 설정 화면에 모델 파라미터를 추가했습니다 (최대 토큰 수를 조절하여 일부 오류를 해결할 수 있습니다).
* 이미지 캡션 워크플로를 간소화하여 속도를 높였습니다.
* 태그 지연 로딩 시 로딩되지 않은 태그를 검색할 수 없던 문제를 수정했습니다.

</details>

<details>
<summary>[2025-08-10] V1.1.1 </summary>

* 이미지 캡션 노드 오류를 수정했습니다.

</details>

<details>
<summary>[2025-08-10] V1.1.0 </summary>

* UI 상호 작용을 수정했습니다.
* OpenAI SDK 호환 API를 모두 지원합니다.
* 사용자 지정 규칙을 추가했습니다.
* 사용자 지정 태그를 추가했습니다.
* 이미지 캡션, Kontext 프리셋 및 번역 노드를 추가했습니다.

</details>

</details>

<details>
<summary><strong>V1.0.x</strong> </summary>

<details>
<summary>[2025-06-24] V1.0.6</summary>

* 몇 가지 UI 버그를 수정했습니다.

</details>

<details>
<summary>[2025-06-24] V1.0.5</summary>

* 선택 도구 모음으로 Kontext 노드 생성 시 어시스턴트 UI 이상을 수정했습니다.
* 네트워크 문제로 인한 Zhipu 서비스 장애를 수정했습니다.
* 인스턴스 지우기 오류로 인한 워크플로 로드 실패를 수정했습니다.
* AIGODLIKE-COMFYUI-TRANSLATION 플러그인과 충돌하여 태그 일시 정지 현상을 수정했습니다.
* 크기 조절이 가능한 태그 패널을 추가했습니다.
* UI 리소스 로드 메커니즘을 최적화했습니다.

</details>

<details>
<summary>[2025-06-24] V1.0.3</summary>

* API 키가 노출되는 것을 방지하기 위해 API 서비스를 리팩터링했습니다.
* 설정이 저장되지 않던 문제를 해결하기 위해 저장/로드 메커니즘을 수정했습니다.
* 사소한 버그를 수정했습니다.

</details>

<details>
<summary>[2025-06-21] V1.0.2</summary>

* 사소한 버그를 수정했습니다.

</details>

<details>
<summary>[2025-06-15] V1.0.0</summary>

* 원클릭 태그 삽입.
* LLM 프롬프트 확장 지원.
* Baidu 번역과 LLM 번역 전환 지원.
* 이미지 캡션 기능.
* 기록, 실행 취소, 다시 실행.

</details>

</details>

</details>

## **✨ 기능 소개**

#### 💡 프롬프트 최적화 + 번역
`다양한 프롬프트 최적화 규칙(Expand, Qwen-edit 명령, Kontext 최적화 및 번역 등) 지원`
`목표 언어 설정 불필요. 국/영 자동 상호 번역 및 번역 캐싱 기능으로 원문 변질 방지.`

![번역최적화](https://github.com/user-attachments/assets/a37b715e-ecfd-47d6-a4b8-a0b1e6bb9fcd)

#### 🖼 이미지 캡션
`이미지 노드에서 이미지를 프롬프트로 빠르게 추출. 중/영 지원 및 다양한 스타일(자연어, 태그 방식 등) 선택 가능.`

![캡션](https://github.com/user-attachments/assets/3713ddc5-4e2e-4412-88ee-077d86f21b99)

#### 🔖 태그, 문구 프리셋 및 즐겨찾기
`자주 사용하는 태그, 문구, Lora 트리거를 수집하여 빠르게 삽입. 즐겨찾기, 커스텀 정렬, 멀티 세트 전환 지원.`

![태그기능](https://github.com/user-attachments/assets/944173be-8167-42eb-93d9-e0c05256ccf8)

#### 🕐 히스토리, 실행 취소, 다시 실행
`문장 단위 기록(입력창 포커스 아웃 시 기록). 실행 취소/다시 실행 및 노드 간 히스토리 조회 지원.`

![히스토리](https://github.com/user-attachments/assets/85868b9e-1bf5-4789-9a71-97af80ef2bc8)

#### 📜 Markdown 및 노드 문서 번역
`Note 노드와 Markdown 노드의 서식을 유지하며 번역.`

![Markdown](https://github.com/user-attachments/assets/c2ac1266-f8c1-4b27-ba41-13c5b5e5e689)
`노드 문서 번역 지원 (Beta: 영어 문서가 있는 노드에만 번역 버튼 노출).`

![NodeDoc](https://github.com/user-attachments/assets/32c9a712-20c3-4b5e-b331-bfb885b7b5d4)

### 📒 노드 소개
카테고리: `✨Prompt Assistant`

#### **🔹 번역 노드**
`✨Prompt Assistant → 프롬프트 번역`
<img width="1700" height="700" alt="번역 노드" src="https://github.com/user-attachments/assets/9dbc9fc9-1b91-43b6-822e-d598b2c8168f" />

#### **🔹 프롬프트 최적화 노드**
`✨Prompt Assistant → 프롬프트 최적화`
<img width="1700" height="911" alt="최적화 노드" src="https://github.com/user-attachments/assets/ea821506-d684-4526-9119-621bb0467ddf" />

#### **🔹 이미지 캡션 노드**
`✨Prompt Assistant → 이미지 캡션 프롬프트`
`이미지를 분석하여 캡션을 생성하고 비각 모델을 연동하여 편집 지침을 최적화합니다.`
<img width="1700" height="800" alt="이미지 캡션 노드" src="https://github.com/user-attachments/assets/8ff3ac96-724a-48d0-8e15-23fe0b28bec1" />
<img width="1700" height="800" alt="시각 지원 편집 모델" src="https://github.com/user-attachments/assets/a95dc0f5-1d46-438f-a242-4087f6e8361a" />

#### **🔹 비디오 캡션 노드**
`✨Prompt Assistant → 비디오 캡션 프롬프트`
<img width="1700" height="1080" alt="비디오 캡션 노드" src="https://github.com/user-attachments/assets/0143096b-24d5-4308-82ff-e0a99144db0b" />
<img width="1700" height="1102" alt="프레임 피커 도구" src="https://github.com/user-attachments/assets/96c2bd08-b26c-4df1-b32c-be8e20328c97" />

## **📦 설치 방법**

### ⚠️ 기존 버전 마이그레이션 안내
`Prompt Assistant V2.0.0 이전 버전을 사용 중이신 경우, API 설정, 커스텀 규칙, 태그 데이터 유실 방지를 위해 기존 플러그인 폴더의 'config' 폴더를 반드시 백업해 주세요.`

**Manager**를 통해 설치하신 경우 바로 업데이트하시면 됩니다. 수동 설치의 경우 기존 폴더 삭제 후(config 백업 필수!!), 새 폴더를 `custom_nodes`에 넣고 config 파일을 복구하는 것을 권장합니다.

#### **ComfyUI Manager를 통한 설치**
Manager에서 `Prompt Assistant`를 검색하여 `Install`을 클릭하세요.

<img width="1800" height="1098" alt="설치" src="https://github.com/user-attachments/assets/167eb467-a77d-4a37-a95b-e935ca354284" />

#### **저장소 복제**
1. ComfyUI 커스텀 노드 폴더로 이동:
   ```bash
   cd ComfyUI/custom_nodes
   ```
2. 저장소 복제:
   ```bash
   git clone https://github.com/yawiii/ComfyUI-Prompt-Assistant.git
   ```
3. ComfyUI 재시작.

#### **Zip 다운로드**
1. [릴리스](https://github.com/yawiii/comfyui_prompt_assistant/releases)에서 최신 버전 다운로드
2. `ComfyUI/custom_nodes`에 압축 해제
`⚠️ 참고: ComfyUI 표준에 맞게 폴더 이름을 "prompt-assistant"로 변경하는 것을 권장합니다.`

<img width="600" height="276" alt="GiHub 설치" src="https://github.com/user-attachments/assets/99783a78-6e0b-42aa-8f9e-7146ebcef5fd" />

### 데이터 자동 마이그레이션
새 버전은 API 설정, 커스텀 규칙, 태그를 자동으로 마이그레이션합니다. 마이그레이션할 파일을 `prompt-assistant/config`에 넣어주세요. 설정 파일은 `ComfyUI\user\default\prompt-assistant`에 저장됩니다.

<img width="600" height="419" alt="마이그레이션" src="https://github.com/user-attachments/assets/90b8f90f-51df-4537-b735-ae07c3cdff7f" />

## **⚙️ 설정 안내**

### API 키 및 모델 설정
<img width="1593" height="1119" alt="설정 페이지" src="https://github.com/user-attachments/assets/ea01c0bc-fe0f-40be-991c-d7833965213a" />
<img width="1569" height="1137" alt="API 창" src="https://github.com/user-attachments/assets/9d982773-2939-480b-a691-bb89a227a9ff" />

### 서비스 설명
커스텀 제공업체를 추가하거나 내장 서비스 중에서 선택할 수 있습니다.
`⚠️ 면책 조항: 본 플러그인은 API 호출 도구만을 제공하며, 제3자 서비스에 대한 책임은 지지 않습니다. 사용자 설정은 로컬에 저장됩니다.`

* **Baidu Translate (MT)**: [Baidu 번역 신청](https://fanyi-api.baidu.com/product/11)
  `속도는 빠르나 품질은 보통입니다. 네트워크 환경에 따라 오류가 발생할 수 있습니다 (월 500만 자 무료).`
* **Zhipu (LLM)**: [Zhipu API 신청](https://www.bigmodel.cn/invite?icode=Wz1tQAT40T9M8vwp%2F1db7nHEaazDlIZGj9HxftzTbt4%3D)
  `고속 및 무제한 할당량; 참고: 엄격한 검열로 인해 빈 결과가 반환될 수 있습니다.`
* **xFlow-API Aggregation**: [xFlow API 신청](https://api.xflow.cc/register?aff=Z063)
  `다양한 모델(Gemini, Grok, ChatGPT...)을 단일 API 키로 이용 가능하며 네트워크 이슈로부터 자유롭습니다.`

## **🎀 도움을 주신 분들**
V2.0.0 규칙 템플릿에 도움을 주신 커뮤니티 분들께 감사드립니다: Adan, CJL, Normandy
