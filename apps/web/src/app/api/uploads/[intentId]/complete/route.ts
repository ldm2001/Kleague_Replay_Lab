import { container } from "../../../../../bootstrap/container";
import { completeApi } from "../../../../../api/upload-routes";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ intentId: string }> },
): Promise<Response> {
  return completeApi(request, await context.params, container());
}
