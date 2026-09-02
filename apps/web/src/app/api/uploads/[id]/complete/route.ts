import { completion } from "../../../../../apis/upload";
import { container } from "../../../../../bootstrap/container";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return completion(request, { intentId: id }, container());
}
