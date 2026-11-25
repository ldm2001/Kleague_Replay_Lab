// 규정 에이전트 판례 입력과 보정 형식 시험
import { describe, expect, it } from "vitest";
import { INCIDENT_CONTEXT_KEYS, agentCaseData, calibrationData } from "@replay/shared-types";

// 맥락 사실과 팀 출처를 갖춘 판례 입력 시험자료 생성
const input = (): any => ({
    schemaVersion: "agent-case-input-v1",
    caseId: "case-1",
    sourceSha256: "a".repeat(64),
    artifactSha256: "b".repeat(64),
    match: {
        matchId: "match-1",
        competition: "competition-1",
        season: "season-1",
        matchDate: "2026-03-01"
    },
    eventId: "event-1",
    actorId: "player-a",
    targetId: "player-b",
    tracks: {
        actor: { segmentId: "segment-1", trackId: "track-1" },
        target: { segmentId: "segment-1", trackId: "track-2" }
    },
    startMs: 0,
    endMs: 1000,
    actionType: "HOLDING_MOTION",
    teams: {
        actor: {
            teamId: "team-a",
            state: "CONFIRMED",
            source: { kind: "MATCH_RECORD", reference: "record-1" }
        },
        target: { teamId: null, state: "UNKNOWN", source: null }
    },
    facts: {
        ...Object.fromEntries(
            INCIDENT_CONTEXT_KEYS.map((k) => [k, { state: "UNKNOWN", source: null }])
        ),
        actorIsPlayer: {
            state: "CONFIRMED",
            source: { kind: "HUMAN_LABEL", reference: "label-1" }
        },
        onField: {
            state: "REFUTED",
            source: { kind: "OFFICIAL_RELEASE", reference: "release-1" }
        }
    }
});

// 자리값 문턱을 담은 미보정 보정 시험자료 생성
const calibration = (): any => ({
    schemaVersion: "agent-calibration-v1",
    method: { id: "brain-agent", version: "1" },
    status: "UNCALIBRATED",
    reportSha256: null,
    facts: {
        actionObserved: {
            skill: "action",
            priority: 1,
            requires: [],
            rule: { nearBelow: 0.15, farAbove: 0.3, minMs: 120, minCoverage: 0.6 }
        },
        bodyOrEquipmentContact: {
            skill: "contact",
            priority: 2,
            requires: ["actionObserved"],
            rule: { confirmBelow: 0.04, confirmMinMs: 100, refuteAbove: 0.12, minCoverage: 0.6 }
        },
        directionObserved: {
            skill: "direction",
            priority: 3,
            requires: ["bodyOrEquipmentContact"],
            rule: { majority: 0.7, minCoverage: 0.6 }
        },
        gripMaintained: {
            skill: "grip",
            priority: 4,
            requires: ["bodyOrEquipmentContact"],
            rule: { confirmMinMs: 400, refuteMaxMs: 150 }
        },
        pulling: {
            skill: "pulling",
            priority: 5,
            requires: ["bodyOrEquipmentContact"],
            rule: { confirmDeltaDeg: 20, refuteDeltaDeg: 5, minMs: 200, minCoverage: 0.6 }
        },
        movementImpeded: {
            skill: "impeded",
            priority: 6,
            requires: ["bodyOrEquipmentContact"],
            rule: { confirmDrop: 0.4, refuteDrop: 0.1, minBaseline: 0.5, minCoverage: 0.6 }
        }
    }
});

// 문자열 규칙 위반 값 목록 정의
const badText = [
    { label: "empty", v: "" },
    { label: "blank", v: "   " },
    { label: "overlong", v: "x".repeat(257) },
    { label: "numeric", v: 1 }
];

// 문자열 규칙을 따르는 판례 입력 필드 경로 목록 정의
const textFields = [
    "caseId",
    "match.matchId",
    "match.competition",
    "match.season",
    "eventId",
    "actorId",
    "targetId",
    "tracks.actor.trackId",
    "tracks.target.trackId",
    "teams.actor.teamId"
];

// 점으로 나눈 경로의 마지막 필드를 가진 객체와 필드 이름 반환
const locate = (r: any, field: string): [any, string] => {
    // 경로 조각 목록 생성
    const parts = field.split(".");
    // 마지막 조각 직전 객체와 마지막 조각 반환
    return [parts.slice(0, -1).reduce((o, k) => o[k], r), parts.at(-1)!];
};

describe("agent-case-input-v1 format", () => {
    it("accepts context facts with sources and an unknown target team", () => {
        // 판례 입력 형식 검사 결과의 기대값 참 일치 확인
        expect(agentCaseData(input())).toBe(true);
    });

    it("accepts identifiers at the 256 character limit", () => {
        // 시험용 판례 입력 준비
        const r = input();
        // 판례 식별자를 256자 문자열로 설정
        r.caseId = "x".repeat(256);
        // 경기 시즌을 256자 문자열로 설정
        r.match.season = "s".repeat(256);
        // 행위자 팀 식별자를 256자 문자열로 설정
        r.teams.actor.teamId = "t".repeat(256);
        // 판례 입력 형식 검사 결과의 기대값 참 일치 확인
        expect(agentCaseData(r)).toBe(true);
    });

    it("accepts a source reference longer than identifiers", () => {
        // 시험용 판례 입력 준비
        const r = input();
        // 맥락 사실 출처 참조를 1000자 문자열로 설정
        r.facts.onField.source.reference = "r".repeat(1000);
        // 판례 입력 형식 검사 결과의 기대값 참 일치 확인
        expect(agentCaseData(r)).toBe(true);
    });

    it.each([
        ["unknown root field", "note", "x"],
        ["split field", "split", "DEVELOPMENT"],
        ["edition field", "ifabVersionId", "edition-1"],
        ["edition in match", "match.ifabVersionId", "edition-1"],
        ["official outcome field", "outcome", { schemaVersion: "agent-case-outcome-v1" }],
        ["next schema version", "schemaVersion", "agent-case-input-v2"],
        ["other action type", "actionType", "PUSHING_MOTION"],
        ["uppercase source hash", "sourceSha256", "A".repeat(64)],
        ["short artifact hash", "artifactSha256", "b".repeat(63)],
        ["non-hex source hash", "sourceSha256", "g".repeat(64)],
        ["empty span", "endMs", 0],
        ["reversed span", "startMs", 2000],
        ["negative start", "startMs", -1],
        ["fractional end", "endMs", 1.5],
        ["string start", "startMs", "0"],
        ["same track", "tracks.target.trackId", "track-1"],
        ["different segments", "tracks.target.segmentId", "segment-2"],
        ["extra track", "tracks.ball", { segmentId: "segment-1", trackId: "track-3" }],
        ["track confidence", "tracks.actor.confidence", 0.9],
        ["actor as target", "targetId", "player-a"],
        ["impossible match date", "match.matchDate", "2026-02-30"],
        ["unpadded match date", "match.matchDate", "2026-3-1"],
        ["match timestamp", "match.matchDate", "2026-03-01T00:00:00Z"],
        ["extra match field", "match.venue", "venue-1"],
        ["observation fact in input", "facts.pulling", { state: "UNKNOWN", source: null }],
        ["not applicable context state", "facts.opponents.state", "NOT_APPLICABLE"],
        ["confirmed fact without source", "facts.actorIsPlayer.source", null],
        ["refuted fact without source", "facts.onField.source", null],
        [
            "unknown fact with source",
            "facts.ballInPlay.source",
            { kind: "HUMAN_LABEL", reference: "label-2" }
        ],
        ["unlisted source kind", "facts.actorIsPlayer.source.kind", "BROADCAST"],
        ["empty source reference", "facts.onField.source.reference", ""],
        ["blank source reference", "facts.onField.source.reference", "   "],
        ["numeric source reference", "facts.onField.source.reference", 3],
        ["extra source field", "facts.onField.source.page", 3],
        ["fact confidence", "facts.targetIsPlayer.confidence", 0.8],
        ["confirmed team without id", "teams.actor.teamId", null],
        ["confirmed team without source", "teams.actor.source", null],
        ["unknown team with id", "teams.target.teamId", "team-b"],
        [
            "unknown team with source",
            "teams.target.source",
            { kind: "MATCH_RECORD", reference: "record-2" }
        ],
        ["refuted team state", "teams.target.state", "REFUTED"],
        ["unlisted team source kind", "teams.actor.source.kind", "BROADCAST"]
    ])("rejects %s", (_name, field, v) => {
        // 시험용 판례 입력 준비
        const r = input();
        // 경로 끝 필드를 가진 객체와 필드 이름 확인
        const [o, k] = locate(r, field);
        // 경로 끝 필드에 거부할 값 설정
        o[k] = v;
        // 판례 입력 형식 검사 결과의 기대값 거짓 일치 확인
        expect(agentCaseData(r)).toBe(false);
    });

    it.each([
        "eventId",
        "match.season",
        "tracks.target",
        "teams.target",
        "facts.advantageApplied",
        "facts.targetIsPlayer.state"
    ])("rejects missing %s", (field) => {
        // 시험용 판례 입력 준비
        const r = input();
        // 경로 끝 필드를 가진 객체와 필드 이름 확인
        const [o, k] = locate(r, field);
        // 경로 끝 필드 삭제
        delete o[k];
        // 판례 입력 형식 검사 결과의 기대값 거짓 일치 확인
        expect(agentCaseData(r)).toBe(false);
    });

    it.each(textFields.flatMap((field) => badText.map((bad) => ({ ...bad, field }))))(
        "rejects $label $field",
        ({ field, v }) => {
            // 시험용 판례 입력 준비
            const r = input();
            // 경로 끝 필드를 가진 객체와 필드 이름 확인
            const [o, k] = locate(r, field);
            // 경로 끝 필드에 문자열 규칙 위반 값 설정
            o[k] = v;
            // 판례 입력 형식 검사 결과의 기대값 거짓 일치 확인
            expect(agentCaseData(r)).toBe(false);
        }
    );

    it.each(badText)("rejects $label segment ids on both tracks", ({ v }) => {
        // 시험용 판례 입력 준비
        const r = input();
        // 행위자 트랙 구간을 위반 값으로 설정
        r.tracks.actor.segmentId = v;
        // 대상 트랙 구간을 같은 위반 값으로 설정
        r.tracks.target.segmentId = v;
        // 판례 입력 형식 검사 결과의 기대값 거짓 일치 확인
        expect(agentCaseData(r)).toBe(false);
    });

    it.each([{ v: null }, { v: [] }, { v: "case" }, { v: 1 }])(
        "rejects non-object input $v",
        ({ v }) => {
            // 판례 입력 형식 검사 결과의 기대값 거짓 일치 확인
            expect(agentCaseData(v)).toBe(false);
        }
    );
});

describe("agent-calibration-v1 format", () => {
    it.each([
        ["UNCALIBRATED", null],
        ["CALIBRATED_DEVELOPMENT", "c".repeat(64)]
    ])("accepts %s with its report hash rule", (status, hash) => {
        // 시험용 보정 준비
        const c = calibration();
        // 보정 상태 설정
        c.status = status;
        // 검증 보고서 해시 설정
        c.reportSha256 = hash;
        // 보정 형식 검사 결과의 기대값 참 일치 확인
        expect(calibrationData(c)).toBe(true);
    });

    it("accepts boundary thresholds and a later method version", () => {
        // 시험용 보정 준비
        const c = calibration();
        // 접촉 확인 최소 시간을 잡기 부정 최대 시간과 같은 값으로 설정
        c.facts.bodyOrEquipmentContact.rule.confirmMinMs = 150;
        // 동작 최소 관측 비율을 상한 1로 설정
        c.facts.actionObserved.rule.minCoverage = 1;
        // 방향 다수 비율을 상한 1로 설정
        c.facts.directionObserved.rule.majority = 1;
        // 방법 판 번호를 2로 설정
        c.method.version = "2";
        // 보정 형식 검사 결과의 기대값 참 일치 확인
        expect(calibrationData(c)).toBe(true);
    });

    it.each([
        ["uncalibrated status with a report hash", "UNCALIBRATED", "c".repeat(64)],
        ["development status without a report hash", "CALIBRATED_DEVELOPMENT", null],
        ["uppercase report hash", "CALIBRATED_DEVELOPMENT", "C".repeat(64)],
        ["short report hash", "CALIBRATED_DEVELOPMENT", "c".repeat(63)],
        ["non-hex report hash", "CALIBRATED_DEVELOPMENT", "g".repeat(64)],
        ["evaluation status", "CALIBRATED_EVALUATION", "c".repeat(64)],
        ["lowercase status", "uncalibrated", null]
    ])("rejects %s", (_name, status, hash) => {
        // 시험용 보정 준비
        const c = calibration();
        // 보정 상태 설정
        c.status = status;
        // 검증 보고서 해시 설정
        c.reportSha256 = hash;
        // 보정 형식 검사 결과의 기대값 거짓 일치 확인
        expect(calibrationData(c)).toBe(false);
    });

    it.each([
        ["next schema version", "schemaVersion", "agent-calibration-v2"],
        ["unknown root field", "note", "x"],
        ["other method id", "method.id", "other-agent"],
        ["zero method version", "method.version", "0"],
        ["zero padded method version", "method.version", "01"],
        ["numeric method version", "method.version", 1],
        ["extra method field", "method.name", "agent"],
        ["null method", "method", null],
        ["facts array", "facts", []],
        ["unknown skill", "facts.pulling.skill", "drag"],
        ["extra rule key", "facts.actionObserved.rule.maxMs", 500],
        ["extra fact entry field", "facts.actionObserved.weight", 1],
        ["null rule", "facts.gripMaintained.rule", null],
        [
            "contact confirm distance not below refute distance",
            "facts.bodyOrEquipmentContact.rule.confirmBelow",
            0.12
        ],
        [
            "contact refute distance not below near distance",
            "facts.bodyOrEquipmentContact.rule.refuteAbove",
            0.15
        ],
        ["near distance not below far distance", "facts.actionObserved.rule.nearBelow", 0.3],
        ["pulling refute angle not below confirm angle", "facts.pulling.rule.refuteDeltaDeg", 20],
        [
            "impeded refute drop not below confirm drop",
            "facts.movementImpeded.rule.refuteDrop",
            0.4
        ],
        [
            "contact time above grip refute time",
            "facts.bodyOrEquipmentContact.rule.confirmMinMs",
            151
        ],
        ["grip refute time not below confirm time", "facts.gripMaintained.rule.refuteMaxMs", 400],
        ["zero coverage", "facts.actionObserved.rule.minCoverage", 0],
        ["coverage above one", "facts.pulling.rule.minCoverage", 1.01],
        ["half majority", "facts.directionObserved.rule.majority", 0.5],
        ["majority above one", "facts.directionObserved.rule.majority", 1.1],
        ["zero time", "facts.actionObserved.rule.minMs", 0],
        ["fractional time", "facts.pulling.rule.minMs", 1.5],
        ["zero threshold", "facts.movementImpeded.rule.minBaseline", 0],
        ["negative threshold", "facts.movementImpeded.rule.minBaseline", -0.5],
        ["infinite threshold", "facts.movementImpeded.rule.minBaseline", Infinity],
        ["not-a-number threshold", "facts.actionObserved.rule.farAbove", NaN],
        ["string threshold", "facts.movementImpeded.rule.minBaseline", "0.5"],
        ["duplicate priority", "facts.directionObserved.priority", 4],
        ["zero priority", "facts.actionObserved.priority", 0],
        ["fractional priority", "facts.pulling.priority", 5.5],
        [
            "requirement with a later priority",
            "facts.actionObserved.requires",
            ["bodyOrEquipmentContact"]
        ],
        [
            "self requirement",
            "facts.bodyOrEquipmentContact.requires",
            ["bodyOrEquipmentContact"]
        ],
        [
            "requirement outside holding observations",
            "facts.directionObserved.requires",
            ["ballContact"]
        ],
        [
            "duplicate requirement",
            "facts.directionObserved.requires",
            ["bodyOrEquipmentContact", "bodyOrEquipmentContact"]
        ],
        ["requirement string", "facts.directionObserved.requires", "bodyOrEquipmentContact"]
    ])("rejects %s", (_name, field, v) => {
        // 시험용 보정 준비
        const c = calibration();
        // 경로 끝 필드를 가진 객체와 필드 이름 확인
        const [o, k] = locate(c, field);
        // 경로 끝 필드에 거부할 값 설정
        o[k] = v;
        // 보정 형식 검사 결과의 기대값 거짓 일치 확인
        expect(calibrationData(c)).toBe(false);
    });

    it.each([
        "reportSha256",
        "method.version",
        "facts.movementImpeded",
        "facts.directionObserved.requires",
        "facts.gripMaintained.rule.refuteMaxMs"
    ])("rejects missing %s", (field) => {
        // 시험용 보정 준비
        const c = calibration();
        // 경로 끝 필드를 가진 객체와 필드 이름 확인
        const [o, k] = locate(c, field);
        // 경로 끝 필드 삭제
        delete o[k];
        // 보정 형식 검사 결과의 기대값 거짓 일치 확인
        expect(calibrationData(c)).toBe(false);
    });

    it.each([
        [
            "fact outside holding observations",
            (c: any) => {
                // 잡기 관측 키 밖 사실을 당기기 사실 사본과 새 우선순위로 추가
                c.facts.ballContact = { ...c.facts.pulling, priority: 7 };
            }
        ],
        [
            "skills swapped between facts",
            (c: any) => {
                // 당기기 사실 원본 보관
                const pulling = c.facts.pulling;
                // 당기기 자리에 이동 방해 사실 내용 배치
                c.facts.pulling = c.facts.movementImpeded;
                // 이동 방해 자리에 당기기 사실 내용 배치
                c.facts.movementImpeded = pulling;
            }
        ]
    ])("rejects %s", (_name, mutate) => {
        // 시험용 보정 준비
        const c = calibration();
        // 거부할 자료 형태로 시험 보정 변경
        mutate(c);
        // 보정 형식 검사 결과의 기대값 거짓 일치 확인
        expect(calibrationData(c)).toBe(false);
    });

    it.each([{ v: null }, { v: [] }, { v: "calibration" }, { v: 1 }])(
        "rejects non-object calibration $v",
        ({ v }) => {
            // 보정 형식 검사 결과의 기대값 거짓 일치 확인
            expect(calibrationData(v)).toBe(false);
        }
    );
});
