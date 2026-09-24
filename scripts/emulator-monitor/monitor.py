#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""安卓模拟器资源占用持续监控主程序。

职责：
- 持续跟踪 com.movie.app 进程（pid 崩/起自动跟随）。
- 高频采样 CPU / RSS（/proc），低频补 PSS·堆（dumpsys meminfo）、FPS（gfxinfo framestats）、
  IO/网络增量（/proc/<pid>/io + /proc/net/dev）。
- 页面标签：优先接收 App 悬浮层 HTTP POST /page 上报的路由；无上报时用 uiautomator 文本兜底。
- 数据落盘 ~/.movie-app-monitor/（会话 CSV + run.log + latest.json）。

用法：
  python3 monitor.py [--device emulator-5554] [--port 8756] [--interval 1]
环境变量：MOVIE_MONITOR_PORT / MOVIE_MONITOR_DEVICE
"""
import argparse
import datetime as _dt
import json
import os
import re
import shlex
import statistics
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

APP_PKG = "com.movie.app"
DEFAULT_DEVICE = "emulator-5554"
DEFAULT_PORT = 8756
SNAPSHOT_DIR = os.path.expanduser("~/.movie-app-monitor")

# 采样周期（秒）
TICK = 1.0
GFX_EVERY = 5
MEMINFO_EVERY = 30
UIADUMP_EVERY = 20
ROUTE_FRESH_MAX = 15  # 超过该秒数无路由上报，才用 uiautomator 兜底
INACTIVE_TTL = 30  # 页面停止活动超过该秒数，从明细清单移除
STORAGE_EVERY = 10  # 存储占用独立定时间隔（du 开销小，不受 dumpsys 慢 tick 拖累）


def adb(device, args, timeout=15):
    cmd = ["adb", "-s", device] + args
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.stdout.strip()
    except Exception:
        return ""


def adb_shell(device, script, timeout=15):
    # 整段 shell 脚本作为一个参数，避免 adb 本地 shell 参数转义问题
    return adb(device, ["shell", script], timeout=timeout)


class CsvWriter:
    HEADER = [
        "ts", "pid", "page", "event",
        "cpu_pct",
        "rss_mb", "hwm_mb", "swap_mb",
        "pss_mb", "heap_alloc_mb", "native_heap_mb", "dalvik_heap_mb", "graphics_mb", "unknown_mb",
        "io_read_kb", "io_write_kb",
        "net_rx_kb", "net_tx_kb",
        "fps", "jank",
    ]

    def __init__(self, path):
        self.path = path
        self._fh = open(path, "a", buffering=1)
        self._fh.write(",".join(self.HEADER) + "\n")

    def write(self, row):
        self._fh.write(",".join(str(row.get(k, "")) for k in self.HEADER) + "\n")

    def close(self):
        try:
            self._fh.close()
        except Exception:
            pass


class MonitorState:
    def __init__(self, device, port, interval):
        self.device = device
        self.port = port
        self.interval = interval
        os.makedirs(SNAPSHOT_DIR, exist_ok=True)
        self.session_path = os.path.join(
            SNAPSHOT_DIR,
            "monitor_" + _dt.datetime.now().strftime("%Y%m%d_%H%M%S") + ".csv",
        )
        self.latest_path = os.path.join(SNAPSHOT_DIR, "latest.json")
        self.log_path = os.path.join(SNAPSHOT_DIR, "run.log")
        self.writer = CsvWriter(self.session_path)

        self.pid = None
        self.page = ""
        self.last_route_post = 0.0
        self.last_uiadump = 0.0
        self.last_route = ""

        # 按页面聚合（内存态，重启清零）：{page: {cpu_sum, rss_sum, n, heap_delta_kb, busy_sum, busy_window}}
        self.func_agg = {}
        self.session_start = _dt.datetime.now().isoformat(timespec="seconds")

        # 计数器缓存
        self.prev_proc = None     # utime+stime
        self.prev_total = None    # /proc/stat cpu 合计
        self.prev_io = None
        self.prev_net = None
        self.prev_memjiff = None

        # 最近一次慢采样值（复用）
        self.mem = {}
        self.gfx = {"fps": 0, "jank": 0}
        self.last_meminfo = 0.0
        self.last_gfx = 0.0

        self.latest = {
            "ts": 0, "pid": None, "page": "",
            "cpu_pct": 0, "rss_mb": 0, "fps": 0,
            "net_rx_kb": 0, "net_tx_kb": 0,
            "io_read_kb": 0, "io_write_kb": 0,
            "pss_mb": 0, "heap_alloc_mb": 0, "nheap_mb": 0, "dheap_mb": 0,
            "unknown_mb": 0, "hwm_mb": 0, "swap_mb": 0,
            "app_alive": False,
        }
        self.lock = threading.Lock()

    def log(self, msg):
        line = f"[{_dt.datetime.now().isoformat(timespec='seconds')}] {msg}"
        print(line, flush=True)
        with open(self.log_path, "a") as f:
            f.write(line + "\n")

    def get_pid(self):
        out = adb_shell(self.device, f"pidof {APP_PKG}")
        m = re.search(r"\d+", out)
        return m.group(0) if m else None

    def set_page_from_route(self, route):
        if route != self.last_route:
            self.last_route = route
            self.page = route or "(unknown)"
            self.log(f"[RoutePost] {self.page}")
        self.last_route_post = time.time()
        self.last_uiadump = time.time()  # 上报后短时间内不再外部识别

    # ---------- 采样 ----------
    def sample_fast(self):
        row = {}
        # CPU: /proc/<pid>/stat 的 utime+stime vs /proc/stat
        stat = adb_shell(self.device,
                         f"cat /proc/{self.pid}/stat 2>/dev/null; echo EOL; cat /proc/stat 2>/dev/null | head -1")
        proc_ticks = None
        if "EOL" in stat:
            p, bt = stat.split("EOL", 1)
            p = p.strip()
            bt = bt.strip()
            # 进程名可能含空格/括号，从最后一个 ) 之后开始数 field
            if ")" in p:
                after = p.rsplit(")", 1)[1].split()
                # field13 utime, field14 stime（field 从 3 起首，after[0]=field3）
                if len(after) >= 13:
                    proc_ticks = float(after[10]) + float(after[11])
            if bt.startswith("cpu "):
                total = sum(float(x) for x in bt.split()[1:])
                if self.prev_proc is not None and self.prev_total is not None:
                    dtp = proc_ticks - self.prev_proc
                    dtt = total - self.prev_total
                    # /proc/stat 的 cpu 合计为所有 guest 核 jiffies 之和；dtp/dtt*100 = 占单个核的百分比（与 top 语义一致）
                    row["cpu_pct"] = round(dtp / dtt * 100.0, 1) if dtt > 0 else 0.0
                self.prev_proc = proc_ticks
                self.prev_total = total

        # RSS / Swap / HWM
        status = adb_shell(self.device, f"grep -E 'VmRSS|VmSwap|VmHWM' /proc/{self.pid}/status 2>/dev/null")
        for line in status.splitlines():
            k, _, v = line.partition(":")
            v = v.strip().split()[0] if v.strip() else "0"
            if k == "VmRSS":
                row["rss_mb"] = round(int(v or 0) / 1024, 1)
            elif k == "VmSwap":
                row["swap_mb"] = round(int(v or 0) / 1024, 1)
            elif k == "VmHWM":
                row["hwm_mb"] = round(int(v or 0) / 1024, 1)

        # IO 增量 (KB)
        io = {}
        for line in adb_shell(self.device, f"grep -E 'read_bytes|write_bytes' /proc/{self.pid}/io 2>/dev/null").splitlines():
            k, _, v = line.partition(":")
            io[k] = int(v.strip() or 0)
        if self.prev_io is not None and io:
            row["io_read_kb"] = round(max(0, io["read_bytes"] - self.prev_io.get("read_bytes", 0)) / 1024.0, 1)
            row["io_write_kb"] = round(max(0, io["write_bytes"] - self.prev_io.get("write_bytes", 0)) / 1024.0, 1)
        if io:
            self.prev_io = io

        # 网络增量（模拟器全局非环回界面，KB）
        net = {}
        for line in adb_shell(self.device, "cat /proc/net/dev").splitlines():
            if ":" not in line or line.strip().startswith("Inter"):
                continue
            iface, rest = line.split(":", 1)
            if iface.strip() == "lo":
                continue
            t = rest.split()
            if len(t) >= 9:
                net[iface] = (int(t[0]), int(t[8]))
        if self.prev_net is not None and net:
            drx = sum(v[0] for v in net.values()) - sum(v[0] for v in self.prev_net.values())
            dtx = sum(v[1] for v in net.values()) - sum(v[1] for v in self.prev_net.values())
            row["net_rx_kb"] = round(max(0, drx) / 1024.0, 1)
            row["net_tx_kb"] = round(max(0, dtx) / 1024.0, 1)
        if net:
            self.prev_net = net
        return row

    def sample_gfx(self):
        now = time.time()
        if now - self.last_gfx < GFX_EVERY:
            return {}
        self.last_gfx = now
        out = adb_shell(self.device, f"dumpsys gfxinfo {APP_PKG} framestats 2>/dev/null", timeout=20)
        frames = []
        for line in out.splitlines():
            line = line.strip()
            if not line or not line[0].isdigit():
                continue
            toks = line.split(",")
            if len(toks) >= 14 and toks[0].isdigit():
                try:
                    frames.append(int(toks[13]))  # FRAME_COMPLETED 时间戳(ns)
                except (ValueError, IndexError):
                    pass
        self.gfx = {"fps": 0, "jank": 0}
        if len(frames) >= 4:
            frames.sort()
            intervals = [(frames[i + 1] - frames[i]) / 1e6 for i in range(len(frames) - 1)]
            intervals = [x for x in intervals if 0 < x < 1000]
            if intervals:
                med = statistics.median(intervals)
                self.gfx["fps"] = round(1000.0 / med if med > 0 else 0, 1)
                self.gfx["jank"] = sum(1 for x in intervals if x > max(med * 1.5, 34.0))
        return {}

    def sample_meminfo(self):
        now = time.time()
        if now - self.last_meminfo < MEMINFO_EVERY:
            return {}
        self.last_meminfo = now
        out = adb_shell(self.device, f"dumpsys meminfo {APP_PKG} 2>/dev/null", timeout=25)
        m = re.search(r"TOTAL\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)", out)
        row = {}
        if m:
            row["pss_mb"] = round(int(m.group(1)) / 1024.0, 1)
        for key, col in (("Native Heap", "native_heap_mb"), ("Dalvik Heap", "dalvik_heap_mb"),
                         ("Graphics", "graphics_mb"), ("Unknown", "unknown_mb")):
            mm = re.search(re.escape(key) + r"\s+:?\s+(\d+)\s+(\d+)", out)
            if mm and int(mm.group(1)) > 0:
                row[col] = round(int(mm.group(1)) / 1024.0, 1)
        tm = re.search(r"TOTAL\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)", out)
        if tm:
            # [1]=PSS [2]=PrivDirty [3]=PrivClean [4]=SwapPss [5]=Rss [6]=HeapSize [7]=HeapAlloc [8]=HeapFree
            row["heap_alloc_mb"] = round(int(tm.group(7)) / 1024.0, 1)

        # App 存储占用（安装 codeSize 不在 meminfo；用 meminfo 中已有量替代不可得，
        # 单独走 dumpsys package 的成本高，放到低频 sample_page_fallback 同周期的 sample_storage）
        return row

    def sample_storage(self):
        now = time.time()
        if now - getattr(self, "last_storage", 0) < STORAGE_EVERY:
            return
        self.last_storage = now
        try:
            # run-as du 统计 App 自身数据目录（/data/data/<pkg>）真实磁盘占用
            out = adb_shell(self.device, f"run-as {APP_PKG} du -sk .", timeout=25)
            m = re.search(r"^\s*(\d+)", out)
            if m:
                self.mem["storage_mb"] = round(int(m.group(1)) / 1024.0, 1)
        except Exception:
            pass

    def sample_page_fallback(self):
        now = time.time()
        if now - self.last_route_post <= ROUTE_FRESH_MAX:
            return
        if now - self.last_uiadump < UIADUMP_EVERY:
            return
        self.last_uiadump = now
        out = adb_shell(self.device, "uiautomator dump /data/local/tmp/ui.xml >/dev/null 2>&1; cat /data/local/tmp/ui.xml 2>/dev/null")
        texts = re.findall(r'(?:text|content-desc)="([^"]+)"', out)
        texts = [t for t in texts if t.strip()]
        if not texts:
            return
        # 兜底 dump 耗时较长，期间可能有路由上报进来；应用结果前再次校验路由新鲜度
        if time.time() - self.last_route_post <= ROUTE_FRESH_MAX:
            return
        page = match_page(" ".join(texts))
        if page:
            self.page = page
            self.log(f"[PageFallback] 文本识别页面: {page}")

    # ---------- 主循环 ----------
    def run(self):
        httpd = ThreadingHTTPServer(("127.0.0.1", self.port), lambda *a, **k: Handler(*a, mon=self, **k))
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.log(f"监控启动 snapshots={self.session_path} http=:{self.port}")
        last_event = ""
        stop_streak = 0
        tick = 0
        while True:
            pid = self.get_pid()
            if pid and pid != self.pid:
                self.pid = pid
                self.prev_proc = None
                self.prev_total = None
                self.prev_io = None
                self.prev_net = None
                self.last_meminfo = 0
                self.last_gfx = 0
                event = "app_restart" if last_event == "app_running" else "app_start"
                self.page = "(app_start)"
                self.log(f"[{event}] pid={pid}")
                with self.lock:
                    self.latest["pid"] = pid
                last_event = "app_running"
                stop_streak = 0
            elif not pid:
                stop_streak += 1
                if stop_streak == 4:  # 连续约 3s 未见进程
                    self.log("[app_stop] App 未运行/已退出，等待重启")
                    last_event = "app_stopped"
                    with self.lock:
                        self.latest["app_alive"] = False
                        self.latest["pid"] = None
                time.sleep(self.interval)
                continue

            tick += 1
            row = {"ts": _dt.datetime.now().isoformat(timespec="milliseconds"),
                   "pid": self.pid, "page": self.page, "event": ""}
            row.update(self.sample_fast())
            if tick % GFX_EVERY == 0:
                self.sample_gfx()
            if tick % MEMINFO_EVERY == 0:
                self.sample_meminfo()
            self.sample_storage()
            row.update(self.gfx)
            row.update({k: v for k, v in self.mem.items()})
            row.setdefault("cpu_pct", 0.0)
            row.setdefault("rss_mb", 0.0)
            row.setdefault("pss_mb", 0.0)
            row.setdefault("fps", 0.0)
            self.sample_page_fallback()
            row["page"] = self.page
            self.writer.write(row)

            # 每 tick 按页面聚合 CPU/RSS（明细面板数据源）
            _now = time.time()
            key = self.page or "(unknown)"
            agg = self.func_agg.setdefault(key, {"cpu_sum": 0.0, "rss_sum": 0.0, "n": 0})
            agg["cpu_sum"] += float(row.get("cpu_pct", 0) or 0)
            agg["rss_sum"] += float(row.get("rss_mb", 0) or 0)
            agg["n"] += 1
            agg["last_active"] = _now

            # 不活跃页面自动移除：停止活动 INACTIVE_TTL 秒即从清单消失（清单只反映当前活跃功能）
            for k in [k for k, a in self.func_agg.items() if _now - a.get("last_active", _now) > INACTIVE_TTL]:
                self.func_agg.pop(k, None)
                self.log(f"[Inactive] 移除不活跃页面 {k}")

            # 总主线程忙%（全页面 busy 之和，与明细清单严格对账：清单忙% 之和 = 此值）
            _busy_sum = sum(a.get("busy_sum", 0) for a in self.func_agg.values())
            _busy_win = sum(a.get("busy_window", 0) for a in self.func_agg.values())

            with self.lock:
                self.latest = {
                    "ts": row["ts"], "pid": self.pid, "page": self.page,
                    "busy_pct": round(_busy_sum / _busy_win * 100.0, 1) if _busy_win > 0 else None,
                    "cpu_pct": row.get("cpu_pct", 0),
                    "rss_mb": row.get("rss_mb", 0),
                    "fps": row.get("fps", 0),
                    "net_rx_kb": row.get("net_rx_kb", 0),
                    "net_tx_kb": row.get("net_tx_kb", 0),
                    "io_read_kb": row.get("io_read_kb", 0),
                    "io_write_kb": row.get("io_write_kb", 0),
                    "pss_mb": row.get("pss_mb", 0),
                    "storage_mb": self.mem.get("storage_mb"),
                    "heap_alloc_mb": row.get("heap_alloc_mb", 0),
                    "nheap_mb": row.get("native_heap_mb", 0),
                    "dheap_mb": row.get("dalvik_heap_mb", 0),
                    "unknown_mb": row.get("unknown_mb", 0),
                    "hwm_mb": row.get("hwm_mb", 0),
                    "swap_mb": row.get("swap_mb", 0),
                    "app_alive": True,
                }
            with open(self.latest_path, "w") as f:
                json.dump(self.latest, f)
            last_event = "app_running"
            time.sleep(self.interval)

    def shutdown(self):
        try:
            self.writer.close()
        except Exception:
            pass
        self.log("监控退出")


def match_page(text):
    """按 page_map.yaml 的文本->页面映射匹配（多组=或；组内关键词=且）。"""
    DEFAULT_MAP = [
        (("播放", "剧集", "选集"), "Play"),
        (("首页", "推荐", "我的收藏"), "Home"),
        (("搜索",), "Search"),
        (("分类", "热播", "榜"), "Category"),
        (("设置",), "Settings"),
        (("任务", "采集任务"), "TaskList"),
    ]
    map_ = DEFAULT_MAP
    mfile = os.path.join(os.path.dirname(os.path.abspath(__file__)), "page_map.yaml")
    try:
        import yaml
        data = yaml.safe_load(open(mfile, encoding="utf-8"))
        map_ = [(groups, page) for page, groups in data.items()]
    except Exception:
        pass
    for groups, page in map_:
        for group in groups:
            if all(k in text for k in group):
                return page
    return ""


class Handler(BaseHTTPRequestHandler):
    def __init__(self, *args, mon=None, **kwargs):
        self.mon = mon
        super().__init__(*args, **kwargs)

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.startswith("/monitor.json"):
            with self.mon.lock:
                body = json.dumps(self.mon.latest).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path.startswith("/funcs"):
            # 按页面聚合明细：功能级可区分量（主线程忙% + 停留秒），按忙时降序
            with self.mon.lock:
                agg_snapshot = dict(self.mon.func_agg)
            funcs = []
            total_win = sum(a.get("busy_window", 0) for a in agg_snapshot.values())
            for page, a in agg_snapshot.items():
                if a.get("n", 0) <= 0 and not a.get("busy_sum", 0):
                    continue
                funcs.append({
                    "page": page,
                    "busy_pct": round(a.get("busy_sum", 0) / total_win * 100.0, 1) if total_win > 0 else None,
                    "seconds": a["n"],
                })
            funcs.sort(key=lambda f: f["busy_pct"] or 0, reverse=True)
            body = json.dumps({"since": self.mon.session_start, "funcs": funcs}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path.startswith("/page"):
            try:
                ln = int(self.headers.get("Content-Length") or 0)
                route = self.rfile.read(ln).decode("utf-8", "ignore")
                route = (json.loads(route).get("route") or "") if route.strip().startswith("{") else route
            except Exception:
                route = ""
            self.mon.set_page_from_route(route or "(unknown)")
            self.send_response(200)
            self.end_headers()
        elif self.path.startswith("/probe"):
            # JS 侧探针：{page, busy_ms, window_ms} 主线程忙时（功能级 CPU 负载代理），按页面累加
            try:
                ln = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(ln).decode("utf-8", "ignore") or "{}")
                page = body.get("page") or "(unknown)"
                busy_ms = float(body.get("busy_ms", 0) or 0)
                window_ms = float(body.get("window_ms", 0) or 0)
                with self.mon.lock:
                    agg = self.mon.func_agg.setdefault(page, {"cpu_sum": 0.0, "rss_sum": 0.0, "n": 0})
                    agg["last_active"] = time.time()
                    if window_ms > 0:
                        agg["busy_sum"] = agg.get("busy_sum", 0) + busy_ms
                        agg["busy_window"] = agg.get("busy_window", 0) + window_ms
            except Exception:
                pass
            self.send_response(200)
            self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()


def main():
    ap = argparse.ArgumentParser(description="安卓模拟器资源监控")
    ap.add_argument("--device", default=os.environ.get("MOVIE_MONITOR_DEVICE", DEFAULT_DEVICE))
    ap.add_argument("--port", type=int, default=int(os.environ.get("MOVIE_MONITOR_PORT", DEFAULT_PORT)))
    ap.add_argument("--interval", type=float, default=TICK)
    args = ap.parse_args()
    mon = MonitorState(args.device, args.port, args.interval)
    try:
        mon.run()
    except KeyboardInterrupt:
        mon.shutdown()


if __name__ == "__main__":
    main()