// 규정 자료와 평가 기능 가져옴
import { competitionRules, ruleSet } from "@replay/rule-data";
// 규정 필터와 범주 평가 및 고정 모델 출처 검사 가져옴
import { pinnedModels, pipelineFilter, scopeVerdict } from "@replay/rule-engine";
// 공유 자료 계약과 검증 기능 가져옴
import {
    broadcastCueData,
    knownVideoSource,
    sceneEventData,
    type AutomaticJudgment,
    type AutomaticRuleContext,
    type EvaluationFacts,
    type EvaluationResult,
    type RuleCitation,
    type ScopeEvidence,
    type VarAssessment
} from "@replay/shared-types";
// 결과 조회 원자료와 화면 모델 계약 가져옴
import type {
    AnalysisSnapshot,
    AnalysisView,
    CandidateSnapshot,
    CandidateView,
    JudgmentView,
    MediaSnapshot,
    MediaView
} from "../../ports/repositories/status-store";
// 현재 근거와 일치하는 자동 판정 연결 가져옴
import { automaticJudgments } from "../evaluation/binding";

// 보존된 판정 기록을 현재 사실 판본의 판단 화면 모델로 변환
const judgmentView = (item: CandidateSnapshot): JudgmentView | null =>
    item.factRevisionId &&
    item.factSource &&
    item.foulDecision &&
    item.varReviewable !== null &&
    item.varCategory &&
    item.varWithinTimeWindow !== null &&
    item.varThresholdMet &&
    item.varIntervention &&
    item.varWindowException &&
    item.varReviewProcedure
        ? {
              // 평가에 사용한 사실 판본 식별자
              factRevisionId: item.factRevisionId,
              // 확인된 출처와 판본을 보존하는 규정 사실 자료
              facts: item.facts as EvaluationFacts,
              // 값의 출처 또는 원본 접근 수단
              source: item.factSource,
              // 사실과 규정을 대조하는 판단 처리
              decision: item.foulDecision as EvaluationResult["decision"],
              // 규정 평가에서 구분한 행위의 심각도
              severity: item.severity as EvaluationResult["severity"],
              // 판단에 따른 경기 재개 방식
              restart: item.restartType as EvaluationResult["restart"],
              // 판단에 따른 징계 조치
              disciplinary: item.disciplinaryAction as EvaluationResult["disciplinary"],
              // 관측 원심과 규정 평가의 일치 여부
              decisionMatch: item.decisionMatch as EvaluationResult["decisionMatch"],
              // 관측 또는 판단 근거의 신뢰 수준
              confidence: item.confidenceLevel as EvaluationResult["confidence"],
              // 결론을 확정하지 못한 사유
              inconclusiveReason: item.inconclusiveReason as EvaluationResult["inconclusiveReason"],
              // 영상 판독 개입에 대한 규정 평가
              varAssessment: {
                  // 영상 판독의 검토 가능 여부
                  reviewable: item.varReviewable,
                  // 후보 사건의 분류
                  category: item.varCategory as VarAssessment["category"],
                  // 영상 판독 허용 시점 충족 여부
                  withinTimeWindow: item.varWithinTimeWindow,
                  // 영상 판독 개입 문턱 충족 여부
                  thresholdMet: item.varThresholdMet as VarAssessment["thresholdMet"],
                  // 영상 판독 검토 절차
                  reviewProcedure: item.varReviewProcedure as VarAssessment["reviewProcedure"],
                  // 영상 판독 개입 판단
                  intervention: item.varIntervention as VarAssessment["intervention"],
                  // 영상 판독에 개입하지 않는 이유
                  noInterventionReason:
                      item.varNoInterventionReason as VarAssessment["noInterventionReason"],
                  // 영상 판독 검토 대상이 아닌 이유
                  notReviewableReason:
                      item.varNotReviewableReason as VarAssessment["notReviewableReason"],
                  // 영상 판독 허용 시점 종료 사유
                  windowClosedReason:
                      item.varWindowClosedReason as VarAssessment["windowClosedReason"],
                  // 영상 판독 시점 제한의 예외
                  windowException: item.varWindowException as VarAssessment["windowException"],
                  // 판단 결과의 사용자 안내 설명
                  explanation: item.varExplanation ?? "규정 설명 없음"
              },
              // 판단 근거가 된 규정 인용 목록
              citations: (item.citations ?? []) as RuleCitation[]
          }
        : null;

// 분석 원자료를 규정 필터와 범주 평가 및 자동 평가 재검증에 대조한 내부 화면 모델 구성
const analysisView = (analysis: AnalysisSnapshot, sourceSha256: string | null): AnalysisView => {
    // 후보별 증거 묶음 초기화
    const grouped = new Map<number, Array<{ evidenceId: string; kind: "FRAME" | "CLIP" }>>();
    // 후보별 범주 평가에 사용할 증거 조회표 생성
    const scopeEvidence = new Map<number, ScopeEvidence[]>();
    // 증거 원자료를 후보 번호로 그룹화
    for (const item of analysis.evidence) {
        // 현재 후보에 누적된 증거 목록 읽음
        const entries = grouped.get(item.candidateIndex) ?? [];
        // 현재 후보의 공개 증거 식별자와 종류 추가
        entries.push({ evidenceId: item.evidenceId, kind: item.kind });
        // 후보 순번으로 증거 목록을 찾을 수 있도록 조회표 갱신
        grouped.set(item.candidateIndex, entries);
        // 현재 후보의 범주 평가용 증거 목록 읽음
        const scopeEntries = scopeEvidence.get(item.candidateIndex) ?? [];
        // 범주 평가용 증거에 원본 시간 범위 추가
        scopeEntries.push({
            // 저장된 증거 자산의 식별자
            evidenceId: item.evidenceId,
            // 처리 분기 또는 자료 종류를 구별하는 값
            kind: item.kind,
            // 원본 영상 기준 구간 시작 밀리초
            startMs: item.startMs,
            // 원본 영상 기준 구간 종료 밀리초
            endMs: item.endMs
        });
        // 후보 순번으로 시간 범위 증거를 찾도록 조회표 갱신
        scopeEvidence.set(item.candidateIndex, scopeEntries);
    }
    // 검증된 경기 연결이 없는 업로드는 추정 판본을 적용하지 않음
    const rules =
        analysis.matchId && analysis.verificationStatus === "VERIFIED" && analysis.ifabEdition
            ? ruleSet(`ifab-${analysis.ifabEdition}`)
            : null;
    // 처리 버전 유무로 자동 산출물과 예전 수동 이력 구분
    const pipelineOutput = analysis.pipelineVersion != null;
    // 원본 내용 해시와 일치하는 검증된 경기 등록 정보 조회
    const source = knownVideoSource(sourceSha256 ?? "");
    // 등록된 원본의 대회와 시즌에 맞는 규정집 조회
    const book = source ? competitionRules(source.competition, source.season) : null;
    // 예전 수동 이력에는 자동 평가를 연결하지 않음
    const automatic = pipelineOutput ? analysis.automatic : null;
    // 검증된 경기와 판본이 모두 있을 때만 규정 문맥 생성
    const currentRule: AutomaticRuleContext | null =
        analysis.ruleVersionId &&
        analysis.matchId &&
        analysis.competition &&
        analysis.season &&
        analysis.ifabEdition &&
        analysis.verificationStatus === "VERIFIED"
            ? {
                  // 다른 기록과 구별하는 고유 식별자
                  id: analysis.ruleVersionId,
                  // 검증된 경기 기록의 식별자
                  matchId: analysis.matchId,
                  // 규정 적용 대상 대회
                  competition: analysis.competition,
                  // 규정 적용 대상 시즌
                  season: analysis.season,
                  // 국제 축구 규정 판본 식별자
                  ifabVersionId: `ifab-${analysis.ifabEdition}`,
                  // 규정 문맥의 검증 상태
                  verificationStatus: "VERIFIED"
              }
            : null;
    // 보존된 모델 출처가 현재 승인된 고정 가중치와 일치하는지 확인
    const currentPins = !!automatic?.modelProvenance && pinnedModels(automatic.modelProvenance);
    // 현재 규정 문맥과 고정 모델 출처를 통과한 자동 평가만 조회
    const automaticViews =
        automatic && currentPins && automatic.matchContextValid
            ? automaticJudgments(
                  automatic.summary,
                  automatic.evidenceBindings,
                  analysis.evidence.map((item, evidenceIndex) => ({
                      // 제출 목록에서 증거를 찾는 순번
                      evidenceIndex,
                      // 저장된 증거 자산의 식별자
                      evidenceId: item.evidenceId,
                      // 처리 결과에서 후보 장면을 찾는 순번
                      candidateIndex: item.candidateIndex,
                      // 처리 분기 또는 자료 종류를 구별하는 값
                      kind: item.kind,
                      // 객체 저장소에서 파일을 찾는 경로
                      objectKey: item.objectKey,
                      // 파일 내용의 동일성을 대조하는 해시
                      contentSha256: item.contentSha256,
                      // 원본 영상 기준 구간 시작 밀리초
                      startMs: item.startMs,
                      // 원본 영상 기준 구간 종료 밀리초
                      endMs: item.endMs,
                      // 영상 또는 증거 이미지의 가로 크기
                      width: null,
                      // 영상 또는 증거 이미지의 세로 크기
                      height: null
                  })),
                  currentRule
              )
            : new Map<number, AutomaticJudgment>();
    // 후보의 관측과 사실 및 규정 필터 결과를 조회 형태로 구성
    const views: CandidateView[] = analysis.candidates.map((item) => {
        // 후보의 시간과 사건 및 증거 연결을 규정 필터에 대조
        const filter = pipelineFilter(
            {
                // 원본 영상 기준 구간 시작 밀리초
                startMs: item.startMs,
                // 원본 영상 기준 구간 종료 밀리초
                endMs: item.endMs,
                // 장면을 대표하는 원본 영상 시각
                anchorMs: item.anchorMs,
                // 후보 사건의 분류
                category: item.category ?? "OTHER",
                // 동일 물체의 연속 이동 관측
                tracking: item.tracking ?? null,
                // 장면에서 인식한 사건과 근거
                sceneEvent: item.sceneEvent ?? null,
                // 참조하는 저장 증거 식별자 목록
                evidenceIds: (grouped.get(item.index) ?? []).map((entry) => entry.evidenceId)
            },
            rules
        );
        // 후보 관측과 보존된 판단 및 별도 범주 평가를 구분한 조회 자료 반환
        return {
            // 완료 조건을 별도로 검사하는 자동 규정 평가 결과
            automaticJudgment: automaticViews.get(item.index) ?? null,
            // 원시 후보에 대한 규정 필터 결과
            filter,
            // 전체 반칙 판단과 별개인 영상 판독 범주 평가
            varScopeEvaluation:
                pipelineOutput && filter.status !== "EXCLUDED"
                    ? scopeVerdict(
                          {
                              // 규정 사실과 구분하여 보존하는 방송 단서
                              broadcastCue: item.broadcastCue ?? null,
                              // 원본 영상 기준 구간 시작 밀리초
                              startMs: item.startMs,
                              // 원본 영상 기준 구간 종료 밀리초
                              endMs: item.endMs,
                              // 원본에 연결한 증거 자료 또는 접근 기능
                              evidence: scopeEvidence.get(item.index) ?? [],
                              // 값의 출처 또는 원본 접근 수단
                              source
                          },
                          book
                      )
                    : null,
            // 보정과 재평가에 필요한 현재 사실 및 영상 근거
            factRevisionId: item.factRevisionId ?? null,
            // 확인된 출처와 판본을 보존하는 규정 사실 자료
            facts: (item.facts ?? null) as EvaluationFacts | null,
            // 원본 영상의 화면 구간 목록
            shots: item.shots ?? [],
            // 판정 사실과 구분하여 보존하는 원시 관측
            observation: item.observation ?? null,
            // 동일 물체의 연속 이동 관측
            tracking: item.tracking ?? null,
            // 장면에서 인식한 사건과 근거
            sceneEvent: item.sceneEvent ?? null,
            // 규정 사실과 구분하여 보존하는 방송 단서
            broadcastCue: item.broadcastCue ?? null,
            // 다른 기록과 구별하는 고유 식별자
            id: item.id,
            // 목록 안에서 해당 항목을 식별하는 순번
            index: item.index,
            // 원본 영상 기준 구간 시작 밀리초
            startMs: item.startMs,
            // 원본 영상 기준 구간 종료 밀리초
            endMs: item.endMs,
            // 장면을 대표하는 원본 영상 시각
            anchorMs: item.anchorMs,
            // 화면 변화 점수이며 접촉이나 파울 확률과 별개인 값
            signalScore: item.signalScore,
            // 관측에 필요한 화면의 충분성
            cameraSufficiency: item.cameraSufficiency,
            // 후보 생성 또는 처리 결과의 근거 사유
            reasons: item.reasons,
            // 원본에 연결한 증거 자료 또는 접근 기능
            evidence: grouped.get(item.index) ?? [],
            // 사실과 규정을 대조한 판단 결과
            judgment: judgmentView(item)
        };
    });

    // 사건 인식과 규정 검토 상태는 별개이며 근거 부족인 인식 장면도 보존
    const recognition = (candidate: CandidateView) =>
        sceneEventData(candidate.sceneEvent, candidate.startMs, candidate.endMs) ||
        broadcastCueData(candidate.broadcastCue, candidate.startMs, candidate.endMs);
    // 제외되지 않았으며 사건 종류를 인식한 후보 분리
    const recognized = views.filter(
        (candidate) => candidate.filter?.status !== "EXCLUDED" && recognition(candidate)
    );
    // 규정 필터에서 유효하지 않다고 제외한 후보 분리
    const invalid = views.filter((candidate) => candidate.filter?.status === "EXCLUDED");
    // 사건 종류를 인식하지 못한 원시 변화 후보 분리
    const raw = views.filter(
        (candidate) => candidate.filter?.status !== "EXCLUDED" && !recognition(candidate)
    );
    // 원시 후보와 잘못된 출력의 사유를 중복 없이 정렬
    const diagnosticReasons = [
        ...new Set(
            [...raw, ...invalid].flatMap((candidate) => candidate.filter?.reasonCodes ?? [])
        )
    ].sort();
    // 버전 없는 과거 분석은 기존 이력 조회를 유지하며 자동 파이프라인과 합치지 않음
    const hasBroadcast = views.some((candidate) =>
        broadcastCueData(candidate.broadcastCue, candidate.startMs, candidate.endMs)
    );
    // 자동 출력과 예전 이력에 맞춰 조회 후보를 분리
    const publicCandidates = pipelineOutput
        ? views.filter(
              (candidate) => recognized.includes(candidate) || candidate.automaticJudgment != null
          )
        : views.filter((candidate) => candidate.filter?.status !== "EXCLUDED");
    // 자동 산출물에서는 인식 사건만 판단 집계 대상으로 선택
    const judgmentViews = pipelineOutput ? recognized : views;
    // 화면에 연결한 현재 버전 판정만 완료 건수에 포함
    const evaluated = judgmentViews.filter((item) => item.judgment !== null).length;
    // 평가 대상이 존재하고 모두 판단되었는지 확인
    const allJudged = judgmentViews.length > 0 && evaluated === judgmentViews.length;
    // 전체 판단이 아닐 때 일부 판단과 미평가 구분
    const partial = evaluated > 0 ? "PARTIAL" : "NOT_EVALUATED";
    // 분석 상태와 결과 화면 모델 반환
    return {
        ...(automatic
            ? {
                  // 후보별 자동 평가 진행의 내부 집계
                  automaticReviewSummary: {
                      // 인식 처리가 실제 다룬 영상 범위
                      videoCoverage: automatic.summary.videoCoverage,
                      // 요약 일부가 잘려 보존되지 않았는지 여부
                      summaryTruncated: automatic.summary.summaryTruncated,
                      // 자동 평가 조건을 검사한 후보 수
                      checkedCount: automatic.summary.rows.length,
                      // 지원 질문의 평가를 완료한 후보 수
                      completedCount: automaticViews.size,
                      // 근거 부족 등으로 평가가 막힌 후보 수
                      blockedCount: automatic.summary.blockedCount
                  }
              }
            : {}),
        // 분석 기록의 식별자
        analysisId: analysis.analysisId,
        // 자료를 해석하거나 표시하는 방식
        mode: allJudged ? "ADJUDICATED" : "VISUAL_CHANGE_BASELINE",
        // 영상 처리 성공과 구분한 규정 판단 상태
        judgmentStatus: allJudged ? "EVALUATED" : partial,
        // 처리 상태 또는 요청 응답 상태
        status: analysis.status,
        // 현재 영상 처리 단계
        stage: analysis.stage,
        // 작업 진행률의 백분율
        progressPercent: analysis.progressPercent,
        // 처리 실패 원인을 구별하는 코드
        failureCode: analysis.failureCode,
        // 처리가 제공하지 못하는 관측의 한계
        limitations: analysis.limitations ?? [],
        // 경기 문맥에 맞춰 연결한 규정 자료
        rule:
            analysis.competition &&
            analysis.season &&
            analysis.ifabEdition &&
            analysis.verificationStatus
                ? {
                      // 규정 적용 대상 대회
                      competition: analysis.competition,
                      // 규정 적용 대상 시즌
                      season: analysis.season,
                      // 국제 축구 규정의 판본
                      ifabEdition: analysis.ifabEdition,
                      // 규정 문맥의 검증 상태
                      verificationStatus: analysis.verificationStatus,
                      // 원본 영상의 출처 주소
                      sourceUrl: analysis.sourceDocument
                  }
                : null,
        // 완료된 반칙 규정 평가 수
        evaluatedCount: evaluated,
        // 전체 내부 후보의 필터 처리 집계
        filterSummary: {
            // 자동 평가 조건을 검사한 후보 수
            checkedCount: views.length,
            // 필터가 제외한 후보 수
            excludedCount: invalid.length,
            // 필터가 판단을 확정하지 못한 후보 수
            undeterminedCount: views.filter(
                (candidate) => candidate.filter?.status === "UNDETERMINED"
            ).length,
            // 관측된 사건 후보 수
            observedCount: views.filter(
                (candidate) => candidate.filter?.status === "OBSERVED"
            ).length,
            // 규정 적용 가능 조건을 충족한 후보 수
            applicableCount: views.filter(
                (candidate) => candidate.filter?.status === "APPLICABLE"
            ).length
        },
        ...(pipelineOutput
            ? {
                  // 최종 결과와 분리한 내부 진단 자료
                  diagnostics: {
                      // 사건으로 인식되지 않은 원시 변화 후보 수
                      rawProposalCount: raw.length,
                      // 유효성 조건을 통과하지 못한 산출물 수
                      invalidOutputCount: invalid.length,
                      // 사건 종류를 인식한 후보 수
                      recognizedEventCount: recognized.length,
                      // 현재 인식기가 지원하는 사건 유형 목록
                      supportedEventTypes: hasBroadcast
                          ? (["CORNER_KICK", "GOAL_GRAPHIC"] as const)
                          : (["CORNER_KICK"] as const),
                      // 후보 생성 또는 처리 결과의 근거 사유
                      reasons: [
                          hasBroadcast ? "BROADCAST_AND_CORNER_DETECTORS" : "CORNER_ONLY_DETECTOR",
                          ...(raw.length > 0 ? ["UNRECOGNIZED_PROPOSALS"] : []),
                          ...diagnosticReasons
                      ]
                  }
              }
            : {}),
        // 파울 확정과 별개로 관리하는 후보 장면 목록
        candidates: publicCandidates
    };
};

// 한 스냅숏의 영상 원자료를 공개 정책 적용 전의 내부 화면 모델로 구성
export const mediaView = (snapshot: MediaSnapshot): MediaView => ({
    // 업로드된 원본 영상 기록의 식별자
    videoAssetId: snapshot.videoAssetId,
    // 영상 파일의 검증 상태
    videoStatus: snapshot.videoStatus,
    // 영상 유효성 검사 실패 사유
    validationErrorCode: snapshot.validationErrorCode,
    // 원본 영상과 연결된 분석 상태 및 결과 자료
    analysis: snapshot.analysis ? analysisView(snapshot.analysis, snapshot.sourceSha256) : null
});
