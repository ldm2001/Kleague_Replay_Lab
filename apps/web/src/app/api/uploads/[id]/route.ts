import { media } from "../../../../apis/status";
import { mediaStatus } from "../../../../bootstrap/status";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return media(request, { videoAssetId: id }, mediaStatus());
}
