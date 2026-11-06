"""Bounded Linux command benchmark. RSS sums include shared pages; no env dump."""
import argparse
import json
import os
from pathlib import Path
import resource
import signal
import subprocess
import time


def processes():
    """Scan PPIDs, not leader-thread children (libuv spawns on other threads)."""
    result = {}
    for entry in Path("/proc").iterdir():
        if not entry.name.isdecimal():
            continue
        try:
            fields = (entry / "stat").read_text().rsplit(")", 1)[1].split()
            result[int(entry.name)] = {
                "ppid": int(fields[1]),
                "ticks": int(fields[11]) + int(fields[12]),
                "start": int(fields[19]),
                "rss": int(fields[21]) * os.sysconf("SC_PAGE_SIZE"),
            }
        except (OSError, ValueError, IndexError):
            pass  # Process exited during sampling.
    return result


def descendants(table, root, known):
    selected = {pid for pid, info in table.items() if (pid, info["start"]) in known}
    selected.add(root)
    while True:
        extra = {pid for pid, info in table.items() if info["ppid"] in selected}
        expanded = selected | extra
        if expanded == selected:
            return {pid for pid in selected if pid in table}
        selected = expanded


def self_test():
    fixture = {
        1: {"ppid": 0, "start": 1},
        2: {"ppid": 1, "start": 2},
        3: {"ppid": 2, "start": 3},
        4: {"ppid": 0, "start": 4},
    }
    assert descendants(fixture, 1, set()) == {1, 2, 3}
    fixture[3]["ppid"] = 0
    assert descendants(fixture, 1, {(3, 3)}) == {1, 2, 3}
    assert descendants(fixture, 1, {(4, 99)}) == {1, 2}  # PID reused.
    assert os.getpid() in processes()
    print("PASS: PPID ancestry, reparented descendants, PID reuse, /proc scan")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--timeout", type=float, default=900)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command or args.out is None or args.timeout <= 0:
        parser.error("use --out PATH --timeout SECONDS -- COMMAND ...")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    log_path = Path(str(args.out) + ".log")
    metrics_path = Path(str(args.out) + ".json")
    if metrics_path.exists():
        raise FileExistsError(metrics_path)
    before = resource.getrusage(resource.RUSAGE_CHILDREN)
    known = {}
    peak_rss = peak_processes = samples = 0
    started = time.perf_counter()
    timed_out = False
    with log_path.open("x") as log:
        process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT,
                                   start_new_session=True)
        try:
            while True:
                table = processes()
                selected = descendants(table, process.pid, known)
                for pid in selected:
                    info = table[pid]
                    key = (pid, info["start"])
                    known[key] = max(known.get(key, 0), info["ticks"])
                peak_rss = max(peak_rss, sum(table[pid]["rss"] for pid in selected))
                peak_processes = max(peak_processes, len(selected))
                samples += 1
                if process.poll() is not None:
                    break
                if time.perf_counter() - started > args.timeout:
                    timed_out = True
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait()
                    break
                time.sleep(0.5)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait()
    wall = time.perf_counter() - started
    after = resource.getrusage(resource.RUSAGE_CHILDREN)
    user = after.ru_utime - before.ru_utime
    system = after.ru_stime - before.ru_stime
    result = {
        "command": command,
        "exitCode": process.returncode,
        "timedOut": timed_out,
        "wallSeconds": wall,
        "reapedUserCpuSeconds": user,
        "reapedSystemCpuSeconds": system,
        "reapedCpuPercentOneCore": 100 * (user + system) / wall,
        "sampledProcessCpuSecondsLowerBound": sum(known.values()) / os.sysconf("SC_CLK_TCK"),
        "sampledPeakRssSumMiB": peak_rss / 1024**2,
        "rssCaveat": "PPID tree including reparented known children; summed RSS double-counts shared pages; 500ms samples miss transient peaks",
        "cpuCaveat": "rusage includes reaped child descendants; sampled CPU is a separate lower bound including discovered processes",
        "peakLiveProcessCount": peak_processes,
        "samples": samples,
    }
    with metrics_path.open("x") as output:
        json.dump(result, output, indent=2)
        output.write("\n")
    print(json.dumps(result))
    raise SystemExit(124 if timed_out else process.returncode)


if __name__ == "__main__":
    main()
