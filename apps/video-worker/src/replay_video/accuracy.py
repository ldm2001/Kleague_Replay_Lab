# 타입 표기의 지연 평가 설정
from __future__ import annotations
# 명령행 인자 읽기와 검증 도구 가져옴
import argparse
# 직렬화 자료 읽기와 기록 도구 가져옴
import json
# 거리 계산과 수치 유효성 확인 도구 가져옴
import math
# 파일과 폴더 경로 도구 가져옴
from pathlib import Path
# 다양한 보고서 값의 타입 표기 가져옴
from typing import Any

# 동일 원본의 공 후보와 개발 라벨을 비교해 좌표 정확도를 계산
def accuracy(summary_path: Path, labels_path: Path) -> dict[str, Any]:
    """개발 정답·공 후보 좌표 비교와 미라벨 프레임의 정답 없음 간주 금지"""
    # 추적 진단 요약 파일의 자료 읽음
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    # 개발 정답 라벨 파일의 자료 읽음
    labels = json.loads(labels_path.read_text(encoding="utf-8"))
    # 요약에 기록된 원본 해시 읽음
    source_hash = summary.get("source_sha256")
    # 요약과 라벨의 원본 해시 일치 여부 확인
    if (
        not isinstance(source_hash, str)
        or len(source_hash) != 64
        or source_hash != labels.get("source_sha256")
    ):
        # 서로 다른 원본의 평가 연결 차단
        raise ValueError("evaluation-source-mismatch")
    # 라벨 파일은 평가 대상 영상의 해시를 명시해야 하며 파일명만으로 연결 금지
    sample_path = summary_path.parent / "context.jsonl"
    # 프레임 번호별 관측 사전 생성
    samples = {}
    # 줄 단위 관측 파일 순회
    for line in sample_path.read_text(encoding="utf-8").splitlines():
        # 한 줄의 관측 자료 해석
        sample = json.loads(line)
        # 관측 프레임 번호 읽음
        index = sample["frame_index"]
        # 같은 프레임의 중복 기록 확인
        if index in samples:
            # 중복 관측 프레임 오류 전달
            raise ValueError("duplicate-sample-frame")
        # 프레임 번호로 관측 자료 저장
        samples[index] = sample
    # 라벨의 프레임 목록 읽음
    frames = labels.get("frames")
    # 평가할 라벨 목록 존재 확인
    if not isinstance(frames, list) or not frames:
        # 비어 있거나 잘못된 라벨 목록 오류 전달
        raise ValueError("evaluation-labels-required")
    # 적중과 오탐 및 누락 등 평가 개수 초기화
    tp = fp = fn = tn = unobservable = unobservable_predictions = wrong_location = 0
    # 화면 대각선 기준 위치 오차 목록 생성
    errors: list[float] = []
    # 평가한 프레임 번호 집합 생성
    used = set()
    # 화면 대각선의 2퍼센트를 위치 허용 오차로 설정
    tolerance = 0.02
    # 정답 프레임별 평가 순회
    for label in frames:
        # 정답 라벨의 프레임 번호 읽음
        index = label["frame_index"]
        # 정수 번호와 관측 존재 및 중복 평가 여부 확인
        if type(index) is not int or index not in samples or index in used:
            # 연결할 수 없는 라벨 프레임 오류 전달
            raise ValueError("invalid-label-frame")
        # 프레임 평가 사용 표시
        used.add(index)
        # 해당 프레임의 추적 관측 읽음
        sample = samples[index]
        # 선택된 공 후보 위치 읽음
        predicted = sample["ball_track"]["candidate"]
        # 정답에서 공의 관측 가능 상태 읽음
        visibility = label.get("visibility")
        # 정답 자체가 관측 불가능한 프레임인지 확인
        if visibility == "UNOBSERVABLE":
            # 관측 불가능 프레임 수 증가
            unobservable += 1
            # 관측 불가능 프레임의 후보 출력 수 기록
            unobservable_predictions += predicted is not None
            # 관측 불가능 프레임의 정오답 채점 제외
            continue
        # 공 부재가 확인된 정답인지 확인
        if visibility == "ABSENT":
            # 공 부재 라벨과 위치값의 모순 확인
            if label.get("ball") is not None:
                # 모순된 공 라벨 오류 전달
                raise ValueError("contradictory-ball-label")
            # 공 부재 프레임에 후보가 있으면 오탐 증가
            fp += predicted is not None
            # 공 부재 프레임에 후보가 없으면 올바른 부재 증가
            tn += predicted is None
            # 공 부재 프레임의 좌표 오차 계산 제외
            continue
        # 공이 보인다는 허용 라벨 값 확인
        if visibility != "VISIBLE":
            # 지원하지 않는 가시성 라벨 오류 전달
            raise ValueError("invalid-visibility-label")
        # 정답 공 위치 읽음
        ball = label.get("ball")
        # 정규화 좌표의 수치 타입과 유한성 및 범위 확인
        if not isinstance(ball, dict) or any(
            type(ball.get(axis)) not in (int, float)
            or not math.isfinite(ball[axis])
            or not 0 <= ball[axis] <= 1
            for axis in ("x", "y")
        ):
            # 유효하지 않은 정답 공 좌표 오류 전달
            raise ValueError("invalid-ball-label")
        # 공이 보이는데 선택 후보가 없는지 확인
        if predicted is None:
            # 탐지하지 못한 공의 누락 수 증가
            fn += 1
            # 후보가 없어 좌표 비교 건너뜀
            continue
        # 관측 영상의 가로와 세로 크기 읽음
        width, height = sample["width"], sample["height"]
        # 정답을 픽셀로 바꿔 후보 거리의 대각선 비율 계산
        distance = math.hypot(
            predicted["x"] - ball["x"] * width, predicted["y"] - ball["y"] * height
        ) / math.hypot(width, height)
        # 평가한 위치 오차 목록에 추가
        errors.append(distance)
        # 위치 오차의 허용 범위 충족 확인
        if distance <= tolerance:
            # 정답 위치에 가까운 적중 수 증가
            tp += 1
        # 정답 위치 허용 오차를 벗어난 후보 분기
        else:
            # 엉뚱한 물체를 잡으면 공 누락과 잘못된 후보 선택을 모두 기록
            fp += 1
            # 다른 물체 선택에 따른 실제 공 누락 수 증가
            fn += 1
            # 잘못된 위치 선택 건수 증가
            wrong_location += 1
    # 후보 좌표 평가 결과 반환과 경기 판단 정확도 해석 제외
    return {
        # 평가 대상 원본 해시 보존
        "source_sha256": source_hash,
        # 평가 대상 추출기 버전 보존
        "extractor_version": summary["extractor_version"],
        # 실제 사용한 정답 프레임 수 기록
        "labelled_frames": len(used),
        # 정답이 없어 채점하지 않은 관측 수 기록
        "unlabelled_samples": len(samples) - len(used),
        # 관측 불가능 프레임을 제외한 평가 수 기록
        "evaluated_frames": len(used) - unobservable,
        # 올바르게 선택한 후보 수 기록
        "true_positive": tp,
        # 잘못 선택한 후보 수 기록
        "false_positive": fp,
        # 보이는 공을 놓친 수 기록
        "false_negative": fn,
        # 공 부재를 올바르게 유지한 수 기록
        "true_negative": tn,
        # 다른 위치의 물체를 선택한 수 기록
        "wrong_location": wrong_location,
        # 선택 후보 중 적중 비율 기록과 분모 없음 구분
        "precision": tp / (tp + fp) if tp + fp else None,
        # 보이는 정답 공 중 적중 비율 기록과 분모 없음 구분
        "recall": tp / (tp + fn) if tp + fn else None,
        # 화면 대각선으로 정규화한 평균 위치 오차 기록
        "mean_error_diagonal": sum(errors) / len(errors) if errors else None,
        # 위치 일치 허용 비율 기록
        "match_tolerance_diagonal": tolerance,
        # 정답 관측 불가능 프레임 수 기록
        "unobservable_frames": unobservable,
        # 관측 불가능한데 후보를 출력한 수 기록
        "unobservable_with_prediction": unobservable_predictions,
        # 평가 범위를 선택 공 후보로 제한
        "scope": "SELECTED_BALL_CANDIDATE_ONLY",
    }

# 명령행 인자 검증과 진단·영상 작업 실행
def main() -> None:
    # 공 후보 좌표 평가용 명령행 해석기 생성
    parser = argparse.ArgumentParser(description="개발용 공 후보 좌표 평가")
    # 진단 요약 파일 경로 인자 등록
    parser.add_argument("summary", type=Path)
    # 정답 라벨 파일 경로 인자 등록
    parser.add_argument("labels", type=Path)
    # 필수 명령행 인자 읽음과 형식 확인
    args = parser.parse_args()
    # 비유한 수를 금지한 평가 결과 출력
    print(
        json.dumps(
            accuracy(args.summary, args.labels), ensure_ascii=False, indent=2, allow_nan=False
        )
    )


# 파일의 직접 실행 여부 확인
if __name__ == "__main__":
    # 평가 명령행 진입점 실행
    main()
