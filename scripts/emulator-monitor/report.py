#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""区间报告：按『页面区间』聚合 CSV，用线性回归斜率判定『资源持续上升』的嫌疑功能。

用法：
  python3 report.py [--csv <文件>] [--min-samples 10] [--plot]
  --plot 需要 matplotlib（缺失时自动尝试 user 安装）。
输出：终端嫌疑报告；--plot 时生成 <csv同目录>/trend_<会话>.png（页面区间着色）。
"""
import argparse
import csv
import glob
import json
import os
import statistics
import sys

SNAPSHOT_DIR = os.path.expanduser("~/.movie-app-monitor")

WATCH = ["pss_mb", "heap_alloc_mb", "native_heap_mb", "rss_mb", "cpu_pct"]


def percentile(data, p):
    if not data:
        return 0.0
    s = sorted(data)
    k = (len(s) - 1) * p / 100.0
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def slope(xs, ys):
    n = len(xs)
    if n < 3:
        return 0.0, 0.0
    mx = sum(xs) / n
    my = sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    if sxx == 0:
        return 0.0, 0.0
    b = sxy / sxx
    # 拟合决定系数 r^2
    ss_res = sum((y - (my + b * (x - mx))) ** 2 for x, y in zip(xs, ys))
    ss_tot = sum((y - my) ** 2 for y in ys)
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    return b, r2


def pick_csv(arg):
    if arg:
        return os.path.expanduser(arg)
    files = sorted(glob.glob(os.path.join(SNAPSHOT_DIR, "monitor_*.csv")))
    if not files:
        sys.exit(f"没有找到采样 CSV（{SNAPSHOT_DIR}），请先运行 monitor.py")
    return files[-1]


def load(path):
    rows = []
    with open(path, newline="") as f:
        r = csv.DictReader(f)
        for row in r:
            if row.get("pid"):
                rows.append(row)
    return rows


def build_sessions(rows):
    sessions = []
    cur_page = None
    for row in rows:
        page = row.get("page") or "(none)"
        if page != cur_page:
            sessions.append({"page": page, "rows": [], "start": row.get("ts", ""), "end": ""})
            cur_page = page
        sessions[-1]["rows"].append(row)
        sessions[-1]["end"] = row.get("ts", "")
    return sessions


def num(row, k):
    try:
        return float(row.get(k) or 0)
    except Exception:
        return 0.0


def analyze(sessions, min_samples):
    out = []
    for s in sessions:
        rows = s["rows"]
        if len(rows) < min_samples:
            continue
        n = len(rows)
        idx = list(range(n))
        seg = {
            "page": s["page"], "n": n, "rows": rows,
            "start": s["start"], "end": s["end"],
            "cpu": {"mean": statistics.mean(num(r, "cpu_pct") for r in rows),
                    "max": max(num(r, "cpu_pct") for r in rows),
                    "p90": percentile([num(r, "cpu_pct") for r in rows], 90)},
            "fps": {"mean": statistics.mean(num(r, "fps") for r in rows)},
            "growth": {},
        }
        for k in WATCH:
            ys = [num(r, k) for r in rows]
            if not any(ys):
                continue
            # 慢采样字段（PSS/堆等）首个样本前为 0，用首个非零值作基准，避免 0 拉低"起"
            first = next((y for y in ys if y > 0), 0.0)
            b, r2 = slope(idx, ys)
            seg["growth"][k] = {
                "slope": b,
                "first": first, "last": ys[-1], "delta": ys[-1] - first,
                "mean": statistics.mean([y for y in ys if y > 0] or [0]), "max": max(ys), "r2": r2,
            }
        out.append(seg)
    return out


def fmt_num(v, nd=1, suf=""):
    return f"{v:.{nd}f}{suf}"


def print_report(segs, min_rise):
    print("=" * 78)
    print("  页面区间资源诊断（持续上升 = 每采样点斜率 > 0 且 delta 显著）")
    print("=" * 78)
    header = f"{'页面':<14}{'样本':>5}  {'CPU均值/峰':>12}  {'RSS起/末':>14}  {'PSS起/末':>14}  {'堆起/末':>14}"
    print(header)
    print("-" * 78)
    for seg in segs:
        g = seg["growth"]
        rss = g.get("rss_mb", {})
        pss = g.get("pss_mb", {})
        heap = g.get("heap_alloc_mb", {})
        cpu = seg["cpu"]
        page = (seg["page"] or "?")[:14]
        print(f"{page:<14}{seg['n']:>5}  {fmt_num(cpu['mean'])+'/'+fmt_num(cpu['max']):>12}  "
              f"{fmt_num(rss.get('first'))+'/'+fmt_num(rss.get('last')):>14}  "
              f"{fmt_num(pss.get('first'))+'/'+fmt_num(pss.get('last')):>14}  "
              f"{fmt_num(heap.get('first'))+'/'+fmt_num(heap.get('last')):>14}")
    print("-" * 78)

    print("\n【持续上升嫌疑 TOP】（斜率 > 0 且 r²≥0.3，按每采样点增量排序）")
    suspects = []
    for seg in segs:
        for k, g in seg["growth"].items():
            if g["slope"] > 0 and g["r2"] >= 0.3 and abs(g["delta"]) >= min_rise:
                suspects.append((seg["page"], k, g))
    suspects.sort(key=lambda x: x[2]["slope"], reverse=True)
    if not suspects:
        print("  未发现显著的持续上升指标（阈值：斜率>0、r²≥0.3、绝对增量≥{}）。".format(min_rise))
    for page, k, g in suspects[:12]:
        r = g["r2"]
        print(f"  {page:<16} {k:<16} +{g['delta']:>8.1f}  斜率{g['slope']:>8.3f}/样品  r²={r:.2f}")


def plot(segs, path, rows_all):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import matplotlib.dates as mdates
    except ImportError:
        venv = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".venv", "bin", "python")
        print("\n[提示] 未安装 matplotlib，跳过画图。")
        print(f"       已准备虚拟环境（若存在），请改用: {venv} report.py --plot")
        print("       或安装: uv pip install --python \"$(which python3)\" matplotlib")
        return
    from datetime import datetime

    ts = [r["ts"] for r in rows_all]
    xs = [datetime.fromisoformat(t) for t in ts]
    cpu = [num(r, "cpu_pct") for r in rows_all]
    pss = [num(r, "pss_mb") for r in rows_all]
    rss = [num(r, "rss_mb") for r in rows_all]
    heap = [num(r, "heap_alloc_mb") for r in rows_all]

    fig, axes = plt.subplots(3, 1, figsize=(13, 10), sharex=True)
    colors = {}
    palette = ["#c0392b", "#2980b9", "#27ae60", "#f39c12", "#8e44ad", "#16a085", "#d35400", "#2c3e50"]
    i = 0
    for seg in segs:
        if seg["page"] not in colors:
            colors[seg["page"]] = palette[i % len(palette)]
            i += 1
    for seg in segs:
        r0 = seg["rows"]
        if not r0:
            continue
        a = datetime.fromisoformat(r0[0]["ts"])
        b = datetime.fromisoformat(r0[-1]["ts"])
        color = colors[seg["page"]]
        for ax in axes:
            ax.axvspan(a, b, color=color, alpha=0.12)
        axes[1].text(a, 0, seg["page"], color=color, fontsize=7, va="bottom")
    axes[0].plot(xs, cpu, color="#c0392b", lw=1)
    axes[0].set_ylabel("CPU %")
    axes[0].set_ylim(bottom=0)
    axes[1].plot(xs, pss, color="#2980b9", lw=1, label="PSS")
    axes[1].plot(xs, heap, color="#16a085", lw=1, label="Heap Alloc")
    axes[1].set_ylabel("MB")
    axes[1].legend(loc="upper right")
    axes[2].plot(xs, rss, color="#27ae60", lw=1)
    axes[2].set_ylabel("RSS MB")
    axes[2].set_ylim(bottom=0)
    axes[2].xaxis.set_major_formatter(mdates.DateFormatter("%H:%M:%S"))
    fig.autofmt_xdate()
    fig.suptitle(f"趋势图（页面区间着色）：{os.path.basename(path).replace('_', ' ')}")
    fig.tight_layout()
    png = os.path.splitext(path)[0] + "_trend.png"
    fig.savefig(png, dpi=110)
    print(f"\n趋势图已生成: {png}")


def main():
    ap = argparse.ArgumentParser(description="页面区间资源诊断")
    ap.add_argument("--csv", default="")
    ap.add_argument("--min-samples", type=int, default=10)
    ap.add_argument("--min-rise", type=float, default=5.0, help="持续上升判定最小绝对增量(MB/样) 或 CPU 点")
    ap.add_argument("--plot", action="store_true")
    args = ap.parse_args()

    path = pick_csv(args.csv)
    rows = load(path)
    if len(rows) < 3:
        sys.exit(f"样本过少({len(rows)})，先跑一段时间 monitor.py 再出报告。")
    sessions = build_sessions(rows)
    segs = analyze(sessions, args.min_samples)
    print(f"会话文件: {path}\n总采样: {len(rows)}  页面区间: {len(segs)}")
    print_report(segs, args.min_rise)
    if args.plot:
        plot(segs, path, rows)


if __name__ == "__main__":
    main()