from __future__ import annotations

import hashlib
import json
import subprocess
from datetime import datetime
from pathlib import Path


def digest(path: Path) -> dict[str, str | int]:
    return {
        "bytes": path.stat().st_size,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def main() -> None:
    evidence = Path(__file__).resolve().parent
    root = evidence.parent.parent
    before = json.loads((evidence / "source_snapshot_before.json").read_text(encoding="utf-8"))
    current = {}
    for folder in ("脚本", "中间数据", "成品"):
        for path in (root / folder).rglob("*"):
            if path.is_file() and "__pycache__" not in path.parts:
                current[path.relative_to(root).as_posix()] = digest(path)
    baseline = before["protectedFiles"]
    changed = [name for name in baseline.keys() & current.keys() if baseline[name] != current[name]]
    added = sorted(current.keys() - baseline.keys())
    removed = sorted(baseline.keys() - current.keys())
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    status = subprocess.check_output(
        ["git", "-c", "core.quotepath=false", "status", "--porcelain=v1", "-z"], cwd=root
    ).decode("utf-8")
    result = {
        "checkedAt": datetime.now().astimezone().isoformat(),
        "status": "PASS" if not (changed or added or removed) and head == before["head"] else "FAIL",
        "protectedDirectories": ["脚本", "中间数据", "成品"],
        "protectedFileCount": len(baseline),
        "currentFileCount": len(current),
        "changed": sorted(changed),
        "added": added,
        "removed": removed,
        "headBefore": before["head"],
        "headAfter": head,
        "statusBeforePorcelainZ": before["statusPorcelainZ"],
        "statusAfterPorcelainZ": status,
        "note": "This compares production scripts, data, and all current/archived products. The new investigation record and evidence are outside the protected directories; pre-existing dirty changes are not reverted.",
    }
    output = evidence / "protected_files_after.json"
    with output.open("x", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2)
    print(json.dumps({key: value for key, value in result.items() if "Porcelain" not in key}, ensure_ascii=False, indent=2))
    if result["status"] != "PASS":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
