// 작업 진행 API 연결
import { progress } from "../../../../../../apis/job";
// 작업 의존성 조립
import { jobs } from "../../../../../../bootstrap/jobs";

export const runtime = "nodejs";

// 작업 진행 API 진입점
// 진행 상태 요청
export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  return progress(request, await context.params, jobs());
}
