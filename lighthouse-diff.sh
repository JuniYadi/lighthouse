#!/bin/bash

################################################################################
# lighthouse-diff.sh
#
# Auto-discover and compare Lighthouse test results with averaging.
#
# Usage:
#   ./lighthouse-diff.sh <domain> [--throttling <profile>] [--results-dir <path>]
#
# Examples:
#   ./lighthouse-diff.sh hugeshop.com --throttling 4g-slow
#   ./lighthouse-diff.sh example.com
################################################################################

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

################################################################################
# Configuration
################################################################################

DEFAULT_RESULTS_DIR="results"

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

show_usage() {
    cat << EOF
Usage: $0 <domain> [OPTIONS]

Arguments:
  domain                 Domain name to search for (partial match)

Options:
  --throttling <profile> Filter by throttling profile (optional)
                         Available: 3g, 4g-slow, 4g-fast, none
  --results-dir <path>   Results directory (default: ${DEFAULT_RESULTS_DIR})
  --help, -h             Show this help message

Examples:
  $0 hugeshop.com --throttling 4g-slow
  $0 example.com
  $0 mysite.com --results-dir ./custom-results

EOF
}

check_dependencies() {
    if ! command -v jq &> /dev/null; then
        log_error "jq is required but not installed"
        echo "Install with: sudo apt install jq"
        exit 1
    fi
}

################################################################################
# Result Discovery
################################################################################

discover_results() {
    local domain=$1
    local throttling=$2
    local results_dir=$3

    local search_pattern="*${domain}*"
    local jq_filter=".[]"

    # Add throttling filter if specified
    if [ -n "$throttling" ]; then
        search_pattern="${search_pattern}*${throttling}*"
        jq_filter="${jq_filter} | select(.throttling == \"${throttling}\")"
    fi

    # Find all matching metrics.json files
    local files=()
    while IFS= read -r -d '' file; do
        # Check if the directory matches our pattern
        local dir=$(basename "$(dirname "$file")")
        if [[ "$dir" == ${search_pattern} ]]; then
            files+=("$file")
        fi
    done < <(find "$results_dir" -type f -name "metrics.json" -print0 2>/dev/null)

    # Sort by timestamp in filename (newest first)
    IFS=$'\n' sorted_files=($(sort -r <<<"${files[*]}"))
    unset IFS

    # Take up to 3 most recent
    local selected_files=()
    for i in "${!sorted_files[@]}"; do
        if [ $i -lt 3 ]; then
            selected_files+=("${sorted_files[$i]}")
        fi
    done

    # Output as JSON array for jq processing
    if [ ${#selected_files[@]} -gt 0 ]; then
        local json_output="["
        for i in "${!selected_files[@]}"; do
            if [ $i -gt 0 ]; then
                json_output+=","
            fi
            json_output+=$(cat "${selected_files[$i]}")
        done
        json_output+="]"
        echo "$json_output"
    else
        echo "[]"
    fi
}

################################################################################
# Display Functions
################################################################################

format_number() {
    local num=$1
    local is_float=$2

    if [ "$is_float" = "true" ]; then
        printf "%.2f" "$num"
    else
        printf "%.0f" "$num"
    fi
}

calculate_average() {
    local values=("$@")
    local sum=0
    local count=${#values[@]}

    for val in "${values[@]}"; do
        sum=$(echo "$sum + $val" | bc -l)
    done

    echo "scale=2; $sum / $count" | bc -l
}

print_comparison_table() {
    local results_json=$1
    local count=$(echo "$results_json" | jq 'length')

    if [ "$count" -eq 0 ]; then
        log_error "No results found"
        return 1
    fi

    echo ""
    echo -e "${BOLD}Found $count result(s):${NC}"
    echo "$results_json" | jq -r '.[].timestamp' | while read -r ts; do
        echo "  - $ts"
    done
    echo ""

    # Extract metrics for each run
    local perf_scores=($(echo "$results_json" | jq -r '.[].categories.performance'))
    local lcp_values=($(echo "$results_json" | jq -r '.[].metrics.lcp'))
    local fcp_values=($(echo "$results_json" | jq -r '.[].metrics.fcp'))
    local cls_values=($(echo "$results_json" | jq -r '.[].metrics.cls'))
    local tti_values=($(echo "$results_json" | jq -r '.[].metrics.tti'))
    local si_values=($(echo "$results_json" | jq -r '.[].metrics.speed_index'))

    # Calculate averages
    local avg_perf=$(calculate_average "${perf_scores[@]}")
    local avg_lcp=$(calculate_average "${lcp_values[@]}")
    local avg_fcp=$(calculate_average "${fcp_values[@]}")
    local avg_cls=$(calculate_average "${cls_values[@]}")
    local avg_tti=$(calculate_average "${tti_values[@]}")
    local avg_si=$(calculate_average "${si_values[@]}")

    # Build header
    echo -e "${BOLD}$(printf '%-20s' '')$(printf '%10s' "Run 1")$(printf '%10s' "Run 2")$(printf '%10s' "Run 3")$(printf '%12s' "AVG")${NC}"
    echo -e "$(printf '%-20s' '')$(printf '%10s' "-----")$(printf '%10s' "-----")$(printf '%10s' "-----")$(printf '%12s' "---")"

    # Performance Score
    local row=$(printf '%-20s' 'Performance Score')
    for i in $(seq 0 $(($count - 1))); do
        local val=${perf_scores[$i]}
        local color=$CYAN
        row+=$(printf "${color}%10s${NC}" "$val")
    done
    # Fill empty columns
    for i in $(seq $count 2); do
        row+=$(printf '%10s' '-')
    done
    row+=$(printf '%12s' "$avg_perf")
    echo -e "$row"

    # LCP
    row=$(printf '%-20s' 'LCP (ms)')
    for i in $(seq 0 $(($count - 1))); do
        local val=${lcp_values[$i]}
        row+=$(printf '%10s' "$val")
    done
    for i in $(seq $count 2); do
        row+=$(printf '%10s' '-')
    done
    row+=$(printf '%12s' "$(format_number "$avg_lcp" false)")
    echo -e "$row"

    # FCP
    row=$(printf '%-20s' 'FCP (ms)')
    for i in $(seq 0 $(($count - 1))); do
        local val=${fcp_values[$i]}
        row+=$(printf '%10s' "$val")
    done
    for i in $(seq $count 2); do
        row+=$(printf '%10s' '-')
    done
    row+=$(printf '%12s' "$(format_number "$avg_fcp" false)")
    echo -e "$row"

    # CLS
    row=$(printf '%-20s' 'CLS')
    for i in $(seq 0 $(($count - 1))); do
        local val=${cls_values[$i]}
        row+=$(printf '%10s' "$val")
    done
    for i in $(seq $count 2); do
        row+=$(printf '%10s' '-')
    done
    row+=$(printf '%12s' "$(format_number "$avg_cls" true)")
    echo -e "$row"

    # TTI
    row=$(printf '%-20s' 'TTI (ms)')
    for i in $(seq 0 $(($count - 1))); do
        local val=${tti_values[$i]}
        row+=$(printf '%10s' "$val")
    done
    for i in $(seq $count 2); do
        row+=$(printf '%10s' '-')
    done
    row+=$(printf '%12s' "$(format_number "$avg_tti" false)")
    echo -e "$row"

    # Speed Index
    row=$(printf '%-20s' 'Speed Index')
    for i in $(seq 0 $(($count - 1))); do
        local val=${si_values[$i]}
        row+=$(printf '%10s' "$val")
    done
    for i in $(seq $count 2); do
        row+=$(printf '%10s' '-')
    done
    row+=$(printf '%12s' "$(format_number "$avg_si" false)")
    echo -e "$row"

    echo ""

    # Recommendations based on results
    if [ "$(echo "$avg_perf < 50" | bc -l)" -eq 1 ]; then
        echo -e "${RED}⚠ Performance score is below 50 - needs optimization${NC}"
    elif [ "$(echo "$avg_perf < 90" | bc -l)" -eq 1 ]; then
        echo -e "${YELLOW}⚠ Performance score could be improved (target: 90+)${NC}"
    else
        echo -e "${GREEN}✓ Performance score is excellent!${NC}"
    fi

    if [ "$(echo "$avg_lcp > 2500" | bc -l)" -eq 1 ]; then
        echo -e "${RED}⚠ LCP is slow (target: < 2.5s)${NC}"
    elif [ "$(echo "$avg_lcp > 4000" | bc -l)" -eq 1 ]; then
        echo -e "${YELLOW}⚠ LCP could be improved (target: < 2.5s)${NC}"
    fi

    if [ "$(echo "$avg_cls > 0.1" | bc -l)" -eq 1 ]; then
        echo -e "${RED}⚠ CLS is poor (target: < 0.1)${NC}"
    fi
}

################################################################################
# Main
################################################################################

main() {
    local domain=""
    local throttling=""
    local results_dir="$DEFAULT_RESULTS_DIR"

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --throttling)
                throttling="$2"
                shift 2
                ;;
            --results-dir)
                results_dir="$2"
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
                if [ -z "$domain" ]; then
                    domain="$1"
                else
                    log_error "Multiple domains provided"
                    show_usage
                    exit 1
                fi
                shift
                ;;
        esac
    done

    # Validate domain
    if [ -z "$domain" ]; then
        log_error "Domain is required"
        show_usage
        exit 1
    fi

    # Check dependencies
    check_dependencies

    # Check results directory exists
    if [ ! -d "$results_dir" ]; then
        log_error "Results directory not found: $results_dir"
        log_info "Run tests first with: ./lighthouse-throttle.sh <URL>"
        exit 1
    fi

    # Discover results
    log_info "Searching for results matching: $domain"
    if [ -n "$throttling" ]; then
        log_info "Throttling filter: $throttling"
    fi

    local results_json=$(discover_results "$domain" "$throttling" "$results_dir")
    local count=$(echo "$results_json" | jq 'length')

    if [ "$count" -eq 0 ]; then
        log_error "No matching results found"
        echo ""
        echo "Available result directories:"
        find "$results_dir" -mindepth 1 -maxdepth 1 -type d | while read -r dir; do
            echo "  - $(basename "$dir")"
        done
        exit 1
    fi

    # Print comparison
    print_comparison_table "$results_json"
}

main "$@"
