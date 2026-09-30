// 원본 해시로 검증된 경기 정보 정의
export type KnownVideoSource = Readonly<{
    // 분석한 원본 영상의 내용 해시
    sourceSha256: string;
    // 등록 원본과 경기 정보를 연결하는 키
    matchKey: string;
    // 규정 적용 대상 대회
    competition: "K리그1" | "K리그2";
    // 규정 적용 대상 시즌
    season: string;
    // 해당 경기의 대회 라운드
    round: number;
    // 업로드 날짜와 구분한 실제 경기 날짜
    matchDate: string;
    // 확인된 홈 구단 이름
    home: string;
    // 확인된 원정 구단 이름
    away: string;
    // 확인된 홈 구단 점수
    scoreHome: number;
    // 확인된 원정 구단 점수
    scoreAway: number;
    // 원본 경기 문맥의 검증 근거
    verification: "REGISTERED_SOURCE_HASH";
    // 검증된 국제 축구 규정 판본 식별자
    verifiedIfabVersionId: null;
    // 등록 원본 문맥을 확인한 출처 주소 목록
    sourceUrls: readonly string[];
}>;

// 공식 일정·구단 결과와 원본의 팀·최종 점수를 대조한 알려진 원본만 연결
// 경기 신원의 확인이며 국제축구평의회 판본 채택이나 영상 속 판정 사실의 확인은 아님
const sources: readonly KnownVideoSource[] = [Object.freeze({
    // 분석한 원본 영상의 내용 해시
    sourceSha256: "2242f5fc1b0e61e7b6ef9e184aab7ef4ff3dc13bfc9e03f9a16ab0e015b00857",
    // 등록 원본과 경기 정보를 연결하는 키
    matchKey: "kleague2-2026-r20-cheongju-suwon",
    // 규정 적용 대상 대회
    competition: "K리그2", season: "2026", round: 20, matchDate: "2026-08-01",
    // 확인된 홈 구단 이름
    home: "충북청주", away: "수원", scoreHome: 2, scoreAway: 2,
    // 원본 경기 문맥의 검증 근거
    verification: "REGISTERED_SOURCE_HASH", verifiedIfabVersionId: null,
    // 등록 원본 문맥을 확인한 출처 주소 목록
    sourceUrls: Object.freeze([
        "https://assist.kleague.com/newsDetail?seq=374174&tab=all",
        "https://www.chfc.kr/ma/ma_l.php",
    ]),
})];
// 원본 내용 해시로 검증된 경기 정보를 찾는 조회표 생성
const registry = new Map(sources.map((source) => [source.sourceSha256, source]));

// 원본 처리
export const knownVideoSource = (sha256: string): KnownVideoSource | null =>
    /^[0-9a-f]{64}$/i.test(sha256) ? registry.get(sha256.toLowerCase()) ?? null : null;
