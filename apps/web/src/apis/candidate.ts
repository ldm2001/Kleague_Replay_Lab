// 분석 처리 유스케이스와 저장소 계약 가져옴
import type {
    DecisionInput,
    DecisionResult,
    FactInput,
    FactResult,
    SessionRecord
} from "@replay/application";

// 규정 평가 요청 처리 의존 기능 계약 정의
export type EvaluationApiDependencies = Readonly<{
    // 접근 토큰에서 세션 기록을 찾는 기능
    resolve: (token: string) => Promise<SessionRecord | null>;
    // 확인된 출처와 판본을 보존하는 규정 사실 자료
    facts: (input: FactInput) => Promise<FactResult>;
    // 사실과 규정을 대조하는 판단 처리
    decision: (input: DecisionInput) => Promise<DecisionResult>;
}>;

// 직렬화 자료 응답 생성
const json = (body: unknown, status: number): Response =>
    new Response(JSON.stringify(body), {
        // 처리 상태 또는 요청 응답 상태
        status,
        // 자료 형식과 캐시 및 보안을 전달하는 응답 헤더
        headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
    });

// 세션 쿠키 추출
const cookie = (request: Request): string | null => {
    // 요청 쿠키 헤더 조회
    const value = request.headers.get("cookie");
    // 쿠키가 없으면 빈 결과 반환
    if (!value) return null;
    // 세션 쿠키 항목 탐색
    for (const item of value.split(";")) {
        // 쿠키 이름과 값 분리
        const [name, ...parts] = item.trim().split("=");
        // 세션 쿠키 반환
        if (name === "replay_session") return decodeURIComponent(parts.join("="));
    }
    // 세션 쿠키 없음 반환
    return null;
};

// 요청 본문 해석
const body = async (request: Request): Promise<Record<string, unknown> | null> => {
    // 본문 해석 오류가 요청 처리를 중단하지 않도록 예외 경계 설정
    try {
        // 요청 직렬화 자료 본문 조회
        const value: unknown = await request.json();
        // 객체 본문만 반환
        return typeof value === "object" && value !== null && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : null;
    } catch {
        // 직렬화 자료 해석 실패 반환
        return null;
    }
};

// 사실 입력 검증
const factInput = (
    value: Record<string, unknown>
): Pick<FactInput, "expectedFactRevisionId" | "facts" | "idempotencyKey"> | null => {
    // 사실 입력 필드 추출
    const key = value.idempotencyKey;
    // 사실 입력 기본 형식 확인
    if (
        typeof key !== "string" ||
        typeof value.facts !== "object" ||
        value.facts === null ||
        Array.isArray(value.facts)
    ) {
        // 사실 입력의 필수 형식 미충족 반환
        return null;
    }
    // 예상 이력 식별자 형식 확인
    if (
        value.expectedFactRevisionId !== undefined &&
        value.expectedFactRevisionId !== null &&
        typeof value.expectedFactRevisionId !== "string"
    ) {
        // 예상 사실 판본의 형식 미충족 반환
        return null;
    }
    // 사실 입력 반환
    return {
        // 재요청을 중복 실행하지 않기 위한 키
        idempotencyKey: key,
        // 확인된 출처와 판본을 보존하는 규정 사실 자료
        facts: value.facts,
        ...(value.expectedFactRevisionId === undefined
            ? {}
            : { expectedFactRevisionId: value.expectedFactRevisionId as string | null })
    };
};

// 사실 응답 상태 계산
const factCode = (result: FactResult): number => {
    // 새 사실 생성과 동일 요청 재처리의 성공 응답 구분
    if (result.kind === "CREATED" || result.kind === "REPLAYED")
        // 새 생성과 기존 결과 재사용에 맞는 성공 상태 반환
        return result.kind === "CREATED" ? 201 : 200;
    // 사실 판본 충돌 또는 요청 키 오용을 충돌 상태로 분류
    if (result.kind === "STALE_FACT_REVISION" || result.kind === "IDEMPOTENCY_KEY_REUSED")
        // 상태 충돌을 나타내는 응답 번호 반환
        return 409;
    // 대상 사실 기록 부재를 찾을 수 없음 응답으로 분류
    if (result.kind === "NOT_FOUND") return 404;
    // 나머지 입력 오류의 응답 번호 반환
    return 400;
};

// 판정 응답 상태 계산
const decisionCode = (result: DecisionResult): number => {
    // 사실과 규정 평가 결과에 맞는 요청 응답 상태 선택
    switch (result.kind) {
        // 새 기록 생성에 대응하는 응답 분기
        case "CREATED": return 201;
        // 동일 요청의 기존 결과에 대응하는 응답 분기
        case "REPLAYED": return 200;
        // 대상 기록 없음에 대응하는 응답 분기
        case "NOT_FOUND":
        // 평가할 사실 기록 없음에 대응하는 응답 분기
        case "NO_FACTS": return 404;
        // 요청한 사실 판본 없음에 대응하는 응답 분기
        case "FACT_NOT_FOUND":
        // 다른 요청에 의해 변경된 사실 판본에 대응하는 응답 분기
        case "STALE_FACT_REVISION":
        // 다른 요청에 의해 변경된 분석 상태에 대응하는 응답 분기
        case "STALE_ANALYSIS":
        // 사용할 수 없는 규정 판본에 대응하는 응답 분기
        case "RULE_VERSION_UNAVAILABLE":
        // 확정되지 않은 규정 판본에 대응하는 응답 분기
        case "RULE_VERSION_UNKNOWN": return 409;
        // 규정 평가 실패에 대응하는 응답 분기
        case "EVALUATION_FAILED": return 422;
        // 입력 계약 위반에 대응하는 응답 분기
        case "INVALID_INPUT": return 400;
    }
};

// 사실 처리
export const facts = async (
    request: Request,
    params: Readonly<{ analysisId: string; candidateId: string }>,
    dependencies: EvaluationApiDependencies,
): Promise<Response> => {
    // 세션 쿠키로 익명 세션 조회
    const session = await dependencies.resolve(cookie(request) ?? "");
    // 세션이 없으면 사실 저장 차단
    if (!session) return json({ kind: "UNAUTHORIZED" }, 401);
    // 사실 요청 본문 조회
    const value = await body(request);
    // 사실 요청 입력 변환
    const payload = value ? factInput(value) : null;
    // 입력 형식 확인
    if (!payload) return json({ kind: "INVALID_REQUEST" }, 400);
    // 사실 저장 유스케이스 호출
    const result = await dependencies.facts({
        ...payload,
        // 업로드 소유자를 구별하는 익명 세션 식별자
        anonymousSessionId: session.sessionId,
        // 분석 기록의 식별자
        analysisId: params.analysisId,
        // 사실 또는 평가와 연결할 후보 식별자
        candidateId: params.candidateId,
    });
    // 사실 저장 결과 응답
    return json(result, factCode(result));
};

// 판정 처리
export const decision = async (
    request: Request,
    params: Readonly<{ analysisId: string; candidateId: string }>,
    dependencies: EvaluationApiDependencies,
): Promise<Response> => {
    // 세션 쿠키로 익명 세션 조회
    const session = await dependencies.resolve(cookie(request) ?? "");
    // 세션이 없으면 판정 저장 차단
    if (!session) return json({ kind: "UNAUTHORIZED" }, 401);
    // 판정 계산 유스케이스 호출
    const result = await dependencies.decision({
        // 업로드 소유자를 구별하는 익명 세션 식별자
        anonymousSessionId: session.sessionId,
        // 분석 기록의 식별자
        analysisId: params.analysisId,
        // 사실 또는 평가와 연결할 후보 식별자
        candidateId: params.candidateId,
    });
    // 판정 결과 응답
    return json(result, decisionCode(result));
};
