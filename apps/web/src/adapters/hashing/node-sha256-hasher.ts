import { createHash as digest } from "node:crypto";
import type { Hasher } from "@replay/application";

export class Sha256Hasher implements Hasher {
  public async sha256(value: string): Promise<Uint8Array> {
    return Uint8Array.from(digest("sha256").update(value, "utf8").digest());
  }
}

export const hash = (): Hasher => new Sha256Hasher();
