// 공통 관측과 판정 자료형 가져오기
import type { ConceptKey } from "@replay/shared-types";
// 대회요강 자료형 가져오기
import type { CompetitionRuleBook } from "../../shared/competition-rules";
// 규정 자료 구조 가져오기
import type { StoredCitation } from "./schema";

// 대회요강 실행 자료 파일의 자료 구조 정의
export type CompetitionRuleBookFile = Omit<CompetitionRuleBook, "cite"> & {
    // 조항을 조회하기 위한 의미별 키
    concepts: Partial<Record<ConceptKey, StoredCitation[]>>;
};
