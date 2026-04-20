document.addEventListener("DOMContentLoaded", function () {
    var videoElement = document.querySelector("#videoPlayer");
    var player = dashjs.MediaPlayer().create();
    
    // Apply user buffer settings: 10s buffer and exhaust existing high-quality buffer on network drop
    player.updateSettings({
        streaming: {
            buffer: {
                fastSwitchEnabled: false, // Don't drop existing buffer when network degrades
                bufferTimeDefault: 10,    // Keep 10 seconds of buffer generally
                bufferTimeAtTopQuality: 10,
                bufferTimeAtTopQualityLongForm: 10
            },
            abr: {
                limitBitrateByPortal: true
            }
        }
    });

    // Initialization
    player.initialize(videoElement, "/content/manifest.mpd", true);

    // DOM Elements Mapping
    const txtBuffer = document.getElementById('statBuffer');
    const txtBitrate = document.getElementById('statBitrate');
    const txtResolution = document.getElementById('statResolution');
    const txtLatency = document.getElementById('statLatency');
    const txtState = document.getElementById('playerStateText');
    const liveDot = document.getElementById('liveDot');
    const labelSrc = document.getElementById('currentSrcLabel');
    const streamBadge = document.getElementById('streamBadge');
    
    const abrToggle = document.getElementById('abrToggle');
    const qualitySelect = document.getElementById('qualitySelect');
    const networkScenario = document.getElementById('networkScenario');
    const quickSrcBtns = document.querySelectorAll('.quick-src-btn');
    const customVideoUrl = document.getElementById('customVideoUrl');
    const loadVideoBtn = document.getElementById('loadVideoBtn');

    const txtProtocol = document.getElementById('statProtocol');
    const txtThroughput = document.getElementById('statThroughput');
    const txtSegLatency = document.getElementById('statSegLatency');

    // --- Research Lab Interaction (Priority) ---
    const scenarioBtns = document.querySelectorAll('.scenario-btn');
    const activeScenarioLabel = document.getElementById('activeScenarioLabel');
    const terminalCmd = document.getElementById('terminalCmd');
    const scenarioObservation = document.getElementById('scenarioObservation');

    if (scenarioBtns.length > 0) {
        scenarioBtns.forEach(btn => {
            btn.addEventListener('click', function() {
                scenarioBtns.forEach(b => b.classList.remove('active'));
                this.classList.add('active');

                const arg = this.getAttribute('data-arg');
                const name = this.getAttribute('data-name');
                const desc = this.getAttribute('data-desc');

                if(activeScenarioLabel) activeScenarioLabel.innerText = name;
                if(terminalCmd) terminalCmd.innerText = `sudo ./network_sim.sh ${arg}`;
                if(scenarioObservation) scenarioObservation.innerHTML = `<strong>Phân tích:</strong> ${desc}`;
            });
        });
    }

    // Detected protocol and scenario cache
    let currentProtocol = "detecting...";
    let currentScenarioName = "Ideal (Low Latency)";

    // ============================================================
    // ENHANCED METRICS STATE
    // ============================================================
    let stallCount = 0;
    let stallStartTime = null;
    let totalStallDuration = 0;    // ms
    let abrSwitchCount = 0;
    let lastQualityIndex = -1;
    let sessionStartTime = Date.now();
    let loggedSegmentNames = new Set(); // Track logged segments to avoid duplicates

    // ============================================================
    // STALL / BUFFERING EVENT TRACKING
    // ============================================================
    if (videoElement) {
        videoElement.addEventListener('waiting', () => {
            if (stallStartTime === null) {
                stallStartTime = performance.now();
                stallCount++;
            }
        });
        videoElement.addEventListener('playing', () => {
            if (stallStartTime !== null) {
                totalStallDuration += performance.now() - stallStartTime;
                stallStartTime = null;
            }
        });
        videoElement.addEventListener('playing', () => {
            if(liveDot) { liveDot.style.backgroundColor = '#34d399'; liveDot.style.boxShadow = '0 0 8px #34d399'; }
            if(txtState) txtState.innerText = 'Playing';
        });
        videoElement.addEventListener('pause', () => {
            if(liveDot) { liveDot.style.backgroundColor = '#f59e0b'; liveDot.style.boxShadow = '0 0 8px #f59e0b'; }
            if(txtState) txtState.innerText = 'Paused';
        });
        videoElement.addEventListener('waiting', () => {
            if(liveDot) { liveDot.style.backgroundColor = '#6366f1'; liveDot.style.boxShadow = '0 0 8px #6366f1'; }
            if(txtState) txtState.innerText = 'Buffering...';
        });
    }

    // ============================================================
    // ABR SWITCH COUNT TRACKING
    // ============================================================
    player.on(dashjs.MediaPlayer.events.QUALITY_CHANGE_RENDERED, function(e) {
        if (e.mediaType === 'video') {
            if (lastQualityIndex !== -1 && e.newQuality !== lastQualityIndex) {
                abrSwitchCount++;
            }
            lastQualityIndex = e.newQuality;
        }
    });

    // --- Dashboard Metrics Polling & Logging ---
    let logData = [];
    let isLogging = false;
    const startLoggingBtn = document.getElementById('startLoggingBtn');
    const downloadLogBtn = document.getElementById('downloadLogBtn');
    const clearLogBtn = document.getElementById('clearLogBtn');
    const logStatus = document.getElementById('logStatus');

    setInterval(function() {
        if (!player || !player.isReady()) return;

        // Buffer
        const bufferLevel = player.getBufferLength('video') || player.getBufferLength('audio') || 0;
        if(txtBuffer) {
            txtBuffer.innerText = bufferLevel.toFixed(1) + 's';
            txtBuffer.style.color = bufferLevel < 2 ? '#ef4444' : (bufferLevel < 5 ? '#f59e0b' : '#34d399');
        }

        // Video Bitrate & Resolution
        const activeVideoRep = player.getCurrentRepresentationForType ? player.getCurrentRepresentationForType('video') : null;
        let bitrate = 0;
        let resolution = "-";
        let videoWidth = 0;
        let videoHeight = 0;
        
        if (activeVideoRep) {
            bitrate = activeVideoRep.bandwidth || activeVideoRep.bitrate || 0;
            if(txtBitrate) txtBitrate.innerText = (bitrate / 1000).toFixed(0) + ' kbps';
            videoWidth  = activeVideoRep.width  || 0;
            videoHeight = activeVideoRep.height || 0;
            resolution = videoWidth ? (videoWidth + 'x' + videoHeight) : (videoHeight ? videoHeight + 'p' : 'Auto');
            if(txtResolution) txtResolution.innerText = resolution;
        } else {
            if(txtBitrate) txtBitrate.innerText = "0 kbps";
            if(txtResolution) txtResolution.innerText = "-";
        }

        // Audio Representation
        const activeAudioRep = player.getCurrentRepresentationForType ? player.getCurrentRepresentationForType('audio') : null;
        const audioBitrate = activeAudioRep ? (activeAudioRep.bandwidth || activeAudioRep.bitrate || 0) : 0;

        // Throughput (Mbps)
        const throughputKbps = player.getSafeAverageThroughput('video') || player.getAverageThroughput('video') || 0;
        if(txtThroughput) txtThroughput.innerText = (throughputKbps / 1000).toFixed(2) + ' Mbps';

        // Dropped Frames (via HTMLVideoElement.getVideoPlaybackQuality)
        let droppedFrames = 0;
        let totalFrames = 0;
        if (videoElement && videoElement.getVideoPlaybackQuality) {
            const quality = videoElement.getVideoPlaybackQuality();
            droppedFrames = quality.droppedVideoFrames || 0;
            totalFrames   = quality.totalVideoFrames   || 0;
        }
        const dropRate = totalFrames > 0 ? ((droppedFrames / totalFrames) * 100).toFixed(2) : "0.00";

        // Session elapsed time
        const sessionElapsed = ((Date.now() - sessionStartTime) / 1000).toFixed(1); // seconds

        // Protocol & Latency Detection via Resource Timing API
        const resources = performance.getEntriesByType("resource");
        let segLatencySum = 0;
        let segCount = 0;
        
        // Inspect recent media segments
        for (let i = resources.length - 1; i >= 0 && segCount < 5; i--) {
            const res = resources[i];
            if (res.name.includes('.m4s') || res.name.includes('.mpd')) {
                const proto = res.nextHopProtocol || "";
                if (proto) {
                    currentProtocol = proto.toLowerCase();
                }
                
                // --- Detailed Timing Breakdown ---
                const totalDuration  = res.responseEnd    - res.requestStart;       // Total latency
                const dnsTime        = res.domainLookupEnd - res.domainLookupStart;  // DNS lookup
                const connectTime    = res.connectEnd     - res.connectStart;        // TCP connect
                const tlsTime        = res.secureConnectionStart > 0
                                       ? (res.requestStart - res.secureConnectionStart)
                                       : 0;                                           // TLS handshake
                const ttfb           = res.responseStart  - res.requestStart;        // Time To First Byte
                const downloadTime   = res.responseEnd    - res.responseStart;       // Payload transfer

                // --- Size Metrics ---
                const transferSize   = res.transferSize   || 0;  // Bytes over wire (compressed+headers)
                const encodedSize    = res.encodedBodySize || 0; // Compressed body
                const decodedSize    = res.decodedBodySize || 0; // Decompressed body

                if (totalDuration > 0) {
                    segLatencySum += totalDuration;
                    segCount++;
                    
                    // Segment identifier (filename only)
                    const segName = res.name.split('/').pop();

                    // Only log each unique segment once
                    if (isLogging && !loggedSegmentNames.has(segName)) {
                        loggedSegmentNames.add(segName);

                        const record = {
                            timestamp:         new Date().toISOString(),
                            sessionElapsed:    sessionElapsed,         // seconds since session start
                            protocol:          currentProtocol,
                            scenario:          currentScenarioName,
                            segmentName:       segName,

                            // Timing breakdown (ms)
                            totalLatency:      totalDuration.toFixed(0),
                            dnsLookup:         dnsTime.toFixed(0),
                            connectTime:       connectTime.toFixed(0),
                            tlsHandshake:      tlsTime.toFixed(0),
                            ttfb:              ttfb.toFixed(0),
                            downloadTime:      downloadTime.toFixed(0),

                            // Size (bytes)
                            transferSize:      transferSize,
                            encodedSize:       encodedSize,
                            decodedSize:       decodedSize,

                            // Playback quality
                            bufferLevel:       bufferLevel.toFixed(2),   // seconds
                            throughputMbps:    (throughputKbps / 1000).toFixed(3),
                            videoBitrateKbps:  (bitrate / 1000).toFixed(2),
                            audioBitrateKbps:  (audioBitrate / 1000).toFixed(2),
                            resolution:        resolution,
                            videoWidth:        videoWidth,
                            videoHeight:       videoHeight,

                            // Reliability metrics
                            stallCount:        stallCount,
                            totalStallMs:      totalStallDuration.toFixed(0),
                            abrSwitchCount:    abrSwitchCount,
                            droppedFrames:     droppedFrames,
                            totalFrames:       totalFrames,
                            dropRatePct:       dropRate
                        };

                        logData.push(record);
                        if(logStatus) logStatus.innerText = `Records: ${logData.length} (Recording...)`;
                    }
                }
            }
        }
        
        if(txtProtocol) {
            txtProtocol.innerText = currentProtocol.toUpperCase();
            txtProtocol.style.color = currentProtocol.includes('h3') ? '#34d399' : '#6366f1';
        }
        
        const avgLatency = segCount > 0 ? (segLatencySum / segCount) : 0;
        if(txtSegLatency) txtSegLatency.innerText = avgLatency.toFixed(0) + ' ms';

    }, 1000);

    // --- Control Listeners with Null Checks ---
    if (startLoggingBtn) {
        startLoggingBtn.addEventListener('click', function() {
            isLogging = !isLogging;
            this.innerText = isLogging ? 'Stop Recording' : 'Start Recording';
            this.classList.toggle('active', isLogging);
            if(downloadLogBtn) downloadLogBtn.disabled = isLogging;
            // Reset the Set so new recording session re-logs all new segments
            if (isLogging) {
                loggedSegmentNames = new Set();
                sessionStartTime = Date.now();
                stallCount = 0;
                totalStallDuration = 0;
                abrSwitchCount = 0;
            }
        });
    }

    if (downloadLogBtn) {
        downloadLogBtn.addEventListener('click', function() {
            if(logData.length === 0) return;
            const headers = [
                "Timestamp", "Session Elapsed (s)", "Protocol", "Scenario", "Segment",
                // Timing
                "Total Latency (ms)", "DNS Lookup (ms)", "Connect Time (ms)", "TLS Handshake (ms)", "TTFB (ms)", "Download (ms)",
                // Size
                "Transfer Size (B)", "Encoded Size (B)", "Decoded Size (B)",
                // Playback
                "Buffer (s)", "Throughput (Mbps)", "Video Bitrate (kbps)", "Audio Bitrate (kbps)", "Resolution", "Width", "Height",
                // Reliability
                "Stall Count", "Total Stall (ms)", "ABR Switches", "Dropped Frames", "Total Frames", "Drop Rate (%)"
            ];
            const csvRows = [headers.join(",")];
            logData.forEach(r => {
                csvRows.push([
                    r.timestamp,
                    r.sessionElapsed,
                    r.protocol,
                    `"${r.scenario}"`,
                    r.segmentName,
                    r.totalLatency,
                    r.dnsLookup,
                    r.connectTime,
                    r.tlsHandshake,
                    r.ttfb,
                    r.downloadTime,
                    r.transferSize,
                    r.encodedSize,
                    r.decodedSize,
                    r.bufferLevel,
                    r.throughputMbps,
                    r.videoBitrateKbps,
                    r.audioBitrateKbps,
                    `"${r.resolution}"`,
                    r.videoWidth,
                    r.videoHeight,
                    r.stallCount,
                    r.totalStallMs,
                    r.abrSwitchCount,
                    r.droppedFrames,
                    r.totalFrames,
                    r.dropRatePct
                ].join(","));
            });
            const blob = new Blob([csvRows.join("\n")], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.setAttribute('hidden', ''); a.setAttribute('href', url);
            a.setAttribute('download', `dash_telemetry_${new Date().getTime()}.csv`);
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
        });
    }

    if (clearLogBtn) {
        clearLogBtn.addEventListener('click', function() {
            if(confirm("Clear all recorded data?")) {
                logData = [];
                loggedSegmentNames = new Set();
                if(logStatus) logStatus.innerText = 'Records: 0';
                if(downloadLogBtn) downloadLogBtn.disabled = true;
            }
        });
    }

    // --- Real network throttling via Python API + tc qdisc ---
    const NETWORK_SCENARIO_MAP = {
        'unlimited': 'ideal',
        '15000':     'bandwidth:15000',
        '5000':      'bandwidth:5000',
        '2500':      'bandwidth:2500',
        '800':       'bandwidth:800',
        '200':       'bandwidth:200',
    };

    async function applyNetworkThrottle(value) {
        const scenario = NETWORK_SCENARIO_MAP[value] || 'ideal';
        try {
            const res = await fetch('/api/network', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scenario })
            });
            const data = await res.json();
            if (data.ok) {
                console.log('[network] Throttle applied:', data.msg);
            } else {
                console.warn('[network] API error:', data.error);
            }
        } catch (err) {
            console.warn('[network] Could not reach network API:', err.message);
        }
    }

    if (networkScenario) {
        networkScenario.addEventListener('change', function(e) {
            const maxKbps = e.target.value;

            // 1. Apply real OS-level throttle via API
            applyNetworkThrottle(maxKbps);

            // 2. Also cap dash.js ABR as secondary enforcement
            player.updateSettings({ streaming: { abr: { maxBitrate: {
                video: maxKbps === 'unlimited' ? -1 : parseInt(maxKbps),
                audio: -1
            }}}});
        });
    }

    if (abrToggle) {
        abrToggle.addEventListener('change', function(e) {
            const isAuto = e.target.checked;
            player.updateSettings({ 'streaming': { 'abr': { 'autoSwitchBitrate': { 'video': isAuto, 'audio': isAuto } } } });
            if(qualitySelect) {
                qualitySelect.disabled = isAuto;
                qualitySelect.innerHTML = isAuto ? '<option value="auto">Auto (ABR Enabled)</option>' : '';
                if(!isAuto) {
                    const reps = player.getRepresentationsByType('video');
                    reps.forEach((r, i) => {
                        let opt = document.createElement('option');
                        opt.value = r.id || i;
                        opt.text = `${r.height || 'Auto'}p - ${((r.bandwidth||r.bitrate)/1000).toFixed(0)} kbps`;
                        qualitySelect.appendChild(opt);
                    });
                }
            }
        });
    }

    if (qualitySelect) {
        qualitySelect.addEventListener('change', function(e) {
            if (e.target.value !== 'auto' && e.target.value !== '-1') {
                player.setRepresentationForTypeById('video', e.target.value);
            }
        });
    }

    if (loadVideoBtn) {
        loadVideoBtn.addEventListener('click', function() {
            const url = customVideoUrl ? customVideoUrl.value.trim() : "";
            if (url) {
                player.attachSource(url);
                if(labelSrc) labelSrc.innerText = "Custom URL";
                quickSrcBtns.forEach(b => b.classList.remove('active'));
                if(streamBadge) streamBadge.className = "badge-live";
            }
        });
    }

    if (quickSrcBtns) {
        quickSrcBtns.forEach(btn => {
            btn.addEventListener('click', function(e) {
                quickSrcBtns.forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                const newUrl = e.currentTarget.getAttribute('data-src');
                const newName = e.currentTarget.getAttribute('data-name');
                player.attachSource(newUrl);
                if(labelSrc) labelSrc.innerText = newName;
                if(streamBadge) {
                    if(newName === "Audio Only") streamBadge.className = "badge-live audio";
                    else if (newName === "Video Only") streamBadge.className = "badge-live video";
                    else streamBadge.className = "badge-live";
                }
            });
        });
    }

    // --- Scenario Tracking for Header Injection ---
    if (scenarioBtns) {
        scenarioBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                currentScenarioName = btn.getAttribute('data-name');
            });
        });
    }

    // --- dash.js Header Injection Interceptor ---
    player.extend("RequestModifier", function () {
        return {
            modifyRequestHeader: function (xhr) {
                xhr.setRequestHeader('X-Network-Scenario', currentScenarioName);
                return xhr;
            },
            modifyRequestAttributes: function (request) {
                return request;
            }
        };
    }, true);
});
