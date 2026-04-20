#!/bin/bash

# Network Simulation Script for DASH Testing
# Interface: lo (loopback) since we test on localhost
INTERFACE="lo"

function clear_rules() {
    sudo tc qdisc del dev $INTERFACE root 2>/dev/null
    echo "[*] Network rules cleared. (Ideal Network)"
}

function apply_latency() {
    clear_rules
    # Add 200ms delay with 20ms jitter
    sudo tc qdisc add dev $INTERFACE root netem delay 200ms 20ms
    echo "[!] Applied 200ms Latency (High Latency Scenario)"
}

function apply_loss() {
    clear_rules
    # Add 3% packet loss
    sudo tc qdisc add dev $INTERFACE root netem loss 3%
    echo "[!] Applied 3% Packet Loss (Unstable Network Scenario)"
}

function apply_extreme() {
    clear_rules
    # High latency + Loss
    sudo tc qdisc add dev $INTERFACE root netem delay 150ms 10ms loss 2%
    echo "[!] Applied 150ms Latency + 2% Loss (Extreme Scenario)"
}

case "$1" in
    ideal) clear_rules ;;
    latency) apply_latency ;;
    loss) apply_loss ;;
    extreme) apply_extreme ;;
    *) echo "Usage: ./network_sim.sh {ideal|latency|loss|extreme}" ;;
esac
