from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Sequence

from .model_assets import default_model_dir, download_model


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Fetch the fixed, verified RT-DETR-R18 experiment assets."
    )
    parser.add_argument(
        "target_dir",
        nargs="?",
        type=Path,
        default=default_model_dir(),
    )
    arguments = parser.parse_args(argv)
    metadata = download_model(arguments.target_dir)
    print(json.dumps(metadata, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
