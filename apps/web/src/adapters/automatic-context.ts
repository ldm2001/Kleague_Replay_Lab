// 저장소 질의와 자료 구조 정의 기능 가져옴
import { sql, type SQL } from "drizzle-orm";
// 원본 해시에 대응하는 검증된 경기 문맥 가져옴
import { knownVideoSource } from "./sources";

// 인증된 작업·분석·원본 행 잠금 상태에서 조회하며 메타데이터 추정 생성 제외
export async function automaticContext(
    sourceSha256: string,
    execute: (statement: SQL) => Promise<unknown>
): Promise<{ matchId: string; ruleId: string | null } | null> {
    // 원본 내용 해시와 일치하는 검증된 경기 등록 정보 조회
    const source = knownVideoSource(sourceSha256);
    // 등록되지 않은 원본은 경기 문맥을 추정하지 않고 제외
    if (!source) return null;
    // 등록 원본의 대회 날짜 구단 점수와 일치하는 경기 조회
    const matches = (await execute(sql`
    select match.id from matches as match
    join clubs as home on home.id = match.home_club_id
    join clubs as away on away.id = match.away_club_id
    where match.competition = ${source.competition} and match.season = ${source.season}
      and match.match_date = ${source.matchDate} and home.canonical_name = ${source.home} and away.canonical_name = ${source.away}
      and match.score_home = ${source.scoreHome} and match.score_away = ${source.scoreAway}
    for share of match, home, away
  `)) as Array<{ id: string }>;
    // 일치하는 경기가 하나가 아니면 모호한 연결 차단
    if (matches.length !== 1) return null;
    // 경기 날짜와 대회 및 시즌에 맞는 검증된 규정 판본 조회
    const rules = (await execute(sql`
    select id from competition_rule_versions
    where competition = ${source.competition} and season = ${source.season}
      and effective_from <= ${source.matchDate} and (effective_to is null or effective_to >= ${source.matchDate})
      and verification_status = 'VERIFIED' and nullif(trim(source_document), '') is not null
    for share
  `)) as Array<{ id: string }>;
    // 하나로 확인된 경기와 유일한 규정 판본 연결 반환
    return { matchId: matches[0]!.id, ruleId: rules.length === 1 ? rules[0]!.id : null };
}
