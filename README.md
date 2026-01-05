# Lighthouse Throttling Automation

Automated Lighthouse testing with custom network throttling profiles for comprehensive performance analysis across multiple network conditions.

## Table of Contents

- [Features](#features)
- [Complete Test Suite (Recommended)](#complete-test-suite-recommended)
  - [Usage](#usage)
  - [Example Output](#example-output)
- [Installation](#installation)
- [Single Test Mode](#single-test-mode)
- [Compare Results](#compare-results)
- [Output Structure](#output-structure)
- [Throttling Profiles](#throttling-profiles)
- [Troubleshooting](#troubleshooting)

## Features

- **Complete Test Suite**: Run comprehensive tests across all 4 throttling profiles with 3 iterations each (12 tests total)
- **Custom Throttling Profiles**: No throttling, 4G-Fast, 4G-Slow, and 3G
- **Automated Aggregation**: Automatic averaging and comparison across all network conditions
- **Report-Only Mode**: Generate reports from existing test results without re-running tests
- **Before/After Tracking**: Perfect for measuring optimization impact across all conditions
- **Multiple Output Formats**: HTML reports for viewing, JSON for automation

## Complete Test Suite (Recommended)

The `lighthouse-run-all.sh` script runs comprehensive performance testing across all network conditions, providing a complete picture of your site's performance profile.

### Usage

```bash
./lighthouse-run-all.sh <URL> [OPTIONS]
```

**Options:**
- `--delay <seconds>` - Delay between test runs (default: 15 seconds)
- `--output-dir <path>` - Output directory (default: `results`)
- `--report-only` - Generate report from existing results without running new tests
- `--help, -h` - Show help message

**Examples:**

```bash
# Run complete test suite (12 tests: 4 profiles × 3 iterations)
./lighthouse-run-all.sh https://example.com

# Custom delay between tests (recommended for production sites)
./lighthouse-run-all.sh https://example.com --delay 20

# Custom output directory
./lighthouse-run-all.sh https://example.com --output-dir ./my-results

# Generate report from existing test results
./lighthouse-run-all.sh https://example.com --report-only
```

### Example Output

The script provides comprehensive results across all network profiles:

```
================================================================================
[SUCCESS] LIGHTHOUSE TEST SUMMARY
================================================================================

## Overall Averages

| Metric | Value |
|--------|-------|
| Performance Score | 82.3 |
| First Contentful Paint (FCP) | 1.2s |
| Largest Contentful Paint (LCP) | 2.4s |
| Total Blocking Time (TBT) | 245ms |
| Speed Index (SI) | 1.9s |
| Cumulative Layout Shift (CLS) | 0.015 |
| Time to Interactive (TTI) | 3.1s |

## Profile: none

| Metric | Run 1 | Run 2 | Run 3 | Average |
|--------|-------|-------|-------|---------|
| Performance Score | 95 | 96 | 94 | 95.0 |
| FCP | 892ms | 845ms | 910ms | 882ms |
| LCP | 1.5s | 1.4s | 1.6s | 1.5s |
| TBT | 89ms | 76ms | 95ms | 87ms |
| Speed Index | 1.2s | 1.1s | 1.3s | 1.2s |
| CLS | 0.002 | 0.001 | 0.003 | 0.002 |
| TTI | 2.1s | 2.0s | 2.2s | 2.1s |

## Profile: 4g-fast

| Metric | Run 1 | Run 2 | Run 3 | Average |
|--------|-------|-------|-------|---------|
| Performance Score | 89 | 91 | 88 | 89.3 |
| FCP | 1.1s | 1.0s | 1.2s | 1.1s |
| LCP | 2.0s | 1.9s | 2.1s | 2.0s |
| TBT | 145ms | 132ms | 158ms | 145ms |
| Speed Index | 1.5s | 1.4s | 1.6s | 1.5s |
| CLS | 0.005 | 0.003 | 0.007 | 0.005 |
| TTI | 2.8s | 2.6s | 3.0s | 2.8s |

## Profile: 4g-slow

| Metric | Run 1 | Run 2 | Run 3 | Average |
|--------|-------|-------|-------|---------|
| Performance Score | 76 | 78 | 75 | 76.3 |
| FCP | 1.5s | 1.4s | 1.6s | 1.5s |
| LCP | 2.8s | 2.7s | 3.0s | 2.8s |
| TBT | 312ms | 289ms | 334ms | 312ms |
| Speed Index | 2.2s | 2.1s | 2.4s | 2.2s |
| CLS | 0.018 | 0.015 | 0.021 | 0.018 |
| TTI | 3.9s | 3.7s | 4.2s | 3.9s |

## Profile: 3g

| Metric | Run 1 | Run 2 | Run 3 | Average |
|--------|-------|-------|-------|---------|
| Performance Score | 69 | 71 | 68 | 69.3 |
| FCP | 1.9s | 1.8s | 2.0s | 1.9s |
| LCP | 3.5s | 3.3s | 3.7s | 3.5s |
| TBT | 435ms | 412ms | 456ms | 434ms |
| Speed Index | 2.8s | 2.7s | 3.0s | 2.8s |
| CLS | 0.035 | 0.032 | 0.038 | 0.035 |
| TTI | 4.7s | 4.5s | 5.0s | 4.7s |

================================================================================
[SUCCESS] Test suite completed successfully!
================================================================================
```

**Key Benefits:**

- **Complete Performance Profile**: See how your site performs across all network conditions
- **Statistical Reliability**: 3 iterations per profile ensure consistent, reliable results
- **Automated Analysis**: Overall averages help identify trends across all conditions
- **Production-Ready**: Use `--report-only` to analyze existing test data without re-running tests

## Installation

### Prerequisites

1. **Node.js** (for Lighthouse CLI)
2. **Chrome/Chromium** browser
3. **jq** (for JSON processing)
4. **bc** (for calculations in lighthouse-run-all.sh)

### Install Dependencies

```bash
# Install Lighthouse
npm install -g lighthouse

# Install Chrome (Ubuntu/Debian)
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt install ./google-chrome-stable_current_amd64.deb

# Or install Chromium
sudo apt install chromium-browser

# Install jq and bc
sudo apt install jq bc
```

### Make Scripts Executable

```bash
chmod +x lighthouse-throttle.sh lighthouse-run-all.sh lighthouse-diff.sh
```

## Single Test Mode

For running individual tests with specific throttling profiles, use `lighthouse-throttle.sh`.

### Run Single Lighthouse Test

```bash
./lighthouse-throttle.sh <URL> [--throttling <profile>] [--output-dir <path>]
```

**Throttling Profiles:**
- `none` - No throttling (baseline/Desktop WiFi)
- `4g-fast` - Good 4G/WiFi (40ms RTT, 10Mbps)
- `4g-slow` - Typical 4G/Weak signal (100ms RTT, 1.5Mbps, 4x CPU)
- `3g` - 3G/Poor mobile (300ms RTT, 400Kbps, 4x CPU)

**Examples:**

```bash
# Default throttling (4g-slow)
./lighthouse-throttle.sh https://sit.hugeshop.com/au

# Specific throttling profile
./lighthouse-throttle.sh https://sit.hugeshop.com/au --throttling 3g

# Custom output directory
./lighthouse-throttle.sh https://example.com --throttling 4g-fast --output-dir ./my-results
```

### Compare Results

```bash
./lighthouse-diff.sh <domain> [--throttling <profile>] [--results-dir <path>]
```

**Examples:**

```bash
# Compare all results for a domain
./lighthouse-diff.sh hugeshop.com

# Filter by throttling profile
./lighthouse-diff.sh hugeshop.com --throttling 4g-slow

# Use custom results directory
./lighthouse-diff.sh example.com --results-dir ./my-results
```

### Typical Workflow: Before/After Comparison

**Option 1: Complete Test Suite (Recommended)**

```bash
# 1. Run baseline tests across all profiles
./lighthouse-run-all.sh https://example.com --output-dir ./results-before

# 2. Make your optimizations...

# 3. Run comparison tests
./lighthouse-run-all.sh https://example.com --output-dir ./results-after

# 4. Compare results side-by-side
# Before optimization
./lighthouse-run-all.sh https://example.com --output-dir ./results-before --report-only

# After optimization
./lighthouse-run-all.sh https://example.com --output-dir ./results-after --report-only
```

**Option 2: Single Profile Testing**

```bash
# 1. Run baseline tests (3 runs for consistency)
./lighthouse-throttle.sh https://sit.hugeshop.com/au --throttling 4g-slow
./lighthouse-throttle.sh https://sit.hugeshop.com/au --throttling 4g-slow
./lighthouse-throttle.sh https://sit.hugeshop.com/au --throttling 4g-slow

# 2. Check baseline average
./lighthouse-diff.sh hugeshop.com --throttling 4g-slow

# 3. Make your optimizations...

# 4. Run comparison tests
./lighthouse-throttle.sh https://sit.hugeshop.com/au --throttling 4g-slow
./lighthouse-throttle.sh https://sit.hugeshop.com/au --throttling 4g-slow
./lighthouse-throttle.sh https://sit.hugeshop.com/au --throttling 4g-slow

# 5. Compare with baseline
./lighthouse-diff.sh hugeshop.com --throttling 4g-slow
```

## Output Structure

```
results/
├── sit.hugeshop.com_au_4g-slow_2026-01-04_191640/
│   ├── report.html      # Visual Lighthouse report
│   ├── report.json      # Raw Lighthouse JSON
│   └── metrics.json     # Extracted key metrics
└── sit.hugeshop.com_au_4g-slow_2026-01-04_192015/
    ├── report.html
    ├── report.json
    └── metrics.json
```

## Throttling Profiles

| Profile | RTT (ms) | Throughput | CPU Slowdown | Use Case |
|---------|----------|------------|--------------|----------|
| `none` | 0 | 10 Mbps | 1x | Baseline / Desktop WiFi |
| `4g-fast` | 40 | 10 Mbps | 1x | Good 4G / WiFi |
| `4g-slow` | 100 | 1.5 Mbps | 4x | Typical 4G / Weak Signal |
| `3g` | 300 | 400 Kbps | 4x | 3G / Poor Mobile |

## Comparison Output Example

```
Found 3 result(s) for hugeshop.com with 4g-slow throttling:
  - 2026-01-04T19:16:40
  - 2026-01-04T19:20:15
  - 2026-01-04T19:25:30

                    Run 1     Run 2     Run 3     AVG
Performance Score       78        82        76     78.7
LCP (ms)              2456      2100      2589   2381.7
FCP (ms)              1234      1100      1290   1208.0
CLS                   0.02      0.01      0.03     0.02
TTI (ms)              3800      3500      4000   3766.7
Speed Index           1890      1750      1950   1863.3

✓ Performance score is good, but could be improved
⚠ LCP could be improved (target: < 2.5s)
```

## Troubleshooting

### Chrome not found

If you get an error about Chrome not being found:

```bash
# Option 1: Install Chrome
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt install ./google-chrome-stable_current_amd64.deb

# Option 2: Use Puppeteer's bundled Chrome
npx puppeteer browsers install chrome
export CHROME_PATH=$(npx -y resolve-puppeteer-chrome)

# Option 3: Set CHROME_PATH manually
export CHROME_PATH=/path/to/your/chrome
```

### Lighthouse version compatibility

This script uses Lighthouse v13+ format. If you're using an older version, update:

```bash
npm update -g lighthouse
```

## License

MIT
