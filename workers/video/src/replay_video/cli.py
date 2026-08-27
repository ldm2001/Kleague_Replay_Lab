from __future__ import annotations

import argparse
import json
from pathlib import Path

from .pipeline import run


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the Replay Lab video baseline pipeline")
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = run(args.source, args.output)
    print(json.dumps({"report": str(result.report_path), "candidates": len(result.candidates), "evidence": len(result.evidence)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
