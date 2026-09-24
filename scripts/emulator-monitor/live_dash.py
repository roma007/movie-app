#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""终端实时看板：每 2s 读取 ~/.movie-app-monitor/latest.json 并刷新显示。

用法：python3 live_dash.py [--port-interval-sec 2]
"""
import argparse
import json
import os
import sys
import time

SNAPSHOT_DIR = os.path.expanduser("~/.movie-app-monitor")
LATEST = os.path.join(SNAPSHOT_DIR, "latest.json")


def clear():
    sys.stdout.write("\x1b[H\x1b[2J")
    sys.stdout.flush()


def fmt(v, unit="", nd=0):
    try:
        return f"{float(v):.{nd}f}{unit}"
    except Exception:
        return f"-{unit}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--interval", type=float, default=2.0)
    args = ap.parse_args()
    while True:
        try:
            with open(LATEST) as f:
                d = json.load(f)
        except Exception:
            d = {}
        clear()
        alive = d.get("app_alive")
        ts = d.get("ts", "")
        page = d.get("page", "")
        print("=" * 46)
        print(f"  emulator-monitor   更新: {ts}")
        print(f"  页面: {page:<30} pid: {d.get('pid') or '-'}")
        print("=" * 46)
        print(f"  CPU        {fmt(d.get('cpu_pct'), '%', 1):>8}    FPS      {fmt(d.get('fps'), '', 1):>7}")
        print(f"  RSS        {fmt(d.get('rss_mb'), 'MB', 1):>8}    PSS      {fmt(d.get('pss_mb'), 'MB', 1):>7}")
        print(f"  Heap Alloc {fmt(d.get('heap_alloc_mb'), 'MB', 1):>8}    Native   {fmt(d.get('nheap_mb'), 'MB', 1):>7}")
        print(f"  Dalvik     {fmt(d.get('dheap_mb'), 'MB', 1):>8}    Unknown  {fmt(d.get('unknown_mb'), 'MB', 1):>7}")
        print(f"  HWM(峰值)  {fmt(d.get('hwm_mb'), 'MB', 1):>8}    Swap     {fmt(d.get('swap_mb'), 'MB', 1):>7}")
        print("-" * 46)
        print(f"  IO 读/写   {fmt(d.get('io_read_kb'), 'KB/s', 1):>6} / {fmt(d.get('io_write_kb'), 'KB/s', 1):<8}")
        print(f"  网络收/发  {fmt(d.get('net_rx_kb'), 'KB/s', 1):>6} / {fmt(d.get('net_tx_kb'), 'KB/s', 1):<8}")
        print("-" * 46)
        print(f"  App: {'运行中' if alive else '未运行/等待'}")
        sys.stdout.flush()
        time.sleep(args.interval)


if __name__ == "__main__":
    main()