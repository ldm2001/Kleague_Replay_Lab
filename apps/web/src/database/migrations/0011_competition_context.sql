ALTER TABLE upload_intents
  ADD COLUMN competition varchar(64) NOT NULL DEFAULT 'K리그1',
  ADD COLUMN season varchar(16) NOT NULL DEFAULT '2026';

ALTER TABLE video_assets
  ADD COLUMN competition varchar(64) NOT NULL DEFAULT 'K리그1',
  ADD COLUMN season varchar(16) NOT NULL DEFAULT '2026';

INSERT INTO competition_rule_versions (
  competition, season, effective_from, effective_to, ifab_edition,
  source_document, verification_status
)
VALUES
  ('K리그1', '2026', '2026-02-28', '2026-06-30', '2025-26',
   'https://www.kleague.com/about/competition.do', 'VERIFIED_KLEAGUE_INFERRED_IFAB'),
  ('K리그1', '2026', '2026-07-01', '2026-12-06', '2026-27',
   'https://www.kleague.com/about/competition.do', 'VERIFIED_KLEAGUE_INFERRED_IFAB'),
  ('K리그2', '2026', '2026-02-28', '2026-06-30', '2025-26',
   'https://www.kleague.com/about/competition.do', 'VERIFIED_KLEAGUE_INFERRED_IFAB'),
  ('K리그2', '2026', '2026-07-01', '2026-12-06', '2026-27',
   'https://www.kleague.com/about/competition.do', 'VERIFIED_KLEAGUE_INFERRED_IFAB')
ON CONFLICT DO NOTHING;

INSERT INTO rules (
  authority, edition, law, section, concept, revision, content_sha256,
  original_text, official_korean, plain_korean, source_page, source_url, review_status
)
VALUES
  ('KLEAGUE', '2026', '25', '1', 'VAR_REVIEWABLE_CATEGORIES', 1,
   digest('K리그 VAR은 득점 상황 PK 상황 퇴장 상황 징계조치 오류에만 적용한다', 'sha256'),
   'VAR은 경기 결과를 바꿀 수 있는 명백한 오심을 변경하기 위해 시행하며 득점 상황 PK 상황 퇴장 상황 징계조치 오류에만 적용한다',
   'VAR은 주심 등 해당 경기 심판진을 지원하고 경기 결과를 바꿀 수 있는 명백한 오심을 변경해 공정한 판정을 증대하기 위해 시행하며 본 대회에서는 아래의 4가지 상황에 대해서만 VAR을 적용한다',
   'K리그 대회요강은 VAR 검토 범위를 득점 PK 퇴장 징계조치 오류 네 범주로 제한한다',
   '25조 1항', 'https://www.kleague.com/about/competition.do', 'VERIFIED_PAGE'),
  ('KLEAGUE', '2026', '22', '1', 'VAR_REVIEWABLE_CATEGORIES', 1,
   digest('K리그 VAR은 득점 상황 PK 상황 퇴장 상황 징계조치 오류에만 적용한다', 'sha256'),
   'VAR은 경기 결과를 바꿀 수 있는 명백한 오심을 변경하기 위해 시행하며 득점 상황 PK 상황 퇴장 상황 징계조치 오류에만 적용한다',
   'VAR은 주심 등 해당 경기 심판진을 지원하고 경기 결과를 바꿀 수 있는 명백한 오심을 변경해 공정한 판정을 증대하기 위해 시행하며 본 대회에서는 아래의 4가지 상황에 대해서만 VAR을 적용한다',
   'K리그 대회요강은 VAR 검토 범위를 득점 PK 퇴장 징계조치 오류 네 범주로 제한한다',
   '22조 1항', 'https://www.kleague.com/about/competition.do', 'VERIFIED_PAGE')
ON CONFLICT DO NOTHING;

UPDATE analyses AS analysis
SET applied_rule_version_id = version.id
FROM video_assets AS video
JOIN competition_rule_versions AS version
  ON version.competition = video.competition
 AND version.season = video.season
 AND video.created_at::date BETWEEN version.effective_from AND COALESCE(version.effective_to, 'infinity'::date)
WHERE analysis.video_asset_id = video.id
  AND analysis.applied_rule_version_id IS NULL;
