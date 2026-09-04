import { facts } from "../../../../../../../apis/candidate";
import { evaluation } from "../../../../../../../bootstrap/evaluation";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ analysisId: string; candidateId: string }> },
): Promise<Response> {
  return facts(request, await context.params, evaluation());
}
