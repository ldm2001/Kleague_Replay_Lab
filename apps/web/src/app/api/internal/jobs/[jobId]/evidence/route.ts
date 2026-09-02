import { evidence } from "../../../../../../apis/job";
import { jobs } from "../../../../../../bootstrap/jobs";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  return evidence(request, await context.params, jobs());
}
