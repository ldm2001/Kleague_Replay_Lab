import { execFileSync } from "node:child_process";
import { delimiter, resolve } from "node:path";
import { python } from "../../../../scripts/python.mjs";
import type { InteractionObservationV1 } from "../../src/shared/interaction";

// 프레임만 공유하고 실제 파이썬 생산자로 측정값 생성
export function interactionFixture(source = "a".repeat(64), endMs = 100): InteractionObservationV1 {
    return JSON.parse(execFileSync(python(), ["-c", `
import json
import sys
from fixtures.interaction import frame
from replay_video.domain.interactions import InteractionObservations
engine = InteractionObservations(sys.argv[1])
engine.update({**frame(int(sys.argv[2])-100), 'sourceSha256':sys.argv[1]}, 's1')
row = engine.update({**frame(int(sys.argv[2])), 'sourceSha256':sys.argv[1]}, 's1')[0]
row['upstream'] = {'artifactSha256':'b'*64,'lineNumber':2,'rowSha256':'c'*64}
print(json.dumps(row))
`, source, String(endMs)], { env: { ...process.env, PYTHONPATH: ["apps/video-worker/src", "apps/video-worker/tests"]
        .map((path) => resolve(path)).join(delimiter) }, encoding: "utf8" }));
}
