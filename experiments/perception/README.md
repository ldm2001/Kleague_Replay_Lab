# 검출·추적 실증

원본 영상에서 RT-DETR-R18로 사람과 스포츠 공을 검출하고 ByteTrack으로 관측 상자를 연결하는 독립 개발 도구다
기존 `inspect`와 `observe` CLI는 독립 진단으로 유지한다
2026년 9월 12일 승인된 운영 연결은 별도 `operational` 경로에서 실행하며 [Worker 실행 계약](../../apps/video-worker/README.md)을 따른다
실행 완료는 판정 완료가 아니며 모든 출력의 인식 채택 상태는 `NOT_ADMITTED`다

## 설치

Python 3.11 환경을 기준으로 검증했다
아래 명령은 이 디렉터리에서 실행한다
기존 검출 전용 `.venv`는 유지한다. 운영 Worker는 아래의 승인된 심판 관측용 `.venv-referee`를 사용한다

```sh
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

`requirements.txt`는 주요 의존성을 고정한다
`requirements-macos-py311.lock`은 실제 검증에 사용한 macOS arm64 / Python 3.11.9의 전체 패키지 기록이며 다른 OS의 설치 호환성을 보장하지 않는다
동일 환경을 재현할 때는 위 설치 명령의 파일명을 이 lock 파일로 바꾼다
합성 미디어 테스트에는 PATH의 FFmpeg와 ffprobe가 필요하다

## 모델 준비

```sh
PYTHONPATH=src .venv/bin/python -m replay_perception.fetch_model
```

고정된 공식 HTTPS 주소에서만 모델과 설정을 내려받는다
기본 경로는 `~/.cache/replay-lab/models/rtdetr_r18vd/ac77a11ff0170a41b771c03264987f8ce2b0d753`이다
선택적으로 저장소 밖의 모델 디렉터리를 위치 인자로 지정할 수 있다
가중치와 설정 및 모델 카드의 크기와 SHA256은 [model-manifest.json](src/replay_perception/model-manifest.json)에 고정했다
기존 파일이 잘못되었으면 자동 교체하지 않고 실패한다
검사 명령은 모델을 자동 다운로드하지 않으며 로컬 검증 파일만 읽는다

공식 모델은 [PekingU/rtdetr_r18vd](https://huggingface.co/PekingU/rtdetr_r18vd)이며 추적기는 [trackers](https://github.com/roboflow/trackers)의 ByteTrackTracker다
둘 다 Apache-2.0 기반이며 이 일반 COCO 모델은 선수와 심판 역할을 구분하지 않는다

## 실행

입력은 사용 권한이 있는 저장소 밖의 로컬 영상 파일로 지정한다
출력도 저장소 밖의 **아직 존재하지 않는** 디렉터리여야 한다

```sh
PYTHONPATH=src .venv/bin/python -m replay_perception.inspect \
  '/absolute/path/highlight.mp4' '/absolute/path/new-inspection-output' \
  --device cpu
```

Apple Silicon에서는 `--device mps`로 개발 가속을 사용할 수 있다
지원되지 않는 장치를 지정하면 몰래 CPU로 바꾸지 않고 실패한다
특정 구간은 `--start-ms 115000 --end-ms 160000`으로 지정하며 끝 시각은 제외한다
모델 위치를 바꿨다면 `--model-dir '/absolute/path/model-cache'`를 함께 지정한다
기본 추론 간격은 500ms이며 원본 전체 프레임 추론이 아니다
실제 선택 시각은 명목 FPS가 아닌 원본 PTS를 사용한다
CLI 종료 코드는 완료 시 0, 실패 시 1이다

## 산출물

| 파일 | 내용 |
|---|---|
| `summary.json` | 실행 상태, 인식 채택 상태, 원본 SHA256, 모델 해시, 장치·패키지·설정, 수량, 시간, 메모리, 미리보기 메타데이터 |
| `frames.jsonl` | 선택 프레임의 원본 PTS·time_base·좌표와 검출 점수·검출 ID·선택적 추적 ID |
| `frames/*.jpg` | 원본 좌표에 상자와 ID를 그린 제한 수량의 검토용 이미지 |

미리보기는 최대 24장으로 제한되며 장면별 정확도 평가용 표본 설계는 아니다
검출 상자는 원본 크기의 `xyxy` 픽셀 좌표이고 JPEG의 축소 비율을 별도 기록한다
역할은 `UNPROVEN`, 본방·리플레이 여부는 `UNKNOWN`이다
추적 ID는 같은 화면 구간의 연결 가설이며 실제 선수 식별자나 인원수가 아니다
가려진 프레임에 예측 상자를 새 관측으로 만들어 넣지 않는다

출력이 시작된 뒤 오류가 나면 가능한 범위에서 부분 기록과 `FAILED` 요약을 남긴다
모델 누락·잘못된 입력 같은 실행 전 오류는 출력 폴더 없이 실패할 수 있다
디스크 쓰기 자체가 불가능한 상황에서 요약 파일 보존을 보장하지 않는다
1,800초와 30,000표본 한도는 표본 사이에 검사하므로 멈춘 디코더·추론을 강제 중단하는 운영 타임아웃은 아니다

## 심판 역할·자세 관측

추가 승인된 YOLO11m 축구 역할 모델과 ViTPose++ small은 별도 환경에서 실행한다
기존 사람 검출은 UNPROVEN으로 보존하고 역할 가설·17관절·팔 올림 후보를 별도 기록에 둔다
주심·부심 세부 구분, 깃발 자체, 카드, 접촉, 원심과 재개 및 파울 판정은 아직 이 명령의 지원 범위가 아니다

```sh
python3.11 -m venv .venv-referee
.venv-referee/bin/python -m pip install -r requirements-referee.txt
PYTHONPATH=src .venv-referee/bin/python -m replay_perception.fetch_observer_models
PYTHONPATH=src .venv-referee/bin/python -m replay_perception.observe \
  '/absolute/path/highlight.mp4' '/absolute/path/previous-detection-output' \
  '/absolute/path/new-observation-output' --device cpu
```

Mac 개발 가속은 `--device mps`로 지정한다. 모델을 다른 곳에 준비했다면 `--role-model-dir`와 `--pose-model-dir`를 사용한다
이 명령도 자동 모델 다운로드나 외부 추론을 하지 않는다
입력 폴더는 기존 inspect가 완료한 `summary.json`과 `frames.jsonl`을 가져야 한다
원본 파일 해시와 upstream 두 파일 해시, 모든 선택 프레임의 PTS·time_base·원점·크기를 확인하고 원본을 다시 디코드한다
기존 검출·추적은 다시 계산하지 않으며 이전 JPEG를 모델 입력으로 사용하지 않는다
짧은 팔 동작에는 500ms 표본이 부족할 수 있다. 검증에 사용한 100ms 표본은 개발용 inspect API의 `interval_ms=100`으로 생성했다

출력은 `observations.jsonl`, `arm-candidates.jsonl`, `summary.json`과 제한 수량의 JPEG다
역할 점수와 겹침 IoU, 관절의 원시 점수와 원본 좌표, 팔의 관측 가능 상태를 분리한다
같은 추적 조각에서 세 관측 이상·200ms 이상 팔 올림이 이어져야 후보를 만들며 250ms 초과 공백은 연결하지 않는다
한 동작이 여러 후보로 끊길 수 있으므로 후보 수를 사건 수나 파울 수로 해석하지 않는다

역할 모델·Ultralytics의 AGPL-3.0과 자세 모델의 Apache-2.0 조건은 [승인 설계](../../docs/design/심판관측.md)에 기록했다
로컬 Worker 연결은 승인됐지만 공개 서비스 배포의 라이선스 적합성까지 검증한 것은 아니다. 원본 영상의 사용 권한도 모델 라이선스와 별개다
모델 파일은 [observer-models.json](src/replay_perception/observer-models.json)에 고정한 크기·SHA256으로 검증한다
다운로드는 HTTPS만 허용하고 별도 프로세스의 제한시간을 넘기면 종료하며 검증 전 파일을 최종 캐시로 게시하지 않는다

## 검증과 확인한 한계

```sh
.venv-referee/bin/python -m pytest tests -q -W error
```

실제 K리그2 하이라이트에서 전체 디코드와 검출·추적·출력 경로를 실행했다
사람 중복 상자, 공 오검출 의심, 낮은 표본 빈도의 짧은 추적 조각이 남았다
검출 수와 추적 ID 수는 정확도와 실제 사람·공 개수가 아니다
정답 주석이 없으므로 정밀도·재현율이나 추적 정확도를 주장하지 않는다
화면 차이 기반 추적 초기화는 컷을 놓치거나 큰 움직임에서 과하게 초기화될 수 있다

전체 검사에는 위 심판 관측 환경이 필요하다. 실제 YOLO 가중치의 추가 CPU/MPS 검사는 `REPLAY_ROLE_MODEL_DIR`에 준비한 모델 경로를 지정하면 실행한다
`requirements-referee-macos-py311.lock`은 검증한 Mac 환경의 전체 패키지 기록이며 다른 OS 호환성이나 배포 적합성을 보장하지 않는다
원래 `.venv`는 기존 검출 전용 환경으로 유지한다

독립 CLI 외에 `official_objects.py`와 `incident_links.py`는 손 주변 깃발/카드 형태·세부 심판 역할 가설·영상 접근 후보와 연결 후보를 기록한다
실제 접촉·카드 제시·원심·재개 종류와 파울의 검증된 사실은 생산하지 않는다
`operational.py`는 세 모델을 같은 원본 프레임에서 실행하고 비공개 압축 파일과 제한된 요약을 Worker에 전달한다
현재 모든 새 인식 방법의 채택 상태는 `NOT_ADMITTED`이며 실영상에서 세부 역할·카드 인식 검증을 통과했다고 주장하지 않는다
CPU/MPS 처리시간은 해당 로컬 장치의 측정일 뿐 클라우드 속도·메모리·월 비용으로 환산하지 않는다
설계는 [인식모델](../../docs/design/인식모델.md), 실행 수치와 실패 사례는 [인식실증](../../docs/analysis/인식실증.md)을 따른다
후속 모델의 실제 실행과 한계는 [심판 인식 실증](../../docs/analysis/심판인식실증.md)에 기록한다
