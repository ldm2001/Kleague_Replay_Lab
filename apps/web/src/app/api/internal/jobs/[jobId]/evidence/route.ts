// 작업 증거 API 연결
import { evidence } from "../../../../../../apis/job";
// 작업 의존성 조립
import { jobs } from "../../../../../../bootstrap/jobs";

export const runtime = "nodejs";

// 증거 업로드 권한 요청
export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  // 작업 식별자 해석
  const params = await context.params;
  // 증거 권한 API 호출
  return evidence(request, params, jobs());
}
