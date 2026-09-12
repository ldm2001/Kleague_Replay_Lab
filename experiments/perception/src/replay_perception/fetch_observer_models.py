from __future__ import annotations

import argparse
import json
from typing import Sequence

from .observer_assets import (
    default_observer_model_dir,
    download_observer_assets,
)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Fetch the fixed, verified referee-observation model assets."
    )
    parser.add_argument(
        "model",
        choices=("role", "pose", "all"),
        nargs="?",
        default="all",
        help="approved observer asset set to prepare (default: all)",
    )
    arguments = parser.parse_args(argv)
    selected = ("role", "pose") if arguments.model == "all" else (arguments.model,)
    result = {
        model_key: download_observer_assets(
            model_key, default_observer_model_dir(model_key)
        )
        for model_key in selected
    }
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
