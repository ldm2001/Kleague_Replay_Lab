import { createHash } from "node:crypto";
import type { Hasher } from "@replay/application";

export class NodeSha256Hasher implements Hasher {
  public async sha256(value: string): Promise<Uint8Array> {
    return Uint8Array.from(createHash("sha256").update(value, "utf8").digest());
  }
}

export const hash = (): Hasher => new NodeSha256Hasher();
export const createNodeSha256Hasher = hash;
