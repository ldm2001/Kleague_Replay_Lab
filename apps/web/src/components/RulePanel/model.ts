// 서버와 공유할 자료 계약 형식 읽음
import type { RuleCitation, ScopeNotAssessed } from "@replay/shared-types";

// 평가하지 않은 질문 한 건의 이름과 사유 정의
type Question = Readonly<{ name: string; reason: string }>;

// 범위 분석에서 평가하지 않은 질문별 이름과 사유 연결
export const unassessed: Record<ScopeNotAssessed, Question> = {
    // 반칙 성립 여부 미평가 상태의 이름과 사유 연결
    FOUL_DECISION: {
        name: "반칙 여부",
        reason: "대회요강의 VAR 적용 범주만 확인하며 장면의 반칙 여부는 판단하지 않습니다"
    },
    // 주심 판정 정확성 미평가 상태의 이름과 사유 연결
    REFEREE_DECISION_CORRECTNESS: {
        name: "주심 판정의 정확성",
        reason: "주심이 실제로 내린 판정을 확인하지 않으므로 그 판정이 맞았는지는 평가하지 않습니다"
    },
    // VAR 검토 실시 여부 미평가 상태의 이름과 사유 연결
    VAR_CHECK_PERFORMED: {
        name: "VAR 검토 실시 여부",
        reason: "경기 중 VAR 검토가 실제로 있었는지는 확인하지 않습니다"
    },
    // VAR 개입 필요성 미평가 상태의 이름과 사유 연결
    VAR_INTERVENTION_NECESSITY: {
        name: "VAR 개입 필요성",
        reason: "VAR이 판정에 개입해야 했는지는 판단하지 않습니다"
    },
    // 검토 시한 미평가 상태의 이름과 사유 연결
    REVIEW_TIME_WINDOW: {
        name: "검토 시한",
        reason: "해당 장면을 검토할 수 있는 시간 안에 있었는지는 평가하지 않습니다"
    },
    // IFAB 판본 미채택 상태의 이름과 사유 연결
    IFAB_EDITION_ADOPTION: {
        name: "IFAB 경기규칙서 판본",
        reason: "경기에 적용되는 판본은 판단하지 않으며 업로드 날짜로 추정하지도 않습니다"
    }
};

// 사전에 없는 질문의 일반 이름과 사유 정의
const other: Question = {
    name: "그 밖의 질문",
    reason: "이 분석에서 평가하지 않은 질문입니다"
};

// 사전이 직접 가진 질문 식별자 확인
const known = (code: string): code is ScopeNotAssessed => Object.hasOwn(unassessed, code);

// 질문 식별자의 이름과 사유 반환하며 사전 밖 식별자는 일반 항목 반환
export const question = (code: string): Question => (known(code) ? unassessed[code] : other);

// 판본을 지정하지 않은 위임 조항의 안내 문구 정의
export const delegationNote = "대회요강이 IFAB·FIFA 규정을 따르도록 한 조항이며 판본은 지정하지 않습니다";

// 번호만으로 이루어진 조항 값 확인
const digits = (value: string): boolean => /^\d+$/.test(value);

// 영문자로 시작하고 영문자와 공백만 가진 이름형 세부 확인
const named = (value: string): boolean => /^[A-Za-z][A-Za-z ]*$/.test(value);

// Law가 아닌 영문자만 가진 이름형 영역 확인
const area = (value: string): boolean => /^[A-Za-z]+$/.test(value) && value !== "Law";

// 조항 표기에 필요한 인용 항목 정의
type Clause = Pick<RuleCitation, "authority" | "law" | "section">;

// 규정 인용의 조항 표기 변환
export const clause = ({ authority, law, section }: Clause): string => {
    // 대회요강은 조와 항 번호로 표기
    if (authority === "KLEAGUE" && digits(law) && digits(section)) {
        return `대회요강 제${law}조 ${section}항`;
    }
    // 번호형 규칙의 번호형 세부는 점으로 연결
    if (authority === "IFAB" && digits(law) && digits(section)) {
        return `IFAB Law ${law}.${section}`;
    }
    // 번호형 규칙의 이름형 세부는 가운뎃점으로 연결
    if (authority === "IFAB" && digits(law) && named(section)) {
        return `IFAB Law ${law} · ${section}`;
    }
    // 이름형 영역의 이름형 세부는 가운뎃점으로 연결
    if (authority === "IFAB" && area(law) && named(section)) {
        return `IFAB ${law} · ${section}`;
    }
    // 이름형 영역의 번호형 세부와 그 밖의 형태 및 출처는 기록된 값을 그대로 표기
    return `${authority} ${law} ${section}`;
};
