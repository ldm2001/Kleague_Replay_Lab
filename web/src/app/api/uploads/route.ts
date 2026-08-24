import { container } from "../../../bootstrap/container";
import { uploadApi } from "../../../api/upload-routes";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return uploadApi(request, container());
}
