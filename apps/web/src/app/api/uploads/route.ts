import { container } from "../../../bootstrap/container";
import { upload } from "../../../api/upload-routes";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return upload(request, container());
}
