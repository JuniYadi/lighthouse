# Lighthouse Throttling Automation - Design Document

**Date:** 2026-01-04
**Status:** Approved
**Author:** Automated Lighthouse Testing Design

## Overview

Automated Lighthouse testing solution with custom network throttling profiles for performance comparison (before/after changes). Uses shell scripts for portability and simplicity.

## Goals

- Run Lighthouse tests with custom throttling (3G, 4G-Slow, 4G-Fast, None)
- Support before/after performance comparisons
- Auto-discover test results by domain name
- Average up to 3 test runs for consistent results
- Output both HTML (for viewing) and JSON (for tools)

## Architecture

### Components

| Component | Purpose |
|-----------|---------|
| `lighthouse-throttle.sh` | Run single Lighthouse test with throttling |
| `lighthouse-diff.sh` | Auto-discover and compare up to 3 results with average |
| `results/` | Auto-organized output by domain + throttling + timestamp |

### Directory Structure

```
results/
├── hugeshop.com_au_4g-slow_2026-01-04_193000/
│   ├── report.html        # Visual Lighthouse report
│   ├── report.json        # Raw JSON data for tools
│   └── metrics.json       # Extracted key metrics
├── hugeshop.com_au_4g-slow_2026-01-04_193500/
└── hugeshop.com_au_4g-slow_2026-01-04_194000/
```

## Usage

### Run Tests

```bash
# Single test
./lighthouse-throttle.sh https://sit.hugeshop.com/au --throttling 4g-slow

# Multiple tests for consistency (recommended 3 runs)
./lighthouse-throttle.sh https://sit.hugeshop.com/au --throttling 4g-slow
./lighthouse-throttle.sh https://sit.hugeshop.com/au --throttling 4g-slow
./lighthouse-throttle.sh https://sit.hugeshop.com/au --throttling 4g-slow
```

### Compare Results

```bash
# Auto-discover up to 3 most recent results for a domain
./lighthouse-diff.sh hugeshop.com --throttling 4g-slow
```

## Throttling Profiles

| Profile | RTT (ms) | Throughput (Kbps) | CPU Slowdown | Use Case |
|---------|----------|-------------------|--------------|----------|
| `none` | 0 | 10,000+ | 1x | Baseline / Desktop WiFi |
| `4g-fast` | 40 | 10,000 | 1x | Good 4G / WiFi |
| `4g-slow` | 100 | 1,500 | 4x | Typical 4G / Weak Signal |
| `3g` | 300 | 400 | 4x | 3G / Poor Mobile |

## Output Formats

### metrics.json Structure

```json
{
  "timestamp": "2026-01-04T19:30:00+07:00",
  "url": "https://sit.hugeshop.com/au",
  "throttling": "4g-slow",
  "categories": {
    "performance": 78,
    "accessibility": 95,
    "best-practices": 92,
    "seo": 100
  },
  "metrics": {
    "fcp": 1234,           // First Contentful Paint (ms)
    "lcp": 2456,           // Largest Contentful Paint (ms)
    "tti": 3800,           // Time to Interactive (ms)
    "speed_index": 1890,   // Speed Index
    "cls": 0.02,           // Cumulative Layout Shift
    "total_blocking_time": 450
  }
}
```

### Diff Output Format

```
Found 3 results for hugeshop.com with 4g-slow throttling:
  - hugeshop.com_au_4g-slow_2026-01-04_193000
  - hugeshop.com_au_4g-slow_2026-01-04_193500
  - hugeshop.com_au_4g-slow_2026-01-04_194000

                    Run 1     Run 2     Run 3     AVG
Performance Score   78        82        76        78.7
LCP (ms)           2456      2100      2589      2381.7
FCP (ms)           1234      1100      1290      1208.0
CLS                0.02      0.01      0.03      0.02
```

## Dependencies

- `lighthouse` CLI (`npm install -g lighthouse`)
- `jq` for JSON parsing (`sudo apt install jq`)

## Error Handling

- Validate Lighthouse is installed
- Check URL is reachable before testing
- Handle throttling profile not found
- Gracefully handle incomplete/corrupted JSON files
