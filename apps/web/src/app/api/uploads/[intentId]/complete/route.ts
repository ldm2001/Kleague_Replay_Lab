import { container } from "../../../../../bootstrap/container";
import { completion } from "../../../../../apis/upload";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ intentId: string }> },
): Promise<Response> {
  return completion(request, await context.params, container());
}
