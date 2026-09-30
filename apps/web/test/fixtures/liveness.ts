// 잠금 이후 작업 대상 생존 조건 질의 여부 확인
export const livenessQuery = (query: Readonly<{ sql: string }>) =>
    query.sql.includes("as live from processing_jobs");

// 생존 조건 질의의 모든 기준 시각이 보존 기한보다 앞설 때만 생존 행을 돌려주는 데이터베이스 평가 모의 생성
export const liveness = (
    query: Readonly<{ params: readonly unknown[] }>,
    jobId: string,
    expiresAt: string
) => {
    // 작업 식별자를 제외한 기준 시각 인자 목록 읽음
    const moments = query.params.filter((param) => param !== jobId);
    // 기준 시각이 있고 모두 보존 기한 이전일 때만 생존 행 반환
    return [
        {
            live:
                moments.length > 0 &&
                moments.every((moment) => Date.parse(String(moment)) < Date.parse(expiresAt))
        }
    ];
};
