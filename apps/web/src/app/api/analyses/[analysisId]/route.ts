import { analysis } from "../../../../apis/result";
import { resultView } from "../../../../bootstrap/result";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ analysisId: string }> },
): Promise<Response> {
  return analysis(request, await context.params, resultView());
}
