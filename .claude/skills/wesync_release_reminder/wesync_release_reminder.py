#!/usr/bin/env python3
"""wesync 发版版本号同步提醒工具。

读取 skills/wesync_release_reminder/version.txt 里的元数据版本号，
打印应同步写入的各个位置（utils/config.js 的 APP_VERSION、云数据库 app_config）。
可 `--bump` 自增版本号（次版本号 +1）。

前置：安装 uv（或直接 python3 运行）。
"""
from __future__ import annotations

import argparse, re, sys
from pathlib import Path

VERSION_FILE = Path(__file__).resolve().parent / "version.txt"


def read_version() -> str:
    if not VERSION_FILE.exists():
        return "1.0.0"
    return VERSION_FILE.read_text(encoding="utf-8").strip() or "1.0.0"


def write_version(v: str) -> None:
    VERSION_FILE.write_text(v.strip() + "\n", encoding="utf-8")


def bump(v: str) -> str:
    m = re.match(r"^(\d+)\.(\d+)\.(\d+)$", v)
    if not m:
        return v
    major, minor, patch = map(int, m.groups())
    # 次版本号 +1（发版习惯：feature 用 minor；也支持显式 patch）
    return f"{major}.{minor + 1}.0"


def main() -> int:
    ap = argparse.ArgumentParser(description="wesync 发版版本号同步提醒")
    ap.add_argument("--bump", action="store_true", help="自增版本号（次版本 +1）并写回 version.txt")
    ap.add_argument("--set", metavar="VER", help="显式设置版本号为 VER")
    args = ap.parse_args()

    cur = read_version()
    if args.set:
        new = args.set.strip()
    elif args.bump:
        new = bump(cur)
    else:
        new = cur

    if new != cur:
        write_version(new)
        version_changed = True
    else:
        version_changed = False

    print("wesync 发版版本号同步提醒")
    print("=" * 40)
    print(f"当前记录版本号 : {new}")
    if version_changed:
        print(f"  (自: {cur} {'→' if cur != new else ''} {new})")
    print()
    print("请同步到以下位置（两端必须一致，否则横幅不生效）：")
    print("  1. utils/config.js 的 APP_VERSION        → 与上面的值一致")
    print("  2. 云数据库 app_config.latest-version 的 version → 与上面的值一致 (手动改库)")
    print("  3. 若 getLatestVersion 云函数为新函数，首次需部署")
    print()
    print("同步两处版本号后：老用户打开会看到「悄悄话：我藏了个新功能」横幅提示更新。")
    print("完整流程见 wesync 仓根目录 RELEASE_CHECKLIST.md。")
    return 0


if __name__ == "__main__":
    sys.exit(main())