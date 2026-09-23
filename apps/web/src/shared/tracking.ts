// 공 후보 추적의 비공개 요약의 자료 구조 정의
export type TrackingSummary = Readonly<{
    // 확인할 버전
    version: "ball-path-v1";
    // 원본에서 실제로 처리한 시간 범위
    coverage: "COMPLETE" | "PARTIAL";
    // 검사한 전체 표본 수
    sampleCount: number;
    // 대상을 선택할 수 있었던 표본 수
    selectedCount: number;
    // 카메라 보정에 성공한 표본 수
    cameraCount: number;
    // 움직임 시작으로 관측한 시각 목록
    motionOnsetsMs: readonly number[];
}>;

// 작업자와 저장소 모두의 경계에서 수량과 원본 시간 범위를 재검증
export function trackingData(
    value: unknown,
    startMs: number,
    endMs: number
): value is TrackingSummary {
    // 추적 요약이 일반 객체 형태인지 확인
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    // 구조 검사를 통과한 입력을 추적 요약 객체로 참조
    const item = value as Record<string, unknown>;

    // 수량 처리
    const count = (n: unknown): n is number =>
        typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000;
    // 표본 수의 포함 관계와 움직임 시작 시각의 구간 범위 확인 결과 반환
    return (
        item.version === "ball-path-v1" &&
        (item.coverage === "COMPLETE" || item.coverage === "PARTIAL") &&
        count(item.sampleCount) &&
        count(item.selectedCount) &&
        count(item.cameraCount) &&
        item.cameraCount <= item.selectedCount &&
        item.selectedCount <= item.sampleCount &&
        Array.isArray(item.motionOnsetsMs) &&
        item.motionOnsetsMs.length <= Math.floor(item.cameraCount / 2) &&
        item.motionOnsetsMs.every(
            (time, index, times) =>
                typeof time === "number" &&
                Number.isSafeInteger(time) &&
                time >= startMs &&
                time <= endMs &&
                (index === 0 || time > times[index - 1])
        )
    );
}
