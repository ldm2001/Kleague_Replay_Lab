import { describe, expect, it } from "vitest";
import { ruleSet } from "@replay/rule-data";
import { incidentFixture, incidentAssertion } from "../fixtures/incident";
import { holdingVerdict, incidentPublic } from "../../src/rules/engine/incidents/holding";
import { incidentDigest, incidentClaim } from "../../src/rules/engine/incidents/evidence";
import type { IncidentRecordV1, IncidentAssertion } from "../../src/shared/incident";

// 검증용 입력 모형 구성
const fixture = () => {
    // 기록 시험용 사건 시험자료 결과 준비
    const record = incidentFixture();
    // 기록 경기 버전 식별자를 2025 26 값으로 설정
    record.match.ifabVersionId = "ifab-2025-26";
    // 기록 반환
    return record;
};

// 검증용 잡기 구성
const holding = (record: IncidentRecordV1) => {
    // 동작 시험용 기록 동작목록 중 선택 항목 준비
    const action = record.actions[0]!;
    // 동작 유형 비교 조건에 따른 처리 경로 분기
    if (action.type !== "HOLDING_MOTION") throw new Error("fixture-type");
    // 동작 반환
    return action;
};

// 검증용 승인 구성
const admit = (record: IncidentRecordV1) => ({
    incidentId: record.incidentId,
    sourceSha256: record.sourceSha256,
    recordSha256: incidentDigest(record),
    factIds: new Set([
        ...record.actors.map((actor) => actor.teamAssignment.id),
        ...record.actions.flatMap((action) =>
            [...Object.values(action.context), ...Object.values(action.observations)].map(
                (fact) => fact.id
            )
        ),
        ...record.links.map((link) => link.assessment.id)
    ]),
    evidenceHashes: new Map(
        record.evidence.map((evidence) => [evidence.id, evidence.contentSha256])
    )
});

// 검증용 평가 구성
const evaluate = (record = fixture()) =>
    holdingVerdict(record, "action-1", {
        rules: ruleSet("ifab-2025-26")!,
        admission: admit(record)
    });

// 검증용 변경 구성
const change = (fact: IncidentAssertion, state: IncidentAssertion["state"]) => {
    // 사실 상태를 상태 값으로 설정
    fact.state = state;
    // 사실 사유목록을 입력 조건 값으로 설정
    fact.reasons = state === "UNKNOWN" || state === "NOT_APPLICABLE" ? ["MISSING_VIEW"] : [];
};

describe("holding question-specific conclusions", () => {
    it.each(["ifab-2025-26", "ifab-2026-27"])(
        "evaluates only with the explicitly selected %s references",
        (version) => {
            // 사건 입력 준비
            const record = fixture();
            // 기록 경기 버전 식별자를 버전 값으로 설정
            record.match.ifabVersionId = version;
            // 결과 시험용 잡기 판단 결과 준비
            const result = holdingVerdict(record, "action-1", {
                rules: ruleSet(version)!,
                admission: admit(record)
            });
            // 결과 결론목록 반칙 상태의 기대값 완료 일치 확인
            expect(result.conclusions.offence.status).toBe("COMPLETED");
            // 결과 결론목록 재개 상태의 기대값 완료 일치 확인
            expect(result.conclusions.restart.status).toBe("COMPLETED");
            // 결과 결론목록 반칙 인용목록 전체충족 결과의 기대값 참 일치 확인
            expect(
                result.conclusions.offence.citations.every(
                    (citation) => `ifab-${citation.edition}` === version
                )
            ).toBe(true);
        }
    );
    it("completes holding and DFK while leaving disciplinary and referee/VAR questions unevaluated", () => {
        // 결과 시험용 평가 결과 준비
        const result = evaluate();
        // 결과 결론목록 반칙의 상태 완료 및 값 잡기 반칙 자료의 필드 일치 확인
        expect(result.conclusions.offence).toMatchObject({
            status: "COMPLETED",
            value: "HOLDING_OFFENCE"
        });
        // 결과 결론목록 재개의 상태 완료 및 값 자료의 필드 일치 확인
        expect(result.conclusions.restart).toMatchObject({
            status: "COMPLETED",
            value: { type: "DIRECT_FREE_KICK", beneficiaryTeamId: "team-2" }
        });
        // 지원하지 않음 내용을 포함한 기대 결과 일치 확인
        expect(result.conclusions.disciplinary).toMatchObject({
            status: "UNSUPPORTED",
            value: null
        });
        // 결과가 적용 대상 아님 상태로 유지됨 확인
        expect(result.conclusions.risk.status).toBe("NOT_APPLICABLE");
        // 결과의 지원하지 않음 상태 일치 확인
        expect(result.conclusions.originalDecisionComparison.status).toBe("UNSUPPORTED");
        // 결과의 지원하지 않음 상태 일치 확인
        expect(result.conclusions.varIntervention.status).toBe("UNSUPPORTED");
    });

    it("does not require duration, pulling or a CARELESS label to establish holding", () => {
        // 사건 입력 준비
        const record = fixture();
        // 결과가 알 수 없음 상태로 유지됨 확인
        expect(holding(record).observations.gripMaintained.state).toBe("UNKNOWN");
        // 결과가 알 수 없음 상태로 유지됨 확인
        expect(holding(record).observations.pulling.state).toBe("UNKNOWN");
        // 평가 결과 결론목록 반칙 상태의 기대값 완료 일치 확인
        expect(evaluate(record).conclusions.offence.status).toBe("COMPLETED");
    });

    it("unknown location blocks restart, not holding establishment", () => {
        // 사건 입력 준비
        const record = fixture();
        // 변경 결과 처리 수행
        change(holding(record).context.insideOwnPenaltyArea, "UNKNOWN");
        // 미확정 조건을 포함한 기대 결과 일치 확인
        expect(evaluate(record).conclusions).toMatchObject({
            offence: { status: "COMPLETED" },
            restart: { status: "UNDETERMINED", value: null }
        });
    });

    it.each(["UNKNOWN", "NOT_APPLICABLE"] as const)(
        "movement %s does not become a negative or a foul",
        (state) => {
            // 사건 입력 준비
            const record = fixture();
            // 변경 결과 처리 수행
            change(holding(record).observations.movementImpeded, state);
            // 미확정 조건을 포함한 기대 결과 일치 확인
            expect(evaluate(record).conclusions.offence).toMatchObject({
                status: "UNDETERMINED",
                value: null
            });
        }
    );

    it.each(["bodyOrEquipmentContact", "movementImpeded"] as const)(
        "confirmed negative %s rules out this holding question only",
        (key) => {
            // 사건 입력 준비
            const record = fixture();
            // 변경 결과 처리 수행
            change(holding(record).observations[key], "REFUTED");
            // 비접촉 확인과 접촉에 의한 이동 방해 확인의 동시 성립 불가
            if (key === "bodyOrEquipmentContact")
                // 변경 결과 처리 수행
                change(holding(record).observations.movementImpeded, "UNKNOWN");
            // 결과 시험용 평가 결과 준비
            const result = evaluate(record);
            // 잡기 반칙 아님 조건을 포함한 기대 결과 일치 확인
            expect(result.conclusions.offence).toMatchObject({
                status: "COMPLETED",
                value: "NO_HOLDING_OFFENCE"
            });
            // 결과가 적용 대상 아님 상태로 유지됨 확인
            expect(result.conclusions.restart.status).toBe("NOT_APPLICABLE");
            // 결과 결론목록 징계 값의 빈 값 확인
            expect(result.conclusions.disciplinary.value).toBeNull();
        }
    );

    it.each(["gripMaintained", "pulling", "movementImpeded"] as const)(
        "holds conflicting admitted contact and %s observations",
        (key) => {
            // 기록 및 동작 시험용 시험자료 결과 준비
            const record = fixture(),
                action = holding(record);
            // 변경 결과 처리 수행
            change(action.observations.bodyOrEquipmentContact, "REFUTED");
            // 변경 결과 처리 수행
            change(action.observations.movementImpeded, "UNKNOWN");
            // 변경 결과 처리 수행
            change(action.observations[key], "CONFIRMED");
            // 결과 시험용 평가 결과 준비
            const result = evaluate(record);
            // 미확정 조건을 포함한 기대 결과 일치 확인
            expect(result.conclusions.offence).toMatchObject({
                status: "UNDETERMINED",
                reasonCodes: ["OBSERVATION_CONFLICT"]
            });
            // 결과가 미확정 상태로 유지됨 확인
            expect(result.conclusions.restart.status).toBe("UNDETERMINED");
            // 결과 사실 진단의 시험자료 부분배열 결과 기준 구조 일치 확인
            expect(result.factDiagnostics).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        factId: action.observations[key].id,
                        reasons: ["OBSERVATION_CONFLICT"]
                    }),
                    expect.objectContaining({
                        factId: action.observations.bodyOrEquipmentContact.id,
                        reasons: ["OBSERVATION_CONFLICT"]
                    })
                ])
            );
            // 사건 공개 결과 결론목록의 0개 항목 목록 기준 구조 일치 확인
            expect(incidentPublic(result).conclusions).toEqual([]);
        }
    );

    it.each(["UNKNOWN", "UNADMITTED", "BAD_HASH", "SHORT_CLIP"])(
        "does not treat %s grip as an admitted conflict",
        (mode) => {
            // 기록 및 동작 시험용 시험자료 결과 준비
            const record = fixture(),
                action = holding(record);
            // 변경 결과 처리 수행
            change(action.observations.bodyOrEquipmentContact, "REFUTED");
            // 변경 결과 처리 수행
            change(action.observations.movementImpeded, "UNKNOWN");
            // 모드 비교 조건에 따른 처리 경로 분기
            if (mode !== "UNKNOWN") change(action.observations.gripMaintained, "CONFIRMED");
            // 기록 근거를 2개 항목 목록 값으로 설정
            record.evidence = [
                ...record.evidence,
                {
                    ...record.evidence[0]!,
                    id: "grip-proof",
                    endMs: mode === "SHORT_CLIP" ? 100 : 1000
                }
            ];
            // 동작 관측목록 근거 식별자목록을 1개 항목 목록 값으로 설정
            action.observations.gripMaintained.evidenceIds = ["grip-proof"];
            // 수용결과 시험용 시험자료 결과 준비
            const admission = admit(record);
            // 모드 비교 조건에 따른 처리 경로 분기
            if (mode === "UNADMITTED")
                // 수용결과 사실 식별자목록 결과 처리 수행
                admission.factIds.delete(action.observations.gripMaintained.id);
            // 모드 비교 조건에 따른 처리 경로 분기
            if (mode === "BAD_HASH") admission.evidenceHashes.delete("grip-proof");
            // 결과 시험용 잡기 판단 결과 준비
            const result = holdingVerdict(record, action.id, {
                rules: ruleSet("ifab-2025-26")!,
                admission
            });
            // 잡기 반칙 아님 조건을 포함한 기대 결과 일치 확인
            expect(result.conclusions.offence).toMatchObject({
                status: "COMPLETED",
                value: "NO_HOLDING_OFFENCE"
            });
        }
    );

    it.each(["HASH", "ADMISSION", "TIME", "LINK"])(
        "preserves private fact-level %s blocking reasons",
        (mode) => {
            // 기록 및 동작 및 사실 시험용 시험자료 결과 준비
            const record = fixture(),
                action = holding(record),
                fact = action.context.ballInPlay;
            // 기록 근거를 2개 항목 목록 값으로 설정
            record.evidence = [
                ...record.evidence,
                { ...record.evidence[0]!, id: "context-proof", endMs: mode === "TIME" ? 100 : 1000 }
            ];
            // 사실 근거 식별자목록을 1개 항목 목록 값으로 설정
            fact.evidenceIds = ["context-proof"];
            // 모드 비교 조건에 따른 처리 경로 분기
            if (mode === "LINK") {
                // 기록을 2개 항목 목록 값으로 설정
                record.segments = [...record.segments, { ...record.segments[0]!, id: "s2" }];
                // 기록 근거 중 선택 항목 식별자를 지정 문자열 값으로 설정
                record.evidence[1]!.segmentId = "s2";
            }
            // 수용결과 시험용 시험자료 결과 준비
            const admission = admit(record);
            // 모드 비교 조건에 따른 처리 경로 분기
            if (mode === "HASH") admission.evidenceHashes.delete("context-proof");
            // 모드 비교 조건에 따른 처리 경로 분기
            if (mode === "ADMISSION") admission.factIds.delete(fact.id);
            // 사유 시험용 해시 근거 해시 및 수용결과 사실 및 시간 분석범위 및 지정 항목 화면자료 자료 중 선택 항목 준비
            const reason = {
                HASH: "EVIDENCE_HASH_UNVERIFIED",
                ADMISSION: "FACT_NOT_ADMITTED",
                TIME: "TEMPORAL_COVERAGE_INSUFFICIENT",
                LINK: "VIEW_LINK_UNVERIFIED"
            }[mode]!;
            // 결과 시험용 잡기 판단 결과 준비
            const result = holdingVerdict(record, action.id, {
                rules: ruleSet("ifab-2025-26")!,
                admission
            });
            // 결과가 미확정 상태로 유지됨 확인
            expect(result.conclusions.offence.status).toBe("UNDETERMINED");
            // 알 수 없음 조건을 포함한 기대 결과 일치 확인
            expect(result).toHaveProperty(
                "factDiagnostics",
                expect.arrayContaining([
                    expect.objectContaining({
                        factId: fact.id,
                        state: "UNKNOWN",
                        reasons: [reason]
                    })
                ])
            );
            // 응답본문 직렬화 결과의 사유 미포함 확인
            expect(JSON.stringify(incidentPublic(result))).not.toContain(reason);
            // 사건 공개 결과의 사실 진단 항목 없음 확인
            expect(incidentPublic(result)).not.toHaveProperty("factDiagnostics");
        }
    );

    it.each(["movementImpeded", "insideOwnPenaltyArea"] as const)(
        "retains %s diagnostics beyond context checks",
        (key) => {
            // 기록 및 동작 시험용 시험자료 결과 준비
            const record = fixture(),
                action = holding(record);
            // 사실 시험용 입력 조건 준비
            const fact = key === "movementImpeded" ? action.observations[key] : action.context[key];
            // 수용결과 시험용 시험자료 결과 준비
            const admission = admit(record);
            // 수용결과 사실 식별자목록 결과 처리 수행
            admission.factIds.delete(fact.id);
            // 결과 시험용 잡기 판단 결과 준비
            const result = holdingVerdict(record, action.id, {
                rules: ruleSet("ifab-2025-26")!,
                admission
            });
            // 알 수 없음 및 규정 사실로 채택되지 않음 조건을 포함한 기대 결과 일치 확인
            expect(result.factDiagnostics).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        factId: fact.id,
                        state: "UNKNOWN",
                        reasons: ["FACT_NOT_ADMITTED"]
                    })
                ])
            );
            // 결과가 미확정 상태로 유지됨 확인
            expect(result.conclusions.offence.status).toBe(
                key === "movementImpeded" ? "UNDETERMINED" : "COMPLETED"
            );
            // 결과가 미확정 상태로 유지됨 확인
            expect(result.conclusions.restart.status).toBe("UNDETERMINED");
            // 사건 공개 결과의 사실 진단 항목 없음 확인
            expect(incidentPublic(result)).not.toHaveProperty("factDiagnostics");
        }
    );

    it.each([
        "ballInPlay",
        "stoppedForThisAction",
        "advantageApplied",
        "otherActionInRestartSequence"
    ] as const)("unknown %s prevents a restart conclusion", (key) => {
        // 사건 입력 준비
        const record = fixture();
        // 변경 결과 처리 수행
        change(holding(record).context[key], "UNKNOWN");
        // 결과가 미확정 상태로 유지됨 확인
        expect(evaluate(record).conclusions.restart.status).toBe("UNDETERMINED");
    });

    it("confirmed advantage is not automatically converted into an awarded free kick", () => {
        // 사건 입력 준비
        const record = fixture();
        // 변경 결과 처리 수행
        change(holding(record).context.advantageApplied, "CONFIRMED");
        // 평가 결과 결론목록 반칙 상태의 기대값 완료 일치 확인
        expect(evaluate(record).conclusions.offence.status).toBe("COMPLETED");
        // 평가 결과 결론목록 재개 상태의 기대값 완료 불일치 확인
        expect(evaluate(record).conclusions.restart.status).not.toBe("COMPLETED");
    });

    it("out-of-play holding is outside this evaluator's in-play offence scope, not no foul", () => {
        // 사건 입력 준비
        const record = fixture();
        // 변경 결과 처리 수행
        change(holding(record).context.ballInPlay, "REFUTED");
        // 지원하지 않음 내용을 포함한 기대 결과 일치 확인
        expect(evaluate(record).conclusions.offence).toMatchObject({
            status: "UNSUPPORTED",
            value: null
        });
    });

    it("out-of-field location does not erase holding but needs separate restart rules", () => {
        // 사건 입력 준비
        const record = fixture();
        // 변경 결과 처리 수행
        change(holding(record).context.onField, "REFUTED");
        // 지원하지 않음 내용을 포함한 기대 결과 일치 확인
        expect(evaluate(record).conclusions).toMatchObject({
            offence: { status: "COMPLETED" },
            restart: { status: "UNSUPPORTED" }
        });
    });

    it("an offence anywhere inside the offender's area supports a penalty, independent of card data", () => {
        // 사건 입력 준비
        const record = fixture();
        // 변경 결과 처리 수행
        change(holding(record).context.insideOwnPenaltyArea, "CONFIRMED");
        // 평가 결과 결론목록 재개의 상태 완료 및 값 자료의 필드 일치 확인
        expect(evaluate(record).conclusions.restart).toMatchObject({
            status: "COMPLETED",
            value: { type: "PENALTY_KICK", beneficiaryTeamId: "team-2" }
        });
    });

    it("unknown beneficiary preserves holding but blocks restart", () => {
        // 사건 입력 준비
        const record = fixture();
        // 기록 행위자목록 중 선택 항목 식별자를 빈 값 값으로 설정
        record.actors[1]!.teamId = null;
        // 변경 결과 처리 수행
        change(record.actors[1]!.teamAssignment, "UNKNOWN");
        // 미확정 조건을 포함한 기대 결과 일치 확인
        expect(evaluate(record).conclusions).toMatchObject({
            offence: { status: "COMPLETED" },
            restart: { status: "UNDETERMINED" }
        });
    });

    it("does not select restart priority when the same incident contains another action", () => {
        // 사건 입력 준비
        const record = fixture();
        // 두번째결과 시험용 깊은복사 결과 준비
        const second = structuredClone(holding(record));
        // 두번째결과 식별자를 동작 2 값으로 설정
        second.id = "action-2";
        // 2개 항목 목록의 각 사례 순회
        for (const fact of [
            ...Object.values(second.context),
            ...Object.values(second.observations)
        ])
            // 사실 식별자를 사실 식별자 결과 값으로 설정
            fact.id = fact.id.replace("action-1", "action-2");
        // 기록 동작목록을 2개 항목 목록 값으로 설정
        record.actions = [...record.actions, second];
        // 평가 결과 결론목록 반칙 상태의 기대값 완료 일치 확인
        expect(evaluate(record).conclusions.offence.status).toBe("COMPLETED");
        // 결과의 지원하지 않음 상태 일치 확인
        expect(evaluate(record).conclusions.restart.status).toBe("UNSUPPORTED");
    });

    it("does not classify a different observed action as no foul through the holding evaluator", () => {
        // 사건 입력 준비
        const record = fixture();
        // 첫결과 시험용 잡기 결과 준비
        const first = holding(record);
        // 기록 동작목록을 1개 항목 목록 값으로 설정
        record.actions = [
            {
                ...first,
                type: "PUSHING_MOTION",
                observations: {
                    actionObserved: first.observations.actionObserved,
                    bodyContact: first.observations.bodyOrEquipmentContact,
                    extensionTowardOpponent: first.observations.gripMaintained,
                    opponentMotionChanged: first.observations.movementImpeded
                }
            }
        ];
        // 결과의 지원하지 않음 상태 일치 확인
        expect(evaluate(record).conclusions.offence.status).toBe("UNSUPPORTED");
    });

    it("conflicting actual teams do not get resolved by attacking/defending role defaults", () => {
        // 사건 입력 준비
        const record = fixture();
        // 기록 행위자목록 중 선택 항목 식별자를 1 값으로 설정
        record.actors[1]!.teamId = "team-1";
        // 결과가 미확정 상태로 유지됨 확인
        expect(evaluate(record).conclusions.offence.status).toBe("UNDETERMINED");
    });

    it("a high-confidence model claim is not admitted merely by its state", () => {
        // 사건 입력 준비
        const record = fixture();
        // 수용결과 시험용 시험자료 결과 준비
        const admission = admit(record);
        // 수용결과 사실 식별자목록 결과 처리 수행
        admission.factIds.clear();
        // 결과가 미확정 상태로 유지됨 확인
        expect(
            holdingVerdict(record, "action-1", { rules: ruleSet("ifab-2025-26")!, admission })
                .conclusions.offence.status
        ).toBe("UNDETERMINED");
    });

    it("binds admission to the complete observation record and evidence bytes", () => {
        // 사건 입력 준비
        const record = fixture();
        // 수용결과 시험용 시험자료 결과 준비
        const admission = admit(record);
        // 변경 결과 처리 수행
        change(holding(record).observations.movementImpeded, "REFUTED");
        // 결과가 미확정 상태로 유지됨 확인
        expect(
            holdingVerdict(record, "action-1", { rules: ruleSet("ifab-2025-26")!, admission })
                .conclusions.offence.status
        ).toBe("UNDETERMINED");
        // 시험자료 시험용 시험자료 결과 준비
        const current = admit(record);
        // 시험자료 근거 묶음 결과 처리 수행
        current.evidenceHashes.set("e1", "c".repeat(64));
        // 결과가 미확정 상태로 유지됨 확인
        expect(
            holdingVerdict(record, "action-1", {
                rules: ruleSet("ifab-2025-26")!,
                admission: current
            }).conclusions.offence.status
        ).toBe("UNDETERMINED");
    });

    it("does not treat one frame as proof of movement over the episode", () => {
        // 사건 입력 준비
        const record = fixture();
        // 기록 근거 중 선택 항목 종류를 지정 문자열 값으로 설정
        record.evidence[0]!.kind = "FRAME";
        // 기록 근거 중 선택 항목 시작시각을 500 값으로 설정
        record.evidence[0]!.startMs = 500;
        // 기록 근거 중 선택 항목 종료시각을 500 값으로 설정
        record.evidence[0]!.endMs = 500;
        // 결과가 미확정 상태로 유지됨 확인
        expect(evaluate(record).conclusions.offence.status).toBe("UNDETERMINED");
    });

    it("slower footage can establish contact but cannot be substituted for normal-speed risk evidence", () => {
        // 사건 입력 준비
        const record = fixture();
        // 기록 중 선택 항목을 지정 문자열 값으로 설정
        record.segments[0]!.playbackSpeed = "SLOW";
        // 평가 결과 결론목록 반칙 상태의 기대값 완료 일치 확인
        expect(evaluate(record).conclusions.offence.status).toBe("COMPLETED");
        // 결과가 알 수 없음 상태로 유지됨 확인
        expect(
            incidentClaim(
                record,
                holding(record),
                holding(record).observations.bodyOrEquipmentContact,
                admit(record),
                { normalSpeed: true }
            ).state
        ).toBe("UNKNOWN");
    });

    it("will not combine unlinked replay evidence, but admits an independently approved same-incident link", () => {
        // 사건 입력 준비
        const record = fixture();
        // 기록을 2개 항목 목록 값으로 설정
        record.segments = [
            ...record.segments,
            {
                ...record.segments[0]!,
                id: "s2",
                shotId: "shot-2",
                startMs: 2000,
                endMs: 3000,
                replayState: "REPLAY"
            }
        ];
        // 기록 근거를 2개 항목 목록 값으로 설정
        record.evidence = [
            ...record.evidence,
            { ...record.evidence[0]!, id: "e2", segmentId: "s2", startMs: 2000, endMs: 3000 }
        ];
        // 잡기 결과 관측목록 근거 식별자목록을 1개 항목 목록 값으로 설정
        holding(record).observations.movementImpeded.evidenceIds = ["e2"];
        // 결과가 미확정 상태로 유지됨 확인
        expect(evaluate(record).conclusions.offence.status).toBe("UNDETERMINED");
        // 평가 시험용 사건단정 결과 준비
        const assessment = incidentAssertion("same-incident-link");
        // 평가 근거 식별자목록을 2개 항목 목록 값으로 설정
        assessment.evidenceIds = ["e1", "e2"];
        // 기록 링크목록을 1개 항목 목록 값으로 설정
        record.links = [
            {
                id: "link-1",
                firstSegmentId: "s1",
                secondSegmentId: "s2",
                relation: "SAME_INCIDENT",
                assessment
            }
        ];
        // 평가 결과 결론목록 반칙 상태의 기대값 완료 일치 확인
        expect(evaluate(record).conclusions.offence.status).toBe("COMPLETED");
    });

    it("rejects missing or mixed rule editions without erasing evidence", () => {
        // 사건 입력 준비
        const record = fixture();
        // 결과가 미확정 상태로 유지됨 확인
        expect(
            holdingVerdict(record, "action-1", {
                rules: ruleSet("ifab-2026-27")!,
                admission: admit(record)
            }).conclusions.offence.status
        ).toBe("UNDETERMINED");
        // 기록 경기 검증을 지정 문자열 값으로 설정
        record.match.verification = "UNVERIFIED";
        // 결과가 미확정 상태로 유지됨 확인
        expect(evaluate(record).conclusions.offence.status).toBe("UNDETERMINED");
    });

    it("publishes completed questions only, not raw claims or private blocking reasons", () => {
        // 결과 시험용 사건 공개 결과 준비
        const result = incidentPublic(evaluate());
        // 결과 결론목록 항목변환 결과의 2개 항목 목록 기준 구조 일치 확인
        expect(result.conclusions.map((item) => item.question)).toEqual(["offence", "restart"]);
        // 결과 미평가항목의 징계 포함 확인
        expect(result.notAssessed).toContain("disciplinary");
        // 응답본문 직렬화 결과의 지정 문자열 미포함 확인
        expect(JSON.stringify(result)).not.toContain("MODEL_ESTIMATE");
        // 화면 누락 사유가 결과에 포함되지 않음 확인
        expect(JSON.stringify(result)).not.toContain("MISSING_VIEW");
        // 결과의 사실 항목 없음 확인
        expect(result).not.toHaveProperty("facts");
    });
});
