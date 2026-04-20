# ⚡ DASH Video Streaming — HTTP/3 vs HTTP/2 Benchmark

> Dự án triển khai DASH (Dynamic Adaptive Streaming over HTTP) trên **Caddy Server** với hỗ trợ **HTTP/3 (QUIC)**, kèm theo bộ công cụ benchmark so sánh hiệu năng HTTP/3 vs HTTP/2.

---

## 📋 Mục Lục

- [Tổng Quan](#tổng-quan)
- [Kiến Trúc](#kiến-trúc)
- [Yêu Cầu Hệ Thống](#yêu-cầu-hệ-thống)
- [Cài Đặt & Khởi Chạy](#cài-đặt--khởi-chạy)
- [Hướng Dẫn Sử Dụng](#hướng-dẫn-sử-dụng)
- [Mô Phỏng Mạng](#mô-phỏng-mạng)
- [Phân Tích Log](#phân-tích-log)
- [Cấu Trúc Dự Án](#cấu-trúc-dự-án)
- [Kết Quả Benchmark](#kết-quả-benchmark)
- [Báo Cáo Chi Tiết](#báo-cáo-chi-tiết)

---

## Tổng Quan

Dự án bao gồm:

- **Caddy Web Server** phục vụ DASH segments qua HTTP/2 và HTTP/3 đồng thời
- **dash.js Player** với giao diện premium, hiển thị real-time telemetry (protocol, buffer, throughput, bitrate, resolution)
- **Network Simulation API** sử dụng Linux `tc netem` để mô phỏng 4 kịch bản mạng
- **Log Analysis Pipeline** parse Caddy JSON logs → CSV export với 18 trường dữ liệu

### Video Content

- **9 video representations**: 200 kbps (180p) → 5.3 Mbps (1080p)
- **1 audio track**: AAC-LC 130 kbps, 48 kHz
- **97 segments/representation**, ~2s mỗi segment
- **Tổng thời lượng**: 3 phút 14 giây

---

## Kiến Trúc

```
┌───────────────────────────────┐
│   Browser (Chrome 146+)       │
│   dash.js ABR Player          │
│   ┌─────────┐ ┌────────────┐  │
│   │ HTTP/2  │ │  HTTP/3    │  │
│   │ TCP/TLS │ │ QUIC/UDP   │  │
│   └────┬────┘ └─────┬──────┘  │
└────────┼────────────┼─────────┘
         │            │
    ┌────▼────────────▼────┐
    │  Caddy Server :8443  │
    │  TLS 1.3 (internal)  │
    │  Alt-Svc: h3=":8443" │
    ├──────────────────────┤
    │  /api/*  → reverse   │──→  scripts/network_api.py :8888
    │  /*      → file_server│──→  /content/*.m4s
    │  logs/access.log (JSON) │──→  scripts/analyze_logs.py
    └──────────────────────┘
```

---

## Yêu Cầu Hệ Thống

| Phần Mềm | Phiên Bản | Ghi Chú |
|-----------|-----------|---------|
| **Caddy** | v2.x | HTTP/3 bật mặc định |
| **Python** | 3.8+ | Cho `network_api.py` và `analyze_logs.py` |
| **Chrome/Edge** | 100+ | Hỗ trợ HTTP/3 (QUIC) |
| **Linux** | Ubuntu 20.04+ | Cần `tc` (iproute2) cho network simulation |
| **sudo** | — | Cần thiết cho `tc qdisc` commands |

---

## Cài Đặt & Khởi Chạy

### 1. Khởi động Caddy Server

```bash
cd /home/vboxuser/dash-content
caddy run --config Caddyfile
```

Server sẽ lắng nghe trên `https://localhost:8443` với HTTP/2 + HTTP/3.

### 2. Khởi động Network API (tùy chọn)

```bash
sudo python3 scripts/network_api.py
```

API server lắng nghe trên `http://127.0.0.1:8888`.

### 3. Mở Player

Mở Chrome và truy cập:

```
https://localhost:8443/player.html
```

> **Lưu ý:** Với self-signed certificate, gõ `thisisunsafe` trên trang cảnh báo Chrome hoặc click **Advanced → Proceed**.

---

## Hướng Dẫn Sử Dụng

### Player Dashboard

| Khu Vực | Chức Năng |
|---------|-----------|
| **Video Player** | Phát DASH stream với autoplay |
| **Live Telemetry** | Protocol, Buffer Level, Throughput, Segment Latency, Bitrate, Resolution |
| **Stream Controls** | Chọn network scenario (browser), toggle ABR, manual quality, custom MPD URL |
| **Research Lab** | Chọn preset network scenario (server-side via `tc`), hiển thị terminal command |
| **Telemetry Logging** | Start/Stop recording, Export CSV, Clear logs |

### Quick Source Select

| Button | Nội Dung |
|--------|----------|
| **Local Full** | `manifest.mpd` — 9 video + 1 audio |
| **Local Video** | `manifest-video-only.mpd` — chỉ video |
| **Local Audio** | `manifest-audio-only.mpd` — chỉ audio |
| **BBB** | Big Buck Bunny từ Akamai CDN |
| **Envivio** | Envivio demo stream |

### Xác Nhận HTTP/3

1. Mở DevTools (F12) → Tab **Network**
2. Right-click cột header → Bật cột **Protocol**
3. Quan sát: requests đầu tiên là `h2`, sau đó chuyển sang `h3`

---

## Mô Phỏng Mạng

### Qua Terminal (tc netem)

```bash
# Ideal — xóa mọi rules
sudo scripts/network_sim.sh ideal

# High Latency — 200ms ± 20ms jitter
sudo scripts/network_sim.sh latency

# Packet Loss — 3%
sudo scripts/network_sim.sh loss

# Extreme — 150ms + 2% loss
sudo scripts/network_sim.sh extreme
```

### Qua API (network_api.py)

```bash
# Áp dụng scenario
curl -X POST http://localhost:8888/api/network \
  -H "Content-Type: application/json" \
  -d '{"scenario": "latency"}'

# Giới hạn bandwidth (VD: 800 kbps)
curl -X POST http://localhost:8888/api/network \
  -H "Content-Type: application/json" \
  -d '{"scenario": "bandwidth:800"}'

# Kiểm tra trạng thái tc
curl http://localhost:8888/api/network/status
```

---

## Phân Tích Log

### Chạy phân tích

```bash
python3 scripts/analyze_logs.py
```

**Output:**
- Bảng tóm tắt trên terminal (scenario × protocol)
- File CSV tại `dash_server_log_<timestamp>.csv`

### Các trường CSV (18 fields)

| Field | Mô Tả |
|-------|--------|
| `timestamp` | Thời gian ISO 8601 |
| `uri` | URI request |
| `segment` | Tên segment file |
| `protocol` | `HTTP/2.0` hoặc `HTTP/3.0` |
| `status` | HTTP status code |
| `duration_ms` | Latency server-side (ms) |
| `throughput_mbps` | Throughput (Mbps) |
| `resp_size_bytes` | Kích thước response |
| `tls_version` | TLS version |
| `tls_resumed` | TLS session resumption |
| `scenario` | Network scenario label |

---

## Cấu Trúc Dự Án

```
dash-content/
├── Caddyfile               # Caddy server config (HTTP/3 + reverse proxy)
├── player.html             # DASH player UI (dash.js + telemetry dashboard)
├── REPORT.md               # Báo cáo chi tiết benchmark HTTP/3 vs HTTP/2
├── README.md               # File này
├── css/
│   └── style.css           # Premium dark theme styling
├── js/
│   └── app.js              # dash.js integration + event handlers
├── logs/
│   └── access.log          # Caddy JSON access log
├── scripts/
│   ├── analyze_logs.py     # Caddy JSON log parser → CSV exporter
│   ├── network_api.py      # Python REST API → tc qdisc commands
│   ├── network_sim.sh      # Shell script cho network simulation
│   └── benchmark.sh        # HTTP/2 performance test (curl)
├── dash_server_log_*.csv   # Exported telemetry data
└── content/
    ├── manifest.mpd                # Full stream manifest (9 video + 1 audio)
    ├── manifest-video-only.mpd     # Video-only manifest
    ├── manifest-audio-only.mpd     # Audio-only manifest
    └── v{1-9}_257-*.m4s            # 983 DASH segment files
        v4_258-*.m4s                # Audio segments
```

---

## Kết Quả Benchmark

> Dữ liệu từ **2.086 DASH segment requests** trên localhost.

| Metric | HTTP/2 | HTTP/3 |
|--------|--------|--------|
| Requests | 900 | 1186 |
| Avg Latency | **1.7 ms** | 4.4 ms |
| P95 Latency | **8.8 ms** | 15.7 ms |
| Avg Throughput | 208 Mbps | **346 Mbps** |
| Error Rate | 0% | 0% |

> **Ghi chú:** HTTP/3 có latency cao hơn trên loopback do UDP overhead. Trong điều kiện thực tế (packet loss, high latency), HTTP/3 vượt trội nhờ loại bỏ TCP Head-of-Line Blocking.

📄 Xem [REPORT.md](REPORT.md) để đọc báo cáo phân tích đầy đủ.

---

## License

Dự án phục vụ mục đích nghiên cứu và học thuật.
