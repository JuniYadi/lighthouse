# Lighthouse Throttling Automation

Automated Lighthouse testing with custom network throttling profiles for performance comparison.

## Features

- **Custom Throttling Profiles**: 3G, 4G-Slow, 4G-Fast, and no throttling
- **Auto-Discovery Comparison**: Compare up to 3 test runs with automatic averaging
- **Before/After Tracking**: Perfect for measuring optimization impact
- **Multiple Output Formats**: HTML reports for viewing, JSON for automation

## Installation

### Prerequisites

1. **Node.js** (for Lighthouse CLI)
2. **Chrome/Chromium** browser
3. **jq** (for JSON processing)

### Install Dependencies

```bash
# Install Lighthouse
npm install -g lighthouse

# Install Chrome (Ubuntu/Debian)
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt install ./google-chrome-stable_current_amd64.deb

# Or install Chromium
sudo apt install chromium-browser

# Install jq
sudo apt install jq
```

### Make Scripts Executable

```bash
chmod +x lighthouse-throttle.sh lighthouse-diff.sh
```

## Usage

### Run Lighthouse Test

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
