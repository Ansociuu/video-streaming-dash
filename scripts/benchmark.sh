#!/bin/bash

URL_BASE="https://localhost:8443"
MANIFEST="/manifest.mpd"
SEGS=50
CONCURRENCY=10

echo "=========================================="
echo "    HTTP/2 Performance Test using curl    "
echo "=========================================="

echo "[HTTP/2] Fetching manifest.mpd..."
curl -k -s -w "  TTFB: %{time_starttransfer}s\n  Total: %{time_total}s\n" -o /dev/null --http2 "$URL_BASE$MANIFEST"

echo ""
echo "[HTTP/2] Downloading $SEGS video segments (Concurrency: $CONCURRENCY)..."
# We measure the total time to download 50 segments
start_time=$(date +%s.%N)
seq 1 $SEGS | xargs -P $CONCURRENCY -I {} curl -k -s -o /dev/null --http2 "$URL_BASE/v2_257-270146-i-{}.m4s"
end_time=$(date +%s.%N)

duration=$(echo "$end_time - $start_time" | bc -l)
printf "  Total time for %d segments: %.3f seconds\n" $SEGS $duration

echo ""
echo "=========================================="
echo "    HTTP/3 Performance Test Strategy      "
echo "=========================================="
echo "Local 'curl' lacks HTTP/3 build flags on this Ubuntu version."
echo "To test HTTP/3 and compare:"
echo "1. Open Google Chrome/Edge."
echo "2. Navigate to https://localhost:8443/player.html"
echo "   (Accept the self-signed certificate warning: type 'thisisunsafe' or click Advanced -> Proceed)"
echo "3. Open Developer Tools (F12) -> Network tab."
echo "   Right click column headers -> enable 'Protocol'."
echo "4. Refresh and watch the segments load over 'h3' protocol."
echo "   Observe the Waterfall latency values compared to HTTP/2."
