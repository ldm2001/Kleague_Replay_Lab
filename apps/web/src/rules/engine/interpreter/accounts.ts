// 공통 관측과 판정 자료형 가져오기
import type {
    AuthorityAccount,
    FactBlocker,
    FactRequirement,
    LayerConflict,
    Observed,
    PushFacts,
    RuleCitation,
    RuleSet
} from "@replay/shared-types";

// 밀기 판단의 기준별 설명의 자료 구조 정의
export type PushAccountView = {
    // 판정 기준별 세부 설명
    accounts: AuthorityAccount[];
    // 서로 충돌하는 규정 조건
    conflicts: LayerConflict[];
    // 상위 규정을 좁혀 적용한 범주
    narrowedTo: RuleCitation[];
    // 해당 규정으로 차단된 검토 범주
    blockedFrom: FactRequirement[];
};

// 규정 질문에 답하지 못하는 값
const UNRESOLVED_VALUES: ReadonlySet<unknown> = new Set([
    "uncertain",
    "possible",
    "UNKNOWN",
    null,
    undefined
]);

// 사실값별 차단 사유
const requirement = (
    fact: string,
    observation: Observed<unknown> | undefined,
    options: { cameraSufficiency: PushFacts["cameraSufficiency"]; needsNormalSpeed: boolean },
    narrowsTo: RuleCitation | null,
): FactRequirement => {
    // 사실 차단 상태 초기화
    let blockedBy: FactBlocker | null = null;
    // 사실 확정 상태 초기화
    let established = true;

    // 질문 확인에 필요한 카메라 근거 충분성의 조건에 따라 처리 분기
    if (options.cameraSufficiency === "LOW") {
        // 판단을 막는 근거 부족 원인 갱신
        blockedBy = "CAMERA";
        // 사실을 규정 판단에 사용할 수 있는지 여부 갱신
        established = false;
    } else if (!observation) {
        // 판단을 막는 근거 부족 원인 갱신
        blockedBy = "NOT_IN_FOOTAGE";
        // 사실을 규정 판단에 사용할 수 있는지 여부 갱신
        established = false;
    } else if (options.needsNormalSpeed && observation.observedAtSpeed !== "NORMAL") {
        // 판단을 막는 근거 부족 원인 갱신
        blockedBy = "SPEED";
        // 사실을 규정 판단에 사용할 수 있는지 여부 갱신
        established = false;
    } else if (UNRESOLVED_VALUES.has(observation.value)) {
        // 사실을 규정 판단에 사용할 수 있는지 여부 갱신
        established = false;
    }

    // 호출자가 사용할 결과 항목을 하나의 객체로 반환
    return {
        // 검사할 개별 사실 기록
        fact,
        // 현재 처리 상태 기록
        status: established ? "ESTABLISHED" : "UNMET",
        // 판단을 막는 근거 부족 원인 기록
        blockedBy,
        // 범위를 제한하는 조건 기록
        narrowsTo,
    };
};

// 규정 요구사항과 차단 사실
export const pushAccounts = (facts: PushFacts, rules: RuleSet): PushAccountView => {
    // 밀기 판정 조항 조회
    const offenceCitations = rules.cite("LAW_12_DIRECT_FREE_KICK");
    // 징계 구분을 설명하는 규정 인용 확인
    const disciplineCitations = rules.cite("LAW_12_DISCIPLINE");
    // 정상 속도 확인을 요구하는 규정 인용 확인
    const speedCitations = rules.cite("VAR_REVIEW_PROCESS");
    // 징계 설명에 사용할 첫 인용 계산
    const disciplineEntry = disciplineCitations[0] ?? null;

    // 카메라 근거 충분성 구성
    const camera = { cameraSufficiency: facts.cameraSufficiency, needsNormalSpeed: false };
    // 정상 속도까지 필요한 사실 조건 구성
    const cameraAndSpeed = { cameraSufficiency: facts.cameraSufficiency, needsNormalSpeed: true };

    // 아직 확인이 필요한 사실 조건 구성
    const requires: FactRequirement[] = [
        requirement("contactDetected", facts.contactDetected, camera, offenceCitations[0] ?? null),
        // 강도는 정상 속도 관측 필요
        requirement("severity", facts.severity, cameraAndSpeed, disciplineEntry),
        requirement("opponentDisplacement", facts.opponentDisplacement, camera, disciplineEntry),
        requirement(
            "insidePenaltyArea",
            facts.insidePenaltyArea,
            camera,
            offenceCitations[0] ?? null
        ),
        ...(
            [
                "ballInPlay",
                "onField",
                "againstOpponent",
                "offenderRole",
                "insideOwnPenaltyArea",
                "disciplinaryContext"
            ] as const
        ).map((key) =>
            requirement(
                `context.${key}`,
                facts.context?.[key],
                camera,
                key === "disciplinaryContext" ? disciplineEntry : (offenceCitations[0] ?? null)
            )
        )
    ];

    // 해당 규정으로 차단된 검토 범주 선별
    const blockedFrom = requires.filter((entry) => entry.status === "UNMET");
    // 강도 사실 확정 여부 계산
    const severityEstablished =
        requires.find((entry) => entry.fact === "severity")?.status === "ESTABLISHED";

    // 상위 규정을 좁혀 적용한 범주 구성
    const narrowedTo: RuleCitation[] = [...offenceCitations];
    // 행위 강도의 판단 근거 충족 여부의 조건에 따라 처리 분기
    if (severityEstablished) {
        // 상위 규정을 좁혀 적용한 범주 목록에 현재 항목 추가
        narrowedTo.push(...disciplineCitations);
    } else if (facts.severity.observedAtSpeed !== "NORMAL" && facts.cameraSufficiency !== "LOW") {
        // 속도 차단 근거 추가
        narrowedTo.push(...speedCitations.filter((citation) => citation.relevance === "PRIMARY"));
    }

    // 규정 계층별 계정 구성
    const accounts: AuthorityAccount[] = offenceCitations[0]
        ? [
              {
                  // 규정을 발행한 기관 기록
                  authority: offenceCitations[0].authority,
                  // 규정 판본 기록
                  edition: offenceCitations[0].edition,
                  // 결론에 연결된 규정 인용 기록
                  citations: [...offenceCitations, ...disciplineCitations],
                  // 아직 확인이 필요한 사실 조건 기록
                  requires
              }
          ]
        : [];

    // 호출자가 사용할 결과 항목을 하나의 객체로 반환
    return { accounts, conflicts: [...rules.layerConflicts()], narrowedTo, blockedFrom };
};
