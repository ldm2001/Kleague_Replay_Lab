export type KnownVideoSource = Readonly<{
  sourceSha256: string;
  matchKey: string;
  competition: "K리그1" | "K리그2";
  season: string;
  round: number;
  matchDate: string;
  home: string;
  away: string;
  scoreHome: number;
  scoreAway: number;
  verification: "REGISTERED_SOURCE_HASH";
  verifiedIfabVersionId: null;
  sourceUrls: readonly string[];
}>;

// 공식 일정·구단 결과와 원본의 팀·최종 점수를 대조한 알려진 원본만 연결한다
// 경기 신원의 확인이며 IFAB 판본 채택이나 영상 속 판정 사실의 확인은 아니다
const sources: readonly KnownVideoSource[] = [Object.freeze({
  sourceSha256: "2242f5fc1b0e61e7b6ef9e184aab7ef4ff3dc13bfc9e03f9a16ab0e015b00857",
  matchKey: "kleague2-2026-r20-cheongju-suwon",
  competition: "K리그2", season: "2026", round: 20, matchDate: "2026-08-01",
  home: "충북청주", away: "수원", scoreHome: 2, scoreAway: 2,
  verification: "REGISTERED_SOURCE_HASH", verifiedIfabVersionId: null,
  sourceUrls: Object.freeze([
    "https://assist.kleague.com/newsDetail?seq=374174&tab=all",
    "https://www.chfc.kr/ma/ma_l.php",
  ]),
})];
const registry = new Map(sources.map((source) => [source.sourceSha256, source]));

export const knownVideoSource = (sha256: string): KnownVideoSource | null =>
  /^[0-9a-f]{64}$/i.test(sha256) ? registry.get(sha256.toLowerCase()) ?? null : null;
