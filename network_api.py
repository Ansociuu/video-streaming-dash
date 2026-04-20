#!/usr/bin/env python3
"""
network_api.py — Minimal HTTP API server for real network throttling.
Listens on http://localhost:8888 and runs 'tc qdisc' commands.

POST /api/network
  Body: {"scenario": "ideal"|"latency"|"loss"|"extreme"|"bandwidth:<kbps>"}
  Returns: {"ok": true, "scenario": "...", "msg": "..."}

GET /api/network/status
  Returns: {"ok": true, "tc_output": "..."}
"""

import json
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

INTERFACE = "lo"


def run_tc(*args):
    """Run a tc command, return (returncode, stdout+stderr)."""
    cmd = ["sudo", "/sbin/tc"] + list(args)
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.returncode, result.stdout + result.stderr


def clear_rules():
    run_tc("qdisc", "del", "dev", INTERFACE, "root")


def apply_ideal():
    clear_rules()
    return "Ideal network — all rules cleared."


def apply_latency():
    clear_rules()
    rc, out = run_tc("qdisc", "add", "dev", INTERFACE, "root", "netem",
                     "delay", "200ms", "20ms")
    return f"200ms latency applied. tc: {out.strip()}" if rc == 0 else f"Error: {out.strip()}"


def apply_loss():
    clear_rules()
    rc, out = run_tc("qdisc", "add", "dev", INTERFACE, "root", "netem",
                     "loss", "3%")
    return f"3% packet loss applied. tc: {out.strip()}" if rc == 0 else f"Error: {out.strip()}"


def apply_extreme():
    clear_rules()
    rc, out = run_tc("qdisc", "add", "dev", INTERFACE, "root", "netem",
                     "delay", "150ms", "10ms", "loss", "2%")
    return f"150ms + 2% loss applied. tc: {out.strip()}" if rc == 0 else f"Error: {out.strip()}"


def apply_bandwidth(kbps: int):
    """
    Throttle bandwidth using TBF (Token Bucket Filter).
    Burst is set to 32KB (reasonable for bursting).
    """
    clear_rules()
    rate_kbit = f"{kbps}kbit"
    # TBF: rate=target bandwidth, burst=burst buffer size, latency=max packet wait
    rc, out = run_tc("qdisc", "add", "dev", INTERFACE, "root", "tbf",
                     "rate", rate_kbit,
                     "burst", "32kbit",
                     "latency", "400ms")
    return f"Bandwidth capped to {kbps} kbps. tc: {out.strip()}" if rc == 0 else f"Error: {out.strip()}"


SCENARIO_MAP = {
    "ideal":   apply_ideal,
    "latency": apply_latency,
    "loss":    apply_loss,
    "extreme": apply_extreme,
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Suppress default access log; print clean messages
        print(f"[network_api] {self.address_string()} {format % args}")

    def _send_json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/network/status":
            _, out = run_tc("qdisc", "show", "dev", INTERFACE)
            self._send_json(200, {"ok": True, "tc_output": out.strip()})
        else:
            self._send_json(404, {"ok": False, "error": "Not found"})

    def do_POST(self):
        if self.path != "/api/network":
            self._send_json(404, {"ok": False, "error": "Not found"})
            return

        length = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(length) if length else b"{}")
        except json.JSONDecodeError:
            self._send_json(400, {"ok": False, "error": "Invalid JSON"})
            return

        scenario = body.get("scenario", "").strip()
        if not scenario:
            self._send_json(400, {"ok": False, "error": "Missing 'scenario' field"})
            return

        # Handle bandwidth:<kbps> scenarios
        if scenario.startswith("bandwidth:"):
            try:
                kbps = int(scenario.split(":")[1])
                msg = apply_bandwidth(kbps)
                self._send_json(200, {"ok": True, "scenario": scenario, "msg": msg})
            except (IndexError, ValueError):
                self._send_json(400, {"ok": False, "error": "Invalid bandwidth value"})
        elif scenario in SCENARIO_MAP:
            msg = SCENARIO_MAP[scenario]()
            self._send_json(200, {"ok": True, "scenario": scenario, "msg": msg})
        else:
            self._send_json(400, {"ok": False, "error": f"Unknown scenario: {scenario}"})


if __name__ == "__main__":
    port = 8888
    server = HTTPServer(("127.0.0.1", port), Handler)
    print(f"[network_api] Listening on http://127.0.0.1:{port}")
    print(f"[network_api] Interface: {INTERFACE}")
    print("[network_api] Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[network_api] Stopped.")
        sys.exit(0)
