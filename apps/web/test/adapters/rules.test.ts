import { describe, expect, it } from "vitest";
import { EvaluationStore } from "../../src/adapters/evaluation-store";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { observation } from "@replay/shared-types";
import { context } from "../fixtures/push-context";

describe("evaluation context evidence ownership", () => {
    it("rejects a context-only shot from another analysis before saving a revision", async () => {
        // 질의목록 시험용 0개 항목 목록 준비
        const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
        // 샷 시험용 44444444 4444 4444 8444 444444444444 준비
        const shot = "44444444-4444-4444-8444-444444444444";
        // 저장소 시험용 저장소 준비
        const repository = new EvaluationStore({
            db: {
                transaction: async (operation: (tx: unknown) => unknown) =>
                    operation({
                        execute: async (sql: SQL) => {
                            // 질의 시험용 의존성 모의객체 질의 질의 결과 준비
                            const query = new PgDialect().sqlToQuery(sql);
                            // 질의목록 추가 결과 처리 수행
                            queries.push(query);
                            // 질의 질의 포함여부 결과에 따른 처리 경로 분기
                            if (query.sql.includes("select candidate.id"))
                                // 1개 항목 목록 반환
                                return [{ id: "candidate", current_fact_revision_id: null }];
                            // 질의 질의 포함여부 결과에 따른 처리 경로 분기
                            if (query.sql.includes("coalesce(max(revision)"))
                                // 1개 항목 목록 반환
                                return [{ revision: 1 }];
                            // 질의 질의 포함여부 결과에 따른 처리 경로 분기
                            if (query.sql.includes("select count(*)")) return [{ count: 0 }];
                            // 질의 질의 포함여부 결과에 따른 처리 경로 분기
                            if (query.sql.includes("insert into fact_revisions"))
                                // 1개 항목 목록 반환
                                return [{ id: "revision", revision: 1 }];
                            // 0개 항목 목록 반환
                            return [];
                        }
                    })
            }
        } as never);
        // 저장소 수정항목 결과를 결과에 저장
        const result = await repository.patch({
            anonymousSessionId: "session",
            analysisId: "analysis",
            candidateId: "candidate",
            expectedFactRevisionId: null,
            keyHash: new Uint8Array(32),
            requestHash: new Uint8Array(32),
            now: "2026-09-21T00:00:00Z",
            facts: {
                push: {
                    contactDetected: observation(true, "NORMAL", []),
                    severity: observation("CARELESS", "NORMAL", []),
                    opponentDisplacement: observation("none", "NORMAL", []),
                    insidePenaltyArea: observation(false, "NORMAL", []),
                    cameraSufficiency: "HIGH",
                    context: { ...context(), ballInPlay: observation(true, "NORMAL", [shot]) }
                },
                variable: {
                    reviewScenario: "OTHER",
                    restartOccurred: false,
                    sendOffCategory: "NONE",
                    mistakenIdentity: false,
                    decisionNature: "FACTUAL",
                    errorMagnitude: "UNDETERMINED",
                    seriousMissedIncident: false
                },
                observed: {
                    restartType: "UNKNOWN",
                    restartBeneficiary: "UNKNOWN",
                    card: null,
                    goalDecision: "UNKNOWN",
                    source: "USER_INPUT"
                }
            }
        });
        // 대상 없음 조건을 포함한 기대 결과 일치 확인
        expect(result).toEqual({ kind: "NOT_FOUND" });
        // 질의목록 조회 결과 인자목록의 샷 포함 확인
        expect(queries.find((query) => query.sql.includes("select count(*)"))?.params).toContain(
            shot
        );
        // 질의목록 일부충족 결과의 기대값 거짓 일치 확인
        expect(queries.some((query) => query.sql.includes("insert into fact_revisions"))).toBe(
            false
        );
    });
});
