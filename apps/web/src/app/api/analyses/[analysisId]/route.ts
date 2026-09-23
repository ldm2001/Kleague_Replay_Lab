// 분석 결과 요청 경로 연결
// 결과 요청 경로 연결
import { analysis } from "../../../../apis/result";
// 결과 의존성 조립
import { resultView } from "../../../../bootstrap/result";

// 저장소와 암호 기능을 사용할 서버 실행 환경 지정
export const runtime = "nodejs";

// 분석 결과 요청
export async function GET(
    request: Request,
    context: { params: Promise<{ analysisId: string }> },
): Promise<Response> {
    // 분석 식별자 해석
    const params = await context.params;
    // 분석 결과 요청 경로 호출
    return analysis(request, params, resultView());
}
