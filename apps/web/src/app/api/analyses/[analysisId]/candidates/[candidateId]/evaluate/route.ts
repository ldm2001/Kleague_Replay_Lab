// 판정 요청 경로 연결
import { decision } from "../../../../../../../apis/candidate";
// 평가 의존성 조립
import { evaluation } from "../../../../../../../bootstrap/evaluation";

// 저장소와 암호 기능을 사용할 서버 실행 환경 지정
export const runtime = "nodejs";

// 판정 결과 요청
export async function POST(
    request: Request,
    context: { params: Promise<{ analysisId: string; candidateId: string }> },
): Promise<Response> {
    // 분석과 후보 식별자 해석
    const params = await context.params;
    // 판정 요청 경로 호출
    return decision(request, params, evaluation());
}
