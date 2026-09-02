# Replay Lab Video Worker

현재 단계는 실제 미디어 파일을 대상으로 하는 영상 파이프라인의 기준 구현이다

```text
ffprobe 메타데이터 확인
→ OpenCV 샷 경계 탐지
→ 움직임 급증 기반 검토 후보 생성
→ 후보 전후 프레임 추출
→ FFmpeg 짧은 증거 클립 생성
→ report.json 기록
```

## 디렉터리

```text
apps/video-worker/
├── pyproject.toml
├── README.md
├── src/
│   └── replay_video/          # namespace package · init 파일 없음
│       ├── cli.py             # CLI 진입점
│       ├── worker.py          # Job 실행 경계
│       ├── http.py            # 내부 API Client
│       ├── runner.py          # Worker 반복 실행
│       ├── application/       # 파이프라인 조립
│       │   ├── pipeline.py
│       │   └── ports.py        # 파이프라인 Port
│       ├── domain/             # 순수 결과 모델
│       │   └── models.py
│       └── infrastructure/    # ffprobe·OpenCV·FFmpeg 구현
│           ├── ports.py        # 미디어 Adapter 조립
│           ├── candidates.py
│           ├── evidence.py
│           ├── probe.py
│           ├── shots.py
│           └── signals.py
└── tests/
    ├── test_http.py
    ├── test_pipeline.py
    ├── test_runner.py
    └── test_worker.py
```

## 실행

```bash
npm run test:video

cd apps/video-worker
python3 -m pip install -e .

# 설치 후 실행
replay-video \
  /path/to/highlight.mp4 \
  /tmp/replay-lab-result

# 소스에서 직접 실행할 때
PYTHONPATH=src python3 -m replay_video.cli \
  /path/to/highlight.mp4 \
  /tmp/replay-lab-result
```

사이트 연결 Worker 실행

```bash
cd ../..
set -a
source apps/web/.env.local
set +a
npm run dev:worker
```

결과 디렉터리에는 `report.json`과 후보별 `frames`와 `clips`가 생성된다

현재 후보 범주는 `OTHER`로 기록한다 이 단계는 샷과 시간 근거를 만드는 기준선이며 파울과 핸드볼과 차징과 득점 취소를 분류하는 모델은 아직 연결하지 않는다 `report.json`의 `limitations`에도 이 한계를 기록한다

Application 파이프라인은 `PipelinePorts`만 사용
실제 미디어 구현은 `infrastructure.ports.media`에서 조립

Job 경계는 `replay_video.worker.job`으로 제공한다 현재 `VALIDATE_VIDEO`는 영상 메타데이터를 검증하고 `ANALYZE_VIDEO`는 위 파이프라인 전체를 실행한다

`replay_video.runner`는 Nextjs 내부 API에서 작업을 선점하고 Lease를 갱신하고 원본 영상을 내려받아 결과를 제출한다

후보는 최대 40건까지 저장하고 상위 8건의 프레임과 클립을 Object Storage에 업로드한다

다음 단계에서 선수와 공과 포즈 추적과 사건별 분류기를 추가한다
