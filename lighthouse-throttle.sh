#!/bin/bash

################################################################################
# lighthouse-throttle.sh
#
# Run Lighthouse tests with custom network throttling profiles.
#
# Usage:
#   ./lighthouse-throttle.sh <URL> [--throttling <profile>] [--output-dir <path>]
#
# Throttling Profiles:
#   - 3g:       Slow mobile (3G)
#   - 4g-slow:  Constrained 4G
#   - 4g-fast:  Desktop 4G
#   - none:     No throttling (baseline)
#
# Example:
#   ./lighthouse-throttle.sh https://sit.hugeshop.com/au --throttling 4g-slow
################################################################################

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

################################################################################
# Configuration
################################################################################

# Default values
DEFAULT_THROTTLING="4g-slow"
DEFAULT_OUTPUT_DIR="results"

# Throttling profiles - Lighthouse v13 format uses individual flags
# Format: rttMs|throughputKbps|cpuSlowdownMultiplier
declare -A THROTTLING_PROFILES=(
    ["none"]="0|10000|1"
    ["4g-fast"]="40|10000|1"
    ["4g-slow"]="100|1500|4"
    ["3g"]="300|400|4"
)

################################################################################
# Helper Functions
################################################################################

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

show_usage() {
    cat << EOF
Usage: $0 <URL> [OPTIONS]

Arguments:
  URL                    The URL to test (required)

Options:
  --throttling <profile> Throttling profile (default: ${DEFAULT_THROTTLING})
                         Available: 3g, 4g-slow, 4g-fast, none
  --output-dir <path>    Output directory (default: ${DEFAULT_OUTPUT_DIR})
  --help, -h             Show this help message

Examples:
  $0 https://sit.hugeshop.com/au
  $0 https://sit.hugeshop.com/au --throttling 3g
  $0 https://example.com --throttling 4g-fast --output-dir ./my-results

EOF
}

check_dependencies() {
    local missing_deps=()

    # Check for lighthouse
    if ! command -v lighthouse &> /dev/null; then
        missing_deps+=("lighthouse")
    fi

    # Check for jq
    if ! command -v jq &> /dev/null; then
        missing_deps+=("jq")
    fi

    # Check for Chrome/Chromium
    local chrome_found=false
    if [ -n "$CHROME_PATH" ] && [ -x "$CHROME_PATH" ]; then
        chrome_found=true
    elif command -v google-chrome &> /dev/null || command -v chromium-browser &> /dev/null || command -v chromium &> /dev/null; then
        chrome_found=true
    elif [ -x "/opt/google/chrome/google-chrome" ] || [ -x "/usr/bin/chromium-browser" ]; then
        chrome_found=true
    fi

    if [ "$chrome_found" = false ]; then
        missing_deps+=("chrome")
    fi

    if [ ${#missing_deps[@]} -gt 0 ]; then
        log_error "Missing dependencies: ${missing_deps[*]}"
        echo ""
        echo "Install missing dependencies:"
        echo ""
        for dep in "${missing_deps[@]}"; do
            case $dep in
                lighthouse)
                    echo "  npm install -g lighthouse"
                    ;;
                jq)
                    echo "  sudo apt install jq   # Ubuntu/Debian"
                    echo "  sudo yum install jq   # CentOS/RHEL"
                    echo "  brew install jq       # macOS"
                    ;;
                chrome)
                    echo "  # Install Chrome:"
                    echo "  wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb"
                    echo "  sudo apt install ./google-chrome-stable_current_amd64.deb"
                    echo ""
                    echo "  # Or Chromium:"
                    echo "  sudo apt install chromium-browser"
                    echo ""
                    echo "  # Or use Puppeteer's bundled Chrome:"
                    echo "  npx puppeteer browsers install chrome"
                    echo "  export CHROME_PATH=\$(npx -y resolve-puppeteer-chrome)"
                    ;;
            esac
        done
        exit 1
    fi
}

validate_url() {
    local url=$1

    # Basic URL validation
    if [[ ! $url =~ ^https?:// ]]; then
        log_error "URL must start with http:// or https://"
        return 1
    fi

    return 0
}

extract_hostname() {
    local url=$1

    # Remove protocol
    local host="${url#*://}"

    # Remove port and path
    host="${host%%:*}"
    host="${host%%/*}"

    # Replace special characters with underscores
    host=$(echo "$host" | sed 's/[^a-zA-Z0-9.-]/_/g')

    echo "$host"
}

extract_path_suffix() {
    local url=$1

    # Remove protocol
    local path="${url#*://}"

    # Keep path after domain, replace special chars
    path="${path#*/}"

    if [ -n "$path" ]; then
        path="_$(echo "$path" | sed 's/[^a-zA-Z0-9._-]/_/g')"
    fi

    echo "$path"
}

################################################################################
# Metrics Extraction
################################################################################

extract_metrics() {
    local json_file=$1
    local output_file=$2

    jq -r '
    {
        timestamp: (.fetchTime // (now | todateiso8601)),
        url: (.finalUrl // .requestedUrl),
        throttling: "'${THROTTLING}'",
        categories: {
            performance: (.categories.performance.score * 100 // 0),
            accessibility: (.categories.accessibility.score * 100 // 0),
            "best-practices": (.categories["best-practices"].score * 100 // 0),
            seo: (.categories.seo.score * 100 // 0)
        },
        metrics: {
            fcp: (.audits["first-contentful-paint"].numericValue // 0 | floor),
            lcp: (.audits["largest-contentful-paint"].numericValue // 0 | floor),
            tti: (.audits["interactive"].numericValue // 0 | floor),
            speed_index: (.audits["speed-index"].numericValue // 0 | floor),
            cls: (.audits["cumulative-layout-shift"].numericValue // 0),
            total_blocking_time: (.audits["total-blocking-time"].numericValue // 0 | floor)
        },
        audits: {
            total_byte_weight: (.audits["total-byte-weight"].numericValue // 0),
            dom_size: (.audits["dom-size"].numericValue // 0),
            unused_javascript: (.audits["unused-javascript"].details.overallSavingsBytes // 0)
        }
    }
    ' "$json_file" > "$output_file"
}

################################################################################
# Main
################################################################################

main() {
    local url=""
    local throttling="$DEFAULT_THROTTLING"
    local output_dir="$DEFAULT_OUTPUT_DIR"

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --throttling)
                throttling="$2"
                shift 2
                ;;
            --output-dir)
                output_dir="$2"
                shift 2
                ;;
            --help|-h)
                show_usage
                exit 0
                ;;
            -*)
                log_error "Unknown option: $1"
                show_usage
                exit 1
                ;;
            *)
                if [ -z "$url" ]; then
                    url="$1"
                else
                    log_error "Multiple URLs provided"
                    show_usage
                    exit 1
                fi
                shift
                ;;
        esac
    done

    # Validate URL
    if [ -z "$url" ]; then
        log_error "URL is required"
        show_usage
        exit 1
    fi

    validate_url "$url" || exit 1

    # Check dependencies
    check_dependencies

    # Validate throttling profile
    if [[ ! -v THROTTLING_PROFILES[$throttling] ]]; then
        log_error "Unknown throttling profile: $throttling"
        log_info "Available profiles: ${!THROTTLING_PROFILES[@]}"
        exit 1
    fi

    # Generate output directory name
    # If output_dir already contains a timestamp pattern (from server), use it directly
    # Otherwise, create a new subdirectory with hostname/timestamp
    if [[ "$output_dir" =~ _[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}$ ]] || [[ "$output_dir" =~ _[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}$ ]]; then
        # output_dir already has timestamp, use it directly (server-provided path)
        local run_dir="$output_dir"
    else
        # output_dir is a base directory, create subdirectory (standalone usage)
        local hostname=$(extract_hostname "$url")
        local path_suffix=$(extract_path_suffix "$url")
        local timestamp=$(date +"%Y-%m-%d_%H%M%S")
        local run_dir="${output_dir}/${hostname}${path_suffix}_${throttling}_${timestamp}"
    fi

    # Create output directory
    mkdir -p "$run_dir"

    # Get throttling config values
    local throttling_values="${THROTTLING_PROFILES[$throttling]}"
    local rtt_ms=$(echo "$throttling_values" | cut -d'|' -f1)
    local throughput_kbps=$(echo "$throttling_values" | cut -d'|' -f2)
    local cpu_slowdown=$(echo "$throttling_values" | cut -d'|' -f3)

    # Run Lighthouse
    log_info "Running Lighthouse for: $url"
    log_info "Throttling: $throttling (rtt=${rtt_ms}ms, throughput=${throughput_kbps}Kbps, cpuSlowdown=${cpu_slowdown}x)"
    log_info "Output: $run_dir"

    local report_path="${run_dir}/report"

    lighthouse "$url" \
        --throttling.rttMs="$rtt_ms" \
        --throttling.throughputKbps="$throughput_kbps" \
        --throttling.cpuSlowdownMultiplier="$cpu_slowdown" \
        --throttling.method=devtools \
        --only-categories=performance,accessibility,best-practices,seo \
        --output=json \
        --output=html \
        --output-path="$report_path" \
        --quiet \
        --chrome-flags="--headless=new --no-sandbox --disable-dev-shm-usage"

    if [ $? -eq 0 ]; then
        log_success "Lighthouse test completed"

        # Extract metrics
        local json_file="${report_path}.report.json"
        local metrics_file="${run_dir}/metrics.json"

        if [ -f "$json_file" ]; then
            # Export throttling name for extraction
            THROTTLING="$throttling" extract_metrics "$json_file" "$metrics_file"
            log_success "Metrics extracted to: $metrics_file"
        fi

        # Print summary
        echo ""
        log_info "Results saved to: $run_dir"
        echo ""
        echo "Files:"
        echo "  - ${run_dir}/report.html    (open in browser)"
        echo "  - ${run_dir}/report.json    (raw data)"
        echo "  - ${run_dir}/metrics.json   (key metrics for comparison)"

        # Show quick metrics
        if [ -f "$metrics_file" ]; then
            echo ""
            log_info "Quick Summary:"
            jq -r '
                "  Performance Score:  \(.categories.performance)",
                "  LCP:               \(.metrics.lcp)ms",
                "  FCP:               \(.metrics.fcp)ms",
                "  CLS:               \(.metrics.cls)"
            ' "$metrics_file"
        fi
    else
        log_error "Lighthouse test failed"
        exit 1
    fi
}

main "$@"
