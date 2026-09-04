import { decision } from "../../../../../../../apis/candidate";
import { evaluation } from "../../../../../../../bootstrap/evaluation";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ analysisId: string; candidateId: string }> },
): Promise<Response> {
  return decision(request, await context.params, evaluation());
}
