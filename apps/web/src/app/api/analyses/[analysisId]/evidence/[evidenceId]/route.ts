// 증거 요청 경로 연결
import { evidence } from "../../../../../../apis/evidence";
// 증거 의존성 조립
import { mediaEvidence } from "../../../../../../bootstrap/evidence";

// 저장소와 암호 기능을 사용할 서버 실행 환경 지정
export const runtime = "nodejs";

// 증거 조회 요청
export async function GET(
    request: Request,
    context: { params: Promise<{ analysisId: string; evidenceId: string }> },
): Promise<Response> {
    // 분석과 증거 식별자 해석
    const params = await context.params;
    // 증거 요청 경로 호출
    return evidence(request, params, mediaEvidence());
}
