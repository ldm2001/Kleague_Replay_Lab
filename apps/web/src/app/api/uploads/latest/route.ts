import { recent } from "../../../../apis/status";
import { mediaStatus } from "../../../../bootstrap/status";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return recent(request, mediaStatus());
}
