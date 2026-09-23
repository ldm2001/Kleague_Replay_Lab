"""원시 기록·공개 전송 변경 없는 비공개 산출물 확장"""
import gzip
import hashlib
import json
import os
from pathlib import Path
import tempfile
from ..domain.interactions import InteractionObservations, METHOD

# 압축 해제된 전체 관측 자료의 바이트 상한 정의
MAX_RAW_BYTES = 512 * 1024 * 1024
# 압축 산출물의 바이트 상한 정의
MAX_COMPRESSED_BYTES = 128 * 1024 * 1024
# 단일 관측 행의 바이트 상한 정의
MAX_ROW_BYTES = 8 * 1024 * 1024
# 측정 확장에 사용할 최대 프레임 수 정의
MAX_FRAMES = 30_000

# 입력의 해시 식별값을 계산
def digest(path):
    # 내용 해시 계산을 위해 파일을 바이트 스트림으로 열기
    with path.open("rb") as stream:
        # 파일 바이트에서 계산한 비교용 해시 문자열 반환
        return hashlib.file_digest(stream, "sha256").hexdigest()

# 참조 파일이 허용된 출력 디렉터리 안에 있는지 확인
def inside(root, path):
    # 상대 참조와 심볼릭 링크를 실제 경로로 해석
    resolved = (root / path).resolve()
    # 실제 파일이 허용된 출력 경계 내부에 있는지 확인
    if not resolved.is_relative_to(root) or not resolved.is_file():
        # 출력 경계 밖 또는 없는 근거 파일 거부
        raise ValueError("OBSERVATION_FILE_INVALID")
    # 검증한 근거 파일의 실제 경로 반환
    return resolved

# 원시 산출물 검증과 상호작용 측정 확장 파일 게시
def enrichment(root, artifact, source_sha256, shots, evidence, check_cancelled=None):
    # 모든 근거 참조의 기준 출력 경로 정규화
    root = Path(root).resolve()
    # 확장할 원시 관측 파일의 출력 경계 확인
    path = inside(root, artifact["path"])
    # 압축 형식과 실제 크기 및 해시가 산출물 참조와 일치하는지 확인
    if (
        artifact.get("contentType") != "application/gzip"
        or path.stat().st_size != artifact["sizeBytes"]
        or not 0 < path.stat().st_size <= MAX_COMPRESSED_BYTES
        or digest(path) != artifact["contentSha256"]
    ):
        # 파일 내용과 참조 메타데이터가 일치하지 않는 산출물 거부
        raise ValueError("OBSERVATION_ARTIFACT_UNVERIFIED")
    # 원본을 덮어쓰지 않을 별도 측정 확장 파일 경로 생성
    target = path.with_name("interaction-observations.jsonl.gz")
    # 이전 측정 확장 산출물이 이미 존재하는지 확인
    if target.exists():
        # 기존 확장 결과를 덮어쓰지 않고 중단
        raise FileExistsError(target)
    # 측정과 연결할 검증된 프레임·클립 목록 생성
    media = []
    # 보고서 증거 번호를 유지하면서 각 파일 검증
    for index, item in enumerate(evidence):
        # 대량 파일 처리 중 취소 검사 함수 존재 여부 확인
        if check_cancelled:
            # 취소된 작업의 근거 확장 처리 중단
            check_cancelled()
        # 증거 미디어의 실제 파일 위치와 출력 경계 확인
        media_path = inside(root, item.path)
        # 지원하는 증거 종류와 원본 시간 범위 확인
        if item.kind not in ("FRAME", "CLIP") or not 0 <= item.start_ms <= item.end_ms:
            # 잘못된 종류 또는 시간 범위의 미디어 근거 거부
            raise ValueError("OBSERVATION_MEDIA_INVALID")
        # 증거의 시간 범위와 파일 내용 해시를 검증 목록에 보존
        media.append(
            {
                "evidenceIndex": index,
                "kind": item.kind,
                "path": media_path.relative_to(root).as_posix(),
                "timestampMs": item.timestamp_ms,
                "startMs": item.start_ms,
                "endMs": item.end_ms,
                "contentSha256": digest(media_path),
            }
        )
    # 원본 해시로 격리된 중립 화면 측정기 생성
    engine = InteractionObservations(source_sha256)
    # 완성 전 결과가 노출되지 않도록 같은 디렉터리에 임시 파일 생성
    fd, temporary = tempfile.mkstemp(prefix=".interaction-", dir=path.parent)
    # 임시 파일 이름을 경로 객체로 변환
    temporary = Path(temporary)
    # 고유 후보·관측·측정 성공·누락 사유·프레임 집계 초기화
    candidate_ids, count, measured, missing, frames = set(), 0, 0, {}, 0
    # 입력과 확장 출력의 비압축 바이트 누계 초기화
    raw_bytes = output_bytes = 0
    # 실패 여부와 무관하게 임시 파일을 정리할 보호 구간 시작
    try:
        # 임시 파일에 재현 가능한 시간 헤더의 압축 쓰기 스트림 열기
        with os.fdopen(fd, "wb") as output, gzip.GzipFile(
            fileobj=output, mode="wb", mtime=0
        ) as packed:

            # 행 크기·총 용량 확인 후 확장 산출물에 줄 단위 직렬화 자료 기록
            def entry(value):
                # 중첩 기록 함수에서 바깥쪽 출력 바이트 누계 사용
                nonlocal output_bytes
                # 비유한 수치를 거부하며 관측 한 건을 줄 단위 바이트로 직렬화
                data = (json.dumps(value, allow_nan=False, separators=(",", ":")) + "\n").encode()
                # 확장된 전체 비압축 출력 크기 누적
                output_bytes += len(data)
                # 한 행과 전체 비압축·압축 출력의 크기 상한 확인
                if (
                    len(data) > MAX_ROW_BYTES
                    or output_bytes > MAX_RAW_BYTES
                    or output.tell() > MAX_COMPRESSED_BYTES
                ):
                    # 행 또는 전체 산출물 크기 상한 초과로 기록 중단
                    raise ValueError("OBSERVATION_OUTPUT_LIMIT")
                # 검사한 관측 행을 압축 스트림에 기록
                packed.write(data)

            # 원시 관측 압축 파일을 줄 단위 읽기 스트림으로 열기
            with gzip.open(path, "rb") as source:
                # 원시 관측 출처 연결용 행 번호 초기화
                line_number = 0
                # 행 크기 초과를 탐지할 수 있는 범위까지만 압축 해제하여 읽음
                while line := source.readline(MAX_ROW_BYTES + 1):
                    # 현재 원시 관측의 실제 행 번호 증가
                    line_number += 1
                    # 대량 파일 처리 중 취소 검사 함수 존재 여부 확인
                    if check_cancelled:
                        # 취소된 작업의 근거 확장 처리 중단
                        check_cancelled()
                    # 압축 해제하여 읽은 원시 자료 크기 누적
                    raw_bytes += len(line)
                    # 행 크기와 전체 압축 해제 크기 상한 확인
                    if len(line) > MAX_ROW_BYTES or raw_bytes > MAX_RAW_BYTES:
                        # 과도한 압축 해제 또는 거대 행 입력 거부
                        raise ValueError("OBSERVATION_INPUT_LIMIT")
                    # 현재 원시 관측 행을 구조화 자료로 읽음
                    row = json.loads(line)
                    # 파일 첫 행의 원본 출처와 확장 헤더 처리
                    if line_number == 1:
                        # 첫 행이 예상한 원본 영상의 헤더인지 확인
                        if row.get("kind") != "HEADER" or row.get("sourceSha256") != source_sha256:
                            # 잘못된 헤더 또는 다른 원본의 파일 거부
                            raise ValueError("OBSERVATION_HEADER_INVALID")
                    # 이미 측정이 추가된 산출물을 다시 확장하는지 확인
                    if str(row.get("kind", "")).startswith("INTERACTION_OBSERVATION"):
                        # 중복 측정 확장 거부
                        raise ValueError("OBSERVATION_ALREADY_ENRICHED")
                    # 원시 관측의 자료 내용을 유지한 채 확장 파일에 복사
                    entry(row)
                    # 파일 첫 행의 원본 출처와 확장 헤더 처리
                    if line_number == 1:
                        # 확장 방법 출처 또는 최종 처리 집계를 별도 기록으로 추가
                        entry(
                            {
                                "kind": "INTERACTION_OBSERVATION_HEADER",
                                "schemaVersion": "interaction-observation-v1",
                                "sourceSha256": source_sha256,
                                "method": METHOD,
                                "upstreamArtifactSha256": artifact["contentSha256"],
                                # 이번 측정에 사용한 실제 구현 파일 해시 보존
                                "implementationSha256": {
                                    "adapter": digest(Path(__file__)),
                                    "measurements": digest(
                                        Path(__file__).parent.parent / "domain/interactions.py"
                                    ),
                                },
                                # 규정 판단 사실로 승인되지 않은 측정임을 명시
                                "admission": "NOT_ADMITTED",
                            }
                        )
                    # 실패 기록으로 표본 연속성이 끊긴 경우 확인
                    if row.get("kind") in ("FRAME_FAILURE", "RUN_FAILURE"):
                        # 실패 구간을 가로질러 변위를 계산하지 않도록 이력 초기화
                        engine.reset()
                    # 화면 표본이 아닌 메타데이터와 실패 기록인지 확인
                    if row.get("kind") != "FRAME":
                        # 원시 기록은 보존하되 화면 측정 생성만 건너뜀
                        continue
                    # 측정 대상으로 읽은 프레임 수 누적
                    frames += 1
                    # 프레임 처리 상한 확인
                    if frames > MAX_FRAMES:
                        # 지나치게 많은 표본의 확장 처리 중단
                        raise ValueError("OBSERVATION_FRAME_LIMIT")
                    # 현재 프레임의 원본 상대 시각 읽음
                    ms = row["frame"]["timestampMs"]
                    # 시작 포함·종료 제외 규칙으로 현재 시각의 샷 탐색
                    matching = [s for s in shots if s.start_ms <= ms < s.end_ms]
                    # 샷이 유일하면 샷 번호를 쓰고 모호하면 미연결 연속 구간 표시
                    segment = (
                        f"shot-{matching[0].index}"
                        if len(matching) == 1
                        else f"unmapped-{row['continuityId']}"
                    )
                    # 현재 표본의 참여자 쌍별 중립 측정 생성
                    for observation in engine.update(row, segment):
                        # 중복 없이 관측된 중립 후보 식별자 수집
                        candidate_ids.add(observation["candidateId"])
                        # 생성한 측정 관측 수 누적
                        count += 1
                        # 원시 파일 해시와 행 번호 및 행 해시로 출처 연결
                        observation["upstream"] = {
                            "artifactSha256": artifact["contentSha256"],
                            "lineNumber": line_number,
                            "rowSha256": hashlib.sha256(line).hexdigest(),
                        }
                        # 시간 변화 측정을 포함한 가장 이른 근거 시각 계산
                        earliest = min(m["startMs"] for m in observation["measurements"].values())
                        # 현재 시각에 해당하는 프레임 또는 시간을 포함하는 클립 연결
                        observation["evidence"] = [
                            {
                                **item,
                                # 변위 계산에 필요한 직전 표본까지 클립이 포함하는지 기록
                                "coversMeasurementWindow": item["kind"] == "CLIP"
                                and item["startMs"] <= earliest
                                and item["endMs"] >= ms,
                            }
                            for item in media
                            if (item["kind"] == "FRAME" and item["timestampMs"] == ms)
                            or (item["kind"] == "CLIP" and item["startMs"] <= ms <= item["endMs"])
                        ]
                        # 대응하는 미디어가 없으면 근거 누락 사유 보존
                        observation["evidenceReasons"] = (
                            [] if observation["evidence"] else ["MEDIA_EVIDENCE_NOT_LINKED"]
                        )
                        # 유일한 샷으로 연결되지 못한 시각인지 확인
                        if len(matching) != 1:
                            # 샷 연결 불가를 관측 부재와 구분해 기록
                            observation["evidenceReasons"].append("SHOT_MAPPING_UNAVAILABLE")
                        # 각 화면 측정의 성공과 누락 사유 집계
                        for value in observation["measurements"].values():
                            # 실제 수치가 생성된 측정만 성공 수에 합산
                            measured += value["state"] == "MEASURED"
                            # 측정 불가 사유별 빈도 누적
                            for reason in value["reasons"]:
                                # 같은 측정 불가 사유의 발생 수 증가
                                missing[reason] = missing.get(reason, 0) + 1
                        # 원시 행 출처와 미디어 근거를 연결한 중립 관측 기록
                        entry(observation)
                # 헤더조차 없는 빈 입력 파일인지 확인
                if not line_number:
                    # 비어 있는 원시 관측 파일 거부
                    raise ValueError("OBSERVATION_HEADER_MISSING")
            # 처리 도중 원시 관측 파일이 변경되었는지 재확인
            if digest(path) != artifact["contentSha256"]:
                # 출처가 바뀐 원시 관측의 확장 결과 게시 중단
                raise ValueError("OBSERVATION_INPUT_CHANGED")
            # 연결에 사용한 모든 미디어 파일 무결성 재확인
            for item in media:
                # 처리 도중 근거 파일 위치 또는 내용이 변경되었는지 확인
                if digest(inside(root, item["path"])) != item["contentSha256"]:
                    # 변경된 미디어를 참조하는 측정 결과 게시 중단
                    raise ValueError("OBSERVATION_MEDIA_CHANGED")
            # 확장 방법 출처 또는 최종 처리 집계를 별도 기록으로 추가
            entry(
                {
                    "kind": "INTERACTION_OBSERVATION_SUMMARY",
                    "sourceSha256": source_sha256,
                    "frameCount": frames,
                    "candidateCount": len(candidate_ids),
                    "observationCount": count,
                    "measuredValueCount": measured,
                    "missingMeasurementReasons": missing,
                    # 행동 유형을 분류한 사건이 없음을 측정 수와 별도로 기록
                    "typedIncidentCount": 0,
                    "reason": "ACTION_TYPE_AND_DIRECTION_METHODS_UNAVAILABLE",
                }
            )
        # 압축 마무리 후 실제 최종 파일 크기 재확인
        if temporary.stat().st_size > MAX_COMPRESSED_BYTES:
            # 행 또는 전체 산출물 크기 상한 초과로 기록 중단
            raise ValueError("OBSERVATION_OUTPUT_LIMIT")
        # 게시할 확장 파일의 상대 경로·형식·해시·크기 구성
        result = {
            "path": target.relative_to(root).as_posix(),
            "contentType": "application/gzip",
            "contentSha256": digest(temporary),
            "sizeBytes": temporary.stat().st_size,
        }
        # 이미 존재하는 이름을 덮어쓰지 않고 완성된 파일만 공개
        os.link(temporary, target)  # 기존 산출물 교체 없이 원자적 게시
        # 원시 파일 대신 참조할 측정 확장 산출물 정보 반환
        return result
    # 성공 또는 실패와 관계없이 임시 이름 정리
    finally:
        # 게시된 파일 링크는 유지하고 임시 파일 이름 제거
        temporary.unlink(missing_ok=True)
