import { evidence } from "../../../../../../apis/evidence";
import { mediaEvidence } from "../../../../../../bootstrap/evidence";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ analysisId: string; evidenceId: string }> },
): Promise<Response> {
  return evidence(request, await context.params, mediaEvidence());
}
