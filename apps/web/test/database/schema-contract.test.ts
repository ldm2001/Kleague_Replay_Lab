// 데이터베이스 스키마 테스트
import { describe, expect, it } from "vitest";
import { schema } from "@replay/database";

describe("database schema public contract", () => {
    it("exports every MVP table", () => {
        // 객체 키목록 결과 정렬 결과의 20개 항목 목록 기준 구조 일치 확인
        expect(Object.keys(schema).sort()).toEqual([
            "analyses",
            "analysisAutomaticReviews",
            "analysisPerceptionRuns",
            "anonymousSessions",
            "clubs",
            "competitionRuleVersions",
            "decisionResults",
            "evidenceAssets",
            "factRevisionShots",
            "factRevisions",
            "idempotencyRecords",
            "incidentCandidates",
            "matches",
            "officialVerdicts",
            "processingJobEvents",
            "processingJobs",
            "rules",
            "shots",
            "uploadIntents",
            "videoAssets",
        ]);
    });

    it("keeps fact-shot evidence and idempotency as relational tables", () => {
        // 스키마 사실 개정번호 샷목록의 정의된 값 확인
        expect(schema.factRevisionShots).toBeDefined();
        // 스키마 멱등성의 정의된 값 확인
        expect(schema.idempotencyRecords).toBeDefined();
        // 스키마 분석목록의 정의된 값 확인
        expect(schema.analyses).toBeDefined();
        // 스키마 작업목록의 정의된 값 확인
        expect(schema.processingJobs).toBeDefined();
        // 스키마 분석 인식의 정의된 값 확인
        expect(schema.analysisPerceptionRuns).toBeDefined();
    });
});
