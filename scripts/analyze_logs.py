#!/usr/bin/env python3
"""
analyze_logs.py — Enhanced DASH Telemetry Extractor
Reads Caddy JSON access.log and produces:
  1. A rich console summary table
  2. A CSV export (dash_server_log_<timestamp>.csv) with all extracted fields
"""
import json
import os
import csv
import sys
from collections import defaultdict
from datetime import datetime

LOG_FILE = "/home/vboxuser/dash-content/logs/access.log"

# ─────────────────────────────────────────────
# HELPER
# ─────────────────────────────────────────────
def safe_get(d, *keys, default=None):
    """Safely traverse nested dicts."""
    for k in keys:
        if not isinstance(d, dict):
            return default
        d = d.get(k, None)
        if d is None:
            return default
    return d

def fmt(v, decimals=2):
    return f"{v:.{decimals}f}" if isinstance(v, (int, float)) else str(v)


# ─────────────────────────────────────────────
# PARSE
# ─────────────────────────────────────────────
def parse_log():
    if not os.path.exists(LOG_FILE):
        print(f"Error: Log file '{LOG_FILE}' not found.")
        sys.exit(1)

    records = []

    with open(LOG_FILE, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue

            req  = data.get("request", {})
            uri  = req.get("uri", "")

            # Only segment and manifest requests
            if not (uri.endswith(".m4s") or uri.endswith(".mpd")):
                continue

            headers = req.get("headers", {})

            # ── Core request fields ──────────────────────────────
            proto       = req.get("proto", "Unknown")
            method      = req.get("method", "-")
            host        = req.get("host", "-")
            remote_addr = data.get("request", {}).get("remote_addr", "-")
            # Caddy sometimes stores IP in different keys
            if remote_addr == "-":
                remote_addr = data.get("remote_addr", data.get("remote_ip", "-"))

            # ── Response fields ──────────────────────────────────
            status      = data.get("status", 0)
            duration    = data.get("duration", 0.0)   # seconds (float)
            size        = data.get("size", 0)          # response body bytes
            bytes_read  = data.get("bytes_read", 0)   # request body bytes

            # ── TLS fields ───────────────────────────────────────
            tls         = data.get("tls", {})
            tls_version = tls.get("version", "-") if tls else "-"
            tls_cipher  = tls.get("cipher_suite", "-") if tls else "-"
            tls_resumed = tls.get("resumed", False) if tls else False

            # ── Custom headers ───────────────────────────────────
            scenario    = headers.get("X-Network-Scenario", ["General"])[0]
            user_agent  = headers.get("User-Agent",         ["-"])[0]

            # ── Content-type from response headers ───────────────
            resp_headers   = data.get("resp_headers", {})
            ct_list        = resp_headers.get("Content-Type", []) if resp_headers else []
            content_type   = ct_list[0] if ct_list else "-"

            # ── Derived ──────────────────────────────────────────
            duration_ms    = duration * 1000.0
            throughput_mbps= (size * 8 / duration / 1_000_000) if duration > 0 else 0.0
            segment_name   = uri.split("/")[-1]

            # ── Timestamp ────────────────────────────────────────
            ts_raw = data.get("ts", "")
            try:
                from datetime import timezone
                ts_iso = datetime.fromtimestamp(float(ts_raw), tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")
            except Exception:
                ts_iso = str(ts_raw)

            record = {
                "timestamp":       ts_iso,
                "uri":             uri,
                "segment":         segment_name,
                "method":          method,
                "host":            host,
                "remote_addr":     remote_addr,
                "protocol":        proto,
                "status":          status,
                "scenario":        scenario,
                # Timing
                "duration_ms":     round(float(duration_ms), 3),
                # Throughput
                "throughput_mbps": round(float(throughput_mbps), 4),
                # Size
                "resp_size_bytes": size,
                "req_bytes_read":  bytes_read,
                # TLS
                "tls_version":     tls_version,
                "tls_cipher":      tls_cipher,
                "tls_resumed":     tls_resumed,
                # Content / User agent
                "content_type":    content_type,
                "user_agent":      user_agent,
            }
            records.append(record)

    return records


# ─────────────────────────────────────────────
# SUMMARY TABLE
# ─────────────────────────────────────────────
def print_summary(records):
    # Group by scenario + protocol
    stats = defaultdict(lambda: defaultdict(lambda: {
        "durations": [], "sizes": [], "status_2xx": 0, "status_err": 0,
        "tls_resumed": 0, "tls_total": 0
    }))

    for r in records:
        g = stats[r["scenario"]][r["protocol"]]
        if r["duration_ms"] > 0:
            g["durations"].append(r["duration_ms"])
            g["sizes"].append(r["resp_size_bytes"])
        if 200 <= r["status"] < 300:
            g["status_2xx"] += 1
        elif r["status"] >= 400:
            g["status_err"] += 1
        if r["tls_version"] != "-":
            g["tls_total"] += 1
            if r["tls_resumed"]:
                g["tls_resumed"] += 1

    W = 112
    print("\n" + "=" * W)
    print(f"{'SCENARIO':<22} | {'PROTO':<10} | {'REQS':>5} | {'AVG LAT':>9} | "
          f"{'P95 LAT':>9} | {'AVG SPDUP':>10} | {'AVG SIZE':>10} | {'ERR':>4} | {'TLS RESUM':>9}")
    print("-" * W)

    for scenario in sorted(stats):
        for proto in sorted(stats[scenario]):
            g = stats[scenario][proto]
            durs = sorted(g["durations"])
            count = len(durs)
            if count == 0:
                continue
            avg_lat  = sum(durs) / count
            p95_lat  = durs[int(count * 0.95)] if count >= 20 else durs[-1]
            total_b  = sum(g["sizes"])
            total_s  = sum(g["durations"]) / 1000.0
            avg_spd  = (total_b * 8 / total_s / 1_000_000) if total_s > 0 else 0.0
            avg_sz   = (total_b / count / 1024)             # KB
            err_pct  = (g["status_err"] / count * 100) if count > 0 else 0.0
            tls_res  = (g["tls_resumed"] / g["tls_total"] * 100) if g["tls_total"] > 0 else 0.0

            print(f"{scenario[:22]:<22} | {proto:<10} | {count:>5} | "
                  f"{avg_lat:>7.1f}ms | {p95_lat:>7.1f}ms | "
                  f"{avg_spd:>8.2f}Mbps | {avg_sz:>8.1f}KB | "
                  f"{err_pct:>3.0f}% | {tls_res:>7.0f}%")
        print("-" * W)

    print("=" * W + "\n")


# ─────────────────────────────────────────────
# CSV EXPORT
# ─────────────────────────────────────────────
CSV_FIELDS = [
    "timestamp", "uri", "segment", "method", "host", "remote_addr",
    "protocol", "status", "scenario",
    "duration_ms", "throughput_mbps",
    "resp_size_bytes", "req_bytes_read",
    "tls_version", "tls_cipher", "tls_resumed",
    "content_type", "user_agent",
]

def export_csv(records):
    from datetime import timezone
    ts = datetime.now(tz=timezone.utc).strftime("%Y%m%d_%H%M%S")
    out = f"/home/vboxuser/dash-content/dash_server_log_{ts}.csv"
    with open(out, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        for r in records:
            writer.writerow({k: r.get(k, "") for k in CSV_FIELDS})
    return out


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
def analyze():
    records = parse_log()

    if not records:
        print("No valid DASH segment logs found. Try playing some video first.")
        return

    print(f"\nParsed {len(records)} DASH segment requests from {LOG_FILE}")
    print_summary(records)

    out = export_csv(records)
    print(f"CSV exported → {out}\n")


if __name__ == "__main__":
    analyze()
