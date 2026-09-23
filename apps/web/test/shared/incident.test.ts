import { describe, expect, it } from "vitest";
import { incidentRecordData } from "../../src/shared/incident-schema";
import { incidentAssertion, incidentFixture } from "../fixtures/incident";
import { INCIDENT_OBSERVATION_KEYS } from "../../src/shared/incident";

describe("incident-record-v1 structural contract", () => {
    it("names referee-response context after observed actions, not established offences", () => {
        // 조회결과 시험용 사건 시험자료 결과 준비
        const r = incidentFixture();
        // 조회결과 동작목록 중 선택 항목 맥락의 동작 항목 존재 확인
        expect(r.actions[0]!.context).toHaveProperty("stoppedForThisAction");
        // 조회결과 동작목록 중 선택 항목 맥락의 동작 재개 항목 존재 확인
        expect(r.actions[0]!.context).toHaveProperty("otherActionInRestartSequence");
        // 조회결과 동작목록 중 선택 항목 맥락의 반칙 항목 없음 확인
        expect(r.actions[0]!.context).not.toHaveProperty("stoppedForThisOffence");
        // 조회결과 동작목록 중 선택 항목 맥락의 반칙 재개 항목 없음 확인
        expect(r.actions[0]!.context).not.toHaveProperty("competingOffenceAffectsRestart");
    });
    it("accepts producer claims without promoting model confidence to rule facts", () => {
        // 사건 기록 자료 결과의 기대값 참 일치 확인
        expect(incidentRecordData(incidentFixture())).toBe(true);
    });
    it.each([
        [
            "unknown root key",
            (r: any) => {
                // 조회결과 강도를 부주의 값으로 설정
                r.severity = "CARELESS";
            }
        ],
        [
            "normative raw observation",
            (r: any) => {
                // 조회결과 동작목록 중 선택 항목 관측목록을 조회결과 동작목록 중 선택 항목 관측목록 동작 관측결과 값으로 설정
                r.actions[0].observations.careless = r.actions[0].observations.actionObserved;
            }
        ],
        [
            "missing proof",
            (r: any) => {
                // 조회결과 동작목록 중 선택 항목 관측목록 동작 관측결과 근거 식별자목록을 0개 항목 목록 값으로 설정
                r.actions[0].observations.actionObserved.evidenceIds = [];
            }
        ],
        [
            "missing uncertainty reason",
            (r: any) => {
                // 조회결과 동작목록 중 선택 항목 관측목록 사유목록을 0개 항목 목록 값으로 설정
                r.actions[0].observations.pulling.reasons = [];
            }
        ],
        [
            "dangling evidence",
            (r: any) => {
                // 조회결과 동작목록 중 선택 항목 관측목록 동작 관측결과 근거 식별자목록을 1개 항목 목록 값으로 설정
                r.actions[0].observations.actionObserved.evidenceIds = ["missing"];
            }
        ],
        [
            "duplicate assertion id",
            (r: any) => {
                // 조회결과 동작목록 중 선택 항목 관측목록 동작 관측결과 식별자를 조회결과 행위자목록 중 선택 항목 식별자 값으로 설정
                r.actions[0].observations.actionObserved.id = r.actors[0].teamAssignment.id;
            }
        ],
        [
            "outside segment",
            (r: any) => {
                // 조회결과 동작목록 중 선택 항목 종료시각을 1001 값으로 설정
                r.actions[0].endMs = 1001;
            }
        ],
        [
            "same target actor",
            (r: any) => {
                // 조회결과 동작목록 중 선택 항목 대상 식별자를 1 값으로 설정
                r.actions[0].targetActorId = "actor-1";
            }
        ],
        [
            "missing target",
            (r: any) => {
                // 조회결과 동작목록 중 선택 항목 대상 식별자를 빈 값 값으로 설정
                r.actions[0].targetActorId = null;
            }
        ],
        [
            "unverified edition inferred",
            (r: any) => {
                // 조회결과 경기 버전 식별자를 빈 값 값으로 설정
                r.match.ifabVersionId = null;
            }
        ],
        [
            "empty clip",
            (r: any) => {
                // 조회결과 근거 중 선택 항목 종료시각을 0 값으로 설정
                r.evidence[0].endMs = 0;
            }
        ],
        [
            "unknown track segment",
            (r: any) => {
                // 조회결과 행위자목록 중 선택 항목 중 선택 항목 식별자를 누락 값으로 설정
                r.actors[0].tracklets[0].segmentId = "missing";
            }
        ],
        [
            "team confirmed without value",
            (r: any) => {
                // 조회결과 행위자목록 중 선택 항목 식별자를 빈 값 값으로 설정
                r.actors[0].teamId = null;
            }
        ],
        [
            "unbounded text",
            (r: any) => {
                // 조회결과 사건 식별자를 지정 문자열 반복문자열 결과 값으로 설정
                r.incidentId = "x".repeat(257);
            }
        ]
    ])("rejects %s", (_name, mutate) => {
        // 조회결과 시험용 사건 시험자료 결과 준비
        const r = incidentFixture();
        // 거부할 자료 형태로 시험 입력 변경
        mutate(r);
        // 사건 기록 자료 결과의 기대값 거짓 일치 확인
        expect(incidentRecordData(r)).toBe(false);
    });
    it("accepts a frame with zero duration", () => {
        // 조회결과 시험용 사건 시험자료 결과 준비
        const r: any = incidentFixture();
        // 조회결과 근거 중 선택 항목 종류를 지정 문자열 값으로 설정
        r.evidence[0].kind = "FRAME";
        // 조회결과 근거 중 선택 항목 종료시각을 0 값으로 설정
        r.evidence[0].endMs = 0;
        // 사건 기록 자료 결과의 기대값 참 일치 확인
        expect(incidentRecordData(r)).toBe(true);
    });
    it("rejects cyclic input safely", () => {
        // 조회결과 시험용 사건 시험자료 결과 준비
        const r: any = incidentFixture();
        // 조회결과 경기를 조회결과 값으로 설정
        r.match = r;
        // 사건 기록 자료 결과의 기대값 거짓 일치 확인
        expect(incidentRecordData(r)).toBe(false);
    });
    it.each(["evidenceIds", "reasons"])("rejects sparse assertion %s", (field) => {
        // 조회결과 시험용 사건 시험자료 결과 준비
        const r: any = incidentFixture();
        // 조회결과 동작목록 중 선택 항목 관측목록 중 선택 항목을 배열 값으로 설정
        r.actions[0].observations.pulling[field] = new Array(1);
        // 사건 기록 자료 결과의 기대값 거짓 일치 확인
        expect(incidentRecordData(r)).toBe(false);
    });
    it("rejects extra array properties", () => {
        // 조회결과 시험용 사건 시험자료 결과 준비
        const r: any = incidentFixture();
        // 조회결과 링크목록 판단을 파울 값으로 설정
        r.links.verdict = "FOUL";
        // 사건 기록 자료 결과의 기대값 거짓 일치 확인
        expect(incidentRecordData(r)).toBe(false);
    });
    it("accepts all five action families together without argmax or inferred links", () => {
        // 조회결과 시험용 사건 시험자료 결과 준비
        const r: any = incidentFixture();
        // 기본자료 시험용 조회결과 동작목록 중 선택 항목 준비
        const base = r.actions[0];
        // 조회결과 동작목록을 객체 항목목록 결과 항목변환 결과 값으로 설정
        r.actions = Object.entries(INCIDENT_OBSERVATION_KEYS).map(([type, fields], i) => ({
            ...base,
            id: `action-${i + 2}`,
            type,
            targetActorId: type === "HAND_ARM_BALL_CONTACT" ? null : "actor-2",
            context: Object.fromEntries(
                Object.keys(base.context).map((k) => [k, incidentAssertion(`a${i}.context.${k}`)])
            ),
            observations: Object.fromEntries(
                fields.map((k) => [k, incidentAssertion(`a${i}.observations.${k}`, "UNKNOWN")])
            )
        }));
        // 사건 기록 자료 결과의 기대값 참 일치 확인
        expect(incidentRecordData(r)).toBe(true);
        // 조회결과 링크목록의 0개 항목 목록 기준 구조 일치 확인
        expect(r.links).toEqual([]);
    });
    it("validates image measurement units, finiteness, proof and unknown values", () => {
        // 조회결과 시험용 사건 시험자료 결과 준비
        const r: any = incidentFixture();
        // 시험자료 시험 입력으로 기존 항목 및 상태 지정 문자열 및 지정 항목 지정 문자열 및 값 10 자료 생성
        const measurement = {
            ...incidentAssertion("m1"),
            state: "KNOWN",
            quantity: "IMAGE_SPEED",
            value: 10,
            unit: "px_per_s"
        };
        // 조회결과 동작목록 중 선택 항목을 1개 항목 목록 값으로 설정
        r.actions[0].measurements = [measurement];
        // 사건 기록 자료 결과의 기대값 참 일치 확인
        expect(incidentRecordData(r)).toBe(true);
        // 7개 항목 목록의 각 사례 순회
        for (const invalid of [
            { unit: "m/s" },
            { unit: "N" },
            { value: Infinity },
            { evidenceIds: [] },
            { state: "UNKNOWN" },
            { id: "e1" },
            { severity: "RECKLESS" }
        ]) {
            // 조회결과 동작목록 중 선택 항목을 1개 항목 목록 값으로 설정
            r.actions[0].measurements = [{ ...measurement, ...invalid }];
            // 사건 기록 자료 결과의 기대값 거짓 일치 확인
            expect(incidentRecordData(r)).toBe(false);
        }
        // 조회결과 동작목록 중 선택 항목을 1개 항목 목록 값으로 설정
        r.actions[0].measurements = [
            {
                ...measurement,
                state: "UNKNOWN",
                value: null,
                evidenceIds: [],
                reasons: ["occluded"]
            }
        ];
        // 사건 기록 자료 결과의 기대값 참 일치 확인
        expect(incidentRecordData(r)).toBe(true);
    });
    it("keeps referee null unknown distinct from confirmed NONE", () => {
        // 조회결과 시험용 사건 시험자료 결과 준비
        const r: any = incidentFixture();
        // 조회결과를 1개 항목 목록 값으로 설정
        r.refereeDecisions = [
            {
                id: "decision-1",
                phase: "INITIAL",
                segmentId: "s1",
                startMs: 0,
                endMs: 1000,
                restartType: null,
                restartBeneficiaryTeamId: null,
                card: "NONE",
                goalDecision: null,
                observations: {
                    restart: incidentAssertion("ref.restart", "UNKNOWN"),
                    beneficiary: incidentAssertion("ref.beneficiary", "UNKNOWN"),
                    card: incidentAssertion("ref.card"),
                    goal: incidentAssertion("ref.goal", "UNKNOWN")
                }
            }
        ];
        // 사건 기록 자료 결과의 기대값 참 일치 확인
        expect(incidentRecordData(r)).toBe(true);
        // 조회결과 중 선택 항목 카드를 빈 값 값으로 설정
        r.refereeDecisions[0].card = null;
        // 사건 기록 자료 결과의 기대값 거짓 일치 확인
        expect(incidentRecordData(r)).toBe(false);
    });
    it("only accepts explicit links between existing different segments", () => {
        // 조회결과 시험용 사건 시험자료 결과 준비
        const r: any = incidentFixture();
        // 조회결과 추가 결과 처리 수행
        r.segments.push({
            ...r.segments[0],
            id: "s2",
            replayState: "REPLAY",
            playbackSpeed: "SLOW"
        });
        // 조회결과 링크목록을 1개 항목 목록 값으로 설정
        r.links = [
            {
                id: "link-1",
                firstSegmentId: "s1",
                secondSegmentId: "s2",
                relation: "SAME_INCIDENT",
                assessment: incidentAssertion("link-1.assessment", "UNKNOWN")
            }
        ];
        // 사건 기록 자료 결과의 기대값 참 일치 확인
        expect(incidentRecordData(r)).toBe(true);
        // 2개 항목 목록의 각 사례 순회
        for (const second of ["s1", "missing"]) {
            // 조회결과 링크목록 중 선택 항목 두번째결과 식별자를 두번째결과 값으로 설정
            r.links[0].secondSegmentId = second;
            // 사건 기록 자료 결과의 기대값 거짓 일치 확인
            expect(incidentRecordData(r)).toBe(false);
        }
    });
    it.each(["within actor", "across actors"])(
        "rejects duplicate tracklet ownership %s",
        (location) => {
            // 조회결과 시험용 사건 시험자료 결과 준비
            const r: any = incidentFixture();
            // 시험자료 비교 조건에 따른 처리 경로 분기
            if (location === "within actor")
                // 조회결과 행위자목록 중 선택 항목 추가 결과 처리 수행
                r.actors[0].tracklets.push({ ...r.actors[0].tracklets[0] });
            else r.actors[1].tracklets = [{ ...r.actors[0].tracklets[0] }];
            // 사건 기록 자료 결과의 기대값 거짓 일치 확인
            expect(incidentRecordData(r)).toBe(false);
        }
    );
    it.each(["UNKNOWN", "NOT_APPLICABLE", "REFUTED"])(
        "requires null team identity when assignment is %s",
        (state) => {
            // 조회결과 시험용 사건 시험자료 결과 준비
            const r: any = incidentFixture();
            // 조회결과 행위자목록 중 선택 항목을 사건단정 결과 값으로 설정
            r.actors[0].teamAssignment = incidentAssertion("actor-1.team", state as any);
            // 사건 기록 자료 결과의 기대값 거짓 일치 확인
            expect(incidentRecordData(r)).toBe(false);
            // 조회결과 행위자목록 중 선택 항목 식별자를 빈 값 값으로 설정
            r.actors[0].teamId = null;
            // 사건 기록 자료 결과의 기대값 참 일치 확인
            expect(incidentRecordData(r)).toBe(true);
        }
    );
    it.each(["UNKNOWN", "NOT_APPLICABLE", "REFUTED"])(
        "requires null referee values when observations are %s",
        (state) => {
            // 4개 항목 목록의 각 사례 순회
            for (const [claim, field, affirmed] of [
                ["restart", "restartType", "DIRECT_FREE_KICK"],
                ["beneficiary", "restartBeneficiaryTeamId", "team-1"],
                ["card", "card", "NONE"],
                ["goal", "goalDecision", "NO_GOAL"]
            ]) {
                // 조회결과 시험용 사건 시험자료 결과 준비
                const r: any = incidentFixture();
                // 시험자료 시험 입력으로 식별자 판정 1 및 지정 항목 지정 문자열 및 식별자 지정 문자열 및 시작시각 0 자료 생성
                const d: any = {
                    id: "decision-1",
                    phase: "INITIAL",
                    segmentId: "s1",
                    startMs: 0,
                    endMs: 1000,
                    restartType: null,
                    restartBeneficiaryTeamId: null,
                    card: null,
                    goalDecision: null,
                    observations: Object.fromEntries(
                        ["restart", "beneficiary", "card", "goal"].map((k) => [
                            k,
                            incidentAssertion(`ref.${k}`, "UNKNOWN")
                        ])
                    )
                };
                // 시험자료 관측목록 중 선택 항목을 사건단정 결과 값으로 설정
                d.observations[claim!] = incidentAssertion(`ref.${claim}`, state as any);
                // 시험자료 중 선택 항목을 시험자료로 설정
                d[field!] = affirmed;
                // 조회결과를 1개 항목 목록 값으로 설정
                r.refereeDecisions = [d];
                // 사건 기록 자료 결과의 기대값 거짓 일치 확인
                expect(incidentRecordData(r)).toBe(false);
                // 시험자료 중 선택 항목을 빈 값 값으로 설정
                d[field!] = null;
                // 사건 기록 자료 결과의 기대값 참 일치 확인
                expect(incidentRecordData(r)).toBe(true);
            }
        }
    );
    it("bounds UTF-8 payload bytes, not only JavaScript string length", () => {
        // 조회결과 시험용 사건 시험자료 결과 준비
        const r: any = incidentFixture();
        // 조회결과 동작목록 중 선택 항목 관측목록 사유목록을 배열 변환 결과 값으로 설정
        r.actions[0].observations.pulling.reasons = Array.from({ length: 32 }, () =>
            "한".repeat(1024)
        );
        // 조회결과 동작목록 중 선택 항목 관측목록 사유목록을 배열 변환 결과 값으로 설정
        r.actions[0].observations.gripMaintained.reasons = Array.from({ length: 32 }, () =>
            "한".repeat(1024)
        );
        // 기본자료 시험용 조회결과 동작목록 중 선택 항목 준비
        const base = r.actions[0];
        // 조회결과 동작목록을 배열 변환 결과 값으로 설정
        r.actions = Array.from({ length: 6 }, (_, i) => ({
            ...base,
            id: `multibyte-${i}`,
            context: Object.fromEntries(
                Object.entries(base.context).map(([k, v]: [string, any]) => [
                    k,
                    { ...v, id: `multi-${i}.context.${k}` }
                ])
            ),
            observations: Object.fromEntries(
                Object.entries(base.observations).map(([k, v]: [string, any]) => [
                    k,
                    { ...v, id: `multi-${i}.observations.${k}` }
                ])
            )
        }));
        // 응답본문 직렬화 결과 길이의 1_000_000 미만 확인
        expect(JSON.stringify(r).length).toBeLessThan(1_000_000);
        // 문구 결과 길이의 1_000_000 초과 확인
        expect(new TextEncoder().encode(JSON.stringify(r)).byteLength).toBeGreaterThan(1_000_000);
        // 사건 기록 자료 결과의 기대값 거짓 일치 확인
        expect(incidentRecordData(r)).toBe(false);
    });
    it.each([
        "yesterday",
        "2026-02-29",
        "2026-04-31",
        "2026-13-01",
        "2026-00-01",
        "2026-01-00",
        "26-01-01"
    ])("rejects invalid match date %s", (date) => {
        // 조회결과 시험용 사건 시험자료 결과 준비
        const r: any = incidentFixture();
        // 조회결과 경기 경기 날짜를 시험자료로 설정
        r.match.matchDate = date;
        // 사건 기록 자료 결과의 기대값 거짓 일치 확인
        expect(incidentRecordData(r)).toBe(false);
        // 조회결과 경기 검증을 지정 문자열 값으로 설정
        r.match.verification = "UNVERIFIED";
        // 사건 기록 자료 결과의 기대값 거짓 일치 확인
        expect(incidentRecordData(r)).toBe(false);
    });
    it("allows an actual leap day or an absent unverified date", () => {
        // 조회결과 시험용 사건 시험자료 결과 준비
        const r: any = incidentFixture();
        // 조회결과 경기 경기 날짜를 2024 02 29 값으로 설정
        r.match.matchDate = "2024-02-29";
        // 사건 기록 자료 결과의 기대값 참 일치 확인
        expect(incidentRecordData(r)).toBe(true);
        // 조회결과 경기 경기 날짜를 빈 값 값으로 설정
        r.match.matchDate = null;
        // 조회결과 경기 검증을 지정 문자열 값으로 설정
        r.match.verification = "UNVERIFIED";
        // 사건 기록 자료 결과의 기대값 참 일치 확인
        expect(incidentRecordData(r)).toBe(true);
    });
    it.each([
        ["restart", "restartType"],
        ["goal", "goalDecision"]
    ])("rejects confirmed legacy UNKNOWN %s sentinel", (claim, field) => {
        // 조회결과 시험용 사건 시험자료 결과 준비
        const r: any = incidentFixture();
        // 시험자료 시험 입력으로 식별자 판정 1 및 지정 항목 지정 문자열 및 식별자 지정 문자열 및 시작시각 0 자료 생성
        const d: any = {
            id: "decision-1",
            phase: "FINAL",
            segmentId: "s1",
            startMs: 0,
            endMs: 1000,
            restartType: null,
            restartBeneficiaryTeamId: null,
            card: null,
            goalDecision: null,
            observations: Object.fromEntries(
                ["restart", "beneficiary", "card", "goal"].map((k) => [
                    k,
                    incidentAssertion(`ref.${k}`, "UNKNOWN")
                ])
            )
        };
        // 시험자료 관측목록 중 선택 항목을 사건단정 결과 값으로 설정
        d.observations[claim] = incidentAssertion(`ref.${claim}`);
        // 시험자료 중 선택 항목을 지정 문자열 값으로 설정
        d[field] = "UNKNOWN";
        // 조회결과를 1개 항목 목록 값으로 설정
        r.refereeDecisions = [d];
        // 사건 기록 자료 결과의 기대값 거짓 일치 확인
        expect(incidentRecordData(r)).toBe(false);
    });
});
