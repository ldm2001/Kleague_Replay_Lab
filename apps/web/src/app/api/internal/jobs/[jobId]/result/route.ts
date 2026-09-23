// 작업 결과 요청 경로 연결
import { result } from "../../../../../../apis/job";
// 작업 의존성 조립
import { jobs } from "../../../../../../bootstrap/jobs";

// 저장소와 암호 기능을 사용할 서버 실행 환경 지정
export const runtime = "nodejs";

// 작업 결과 요청
export async function POST(
    request: Request,
    context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
    // 작업 식별자 해석
    const params = await context.params;
    // 작업 결과 요청 경로 호출
    return result(request, params, jobs());
}
