import { sql, type SQL } from "drizzle-orm";
import { knownVideoSource } from "./known-video-sources";

// Caller holds the authenticated job, analysis and source rows locked. No metadata is created or guessed.
export async function automaticContext(sourceSha256: string, execute: (statement: SQL) => Promise<unknown>): Promise<{ matchId: string; ruleId: string | null } | null> {
  const source = knownVideoSource(sourceSha256);
  if (!source) return null;
  const matches = await execute(sql`
    select match.id from matches as match
    join clubs as home on home.id = match.home_club_id
    join clubs as away on away.id = match.away_club_id
    where match.competition = ${source.competition} and match.season = ${source.season}
      and match.match_date = ${source.matchDate} and home.canonical_name = ${source.home} and away.canonical_name = ${source.away}
      and match.score_home = ${source.scoreHome} and match.score_away = ${source.scoreAway}
    for share of match, home, away
  `) as Array<{ id: string }>;
  if (matches.length !== 1) return null;
  const rules = await execute(sql`
    select id from competition_rule_versions
    where competition = ${source.competition} and season = ${source.season}
      and effective_from <= ${source.matchDate} and (effective_to is null or effective_to >= ${source.matchDate})
      and verification_status = 'VERIFIED' and nullif(trim(source_document), '') is not null
    for share
  `) as Array<{ id: string }>;
  return { matchId: matches[0]!.id, ruleId: rules.length === 1 ? rules[0]!.id : null };
}
