import { progress } from "../../../../../../apis/job";
import { jobs } from "../../../../../../bootstrap/jobs";

export const runtime = "nodejs";

// 작업 진행 API 진입점
export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  return progress(request, await context.params, jobs());
}
