import { client } from "../database";
import { incidentQuery } from "../adapters/incidents";
import type { IncidentQueryInput } from "../apis/incidents";

// 비공개 조회 전용 의존성을 공개 분석 응답과 분리하여 조립
let cached: ReturnType<typeof dependencies> | undefined;

// 실행 설정을 고정한 내부 조회 저장소 생성
function dependencies() {
    const key = process.env.WORKER_AUTH_TOKEN;
    if (!key || !process.env.DATABASE_URL) throw new Error("INCIDENT_QUERY_CONFIG_REQUIRED");
    const database = client(process.env.DATABASE_URL);
    return { key, query: (input: IncidentQueryInput) => incidentQuery(database, input, new Date().toISOString()) };
}

// 요청 사이에서 재사용할 내부 조회 의존성 반환
export function incidentDependencies() {
    return cached ??= dependencies();
}
