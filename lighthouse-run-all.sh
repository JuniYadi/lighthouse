#!/bin/bash

################################################################################
# lighthouse-run-all.sh
#
# Run Lighthouse tests across multiple throttling profiles with aggregation.
#
# Usage:
#   ./lighthouse-run-all.sh <URL> [--delay <seconds>] [--output-dir <path>]
#
# Runs 12 tests total: 4 profiles × 3 iterations
# Profiles: none, 4g-fast, 4g-slow, 3g
#
# Example:
#   ./lighthouse-run-all.sh https://example.com
#   ./lighthouse-run-all.sh https://example.com --delay 10 --output-dir ./my-results
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

# Default values
DEFAULT_DELAY=15
DEFAULT_OUTPUT_DIR="results"

# Throttling profiles (ordered as per plan)
PROFILES=("none" "4g-fast" "4g-slow" "3g")
RUNS_PER_PROFILE=3

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
  --delay <seconds>      Delay between runs in seconds (default: ${DEFAULT_DELAY})
  --output-dir <path>    Output directory (default: ${DEFAULT_OUTPUT_DIR})
  --report-only          Generate report from existing results without running new tests
  --help, -h             Show this help message

Examples:
  $0 https://example.com
  $0 https://example.com --delay 10
  $0 https://example.com --delay 20 --output-dir ./my-results
  $0 https://example.com --report-only

EOF
}

check_dependencies() {
    local missing_deps=()

    # Check for lighthouse-throttle.sh
    if [ ! -x "./lighthouse-throttle.sh" ]; then
        log_error "lighthouse-throttle.sh not found or not executable"
        echo "Ensure lighthouse-throttle.sh is in the current directory and executable:"
        echo "  chmod +x lighthouse-throttle.sh"
        exit 1
    fi

    # Check for jq
    if ! command -v jq &> /dev/null; then
        missing_deps+=("jq")
    fi

    # Check for bc
    if ! command -v bc &> /dev/null; then
        missing_deps+=("bc")
    fi

    # Check for date
    if ! command -v date &> /dev/null; then
        missing_deps+=("date")
    fi

    if [ ${#missing_deps[@]} -gt 0 ]; then
        log_error "Missing dependencies: ${missing_deps[*]}"
        echo ""
        echo "Install missing dependencies:"
        for dep in "${missing_deps[@]}"; do
            case $dep in
                jq)
                    echo "  sudo apt install jq   # Ubuntu/Debian"
                    echo "  sudo yum install jq   # CentOS/RHEL"
                    echo "  brew install jq       # macOS"
                    ;;
                bc)
                    echo "  sudo apt install bc   # Ubuntu/Debian"
                    echo "  sudo yum install bc   # CentOS/RHEL"
                    echo "  brew install bc       # macOS"
                    ;;
            esac
        done
        exit 1
    fi
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

################################################################################
# Run Coordination
################################################################################

load_existing_metrics() {
    local url=$1
    local output_dir=$2
    local hostname=$(extract_hostname "$url")

    # Data structures to store metrics
    declare -A metrics
    declare -A failure_count

    log_info "Loading existing test results from: $output_dir" >&2
    echo "" >&2

    # Load metrics for each profile
    for profile in "${PROFILES[@]}"; do
        failure_count[$profile]=0
        local run=1
        local loaded_count=0

        # Find all matching directories for this profile, sorted newest first
        while IFS= read -r dir && [ $loaded_count -lt $RUNS_PER_PROFILE ]; do
            local metrics_file="$dir/metrics.json"

            if [ -f "$metrics_file" ]; then
                # Extract metrics from the file
                local perf=$(jq -r '.categories.performance' "$metrics_file")
                local fcp=$(jq -r '.metrics.fcp' "$metrics_file")
                local lcp=$(jq -r '.metrics.lcp' "$metrics_file")
                local tbt=$(jq -r '.metrics.total_blocking_time' "$metrics_file")
                local si=$(jq -r '.metrics.speed_index' "$metrics_file")
                local cls=$(jq -r '.metrics.cls' "$metrics_file")
                local tti=$(jq -r '.metrics.tti' "$metrics_file")

                # Store metrics
                metrics["${profile}_perf_${run}"]=$perf
                metrics["${profile}_fcp_${run}"]=$fcp
                metrics["${profile}_lcp_${run}"]=$lcp
                metrics["${profile}_tbt_${run}"]=$tbt
                metrics["${profile}_si_${run}"]=$si
                metrics["${profile}_cls_${run}"]=$cls
                metrics["${profile}_tti_${run}"]=$tti

                log_info "Loaded $profile run $run from $(basename "$dir")" >&2

                run=$((run + 1))
                loaded_count=$((loaded_count + 1))
            fi
        done < <(find "$output_dir" -maxdepth 1 -type d -name "${hostname}*_${profile}_*" 2>/dev/null | sort -r)

        # Track failures
        local missing=$((RUNS_PER_PROFILE - loaded_count))
        if [ $missing -gt 0 ]; then
            failure_count[$profile]=$missing
            log_warn "Only found $loaded_count out of $RUNS_PER_PROFILE runs for profile: $profile" >&2
        fi
    done

    echo "" >&2

    # Return metrics and failure counts
    declare -p metrics
    declare -p failure_count
}

find_latest_metrics() {
    local output_dir=$1
    local hostname=$2
    local profile=$3

    # Find all directories matching the pattern for this profile
    local search_pattern="${output_dir}/${hostname}*_${profile}_*"

    # Iterate through directories sorted by timestamp (newest first)
    # and return the first one that has metrics.json
    while IFS= read -r dir; do
        if [ -f "$dir/metrics.json" ]; then
            echo "$dir/metrics.json"
            return 0
        fi
    done < <(find "$output_dir" -maxdepth 1 -type d -name "$(basename "$search_pattern")" 2>/dev/null | sort -r)

    return 1
}

format_unit() {
    local value=$1

    # If value >= 1000, convert to seconds with 1 decimal
    if [ "$(echo "$value >= 1000" | bc -l)" -eq 1 ]; then
        local seconds=$(echo "scale=1; $value / 1000" | bc -l)
        echo "${seconds}s"
    else
        # Round to whole number for ms
        local rounded=$(printf "%.0f" "$value")
        echo "${rounded}ms"
    fi
}

run_all_tests() {
    local url=$1
    local delay=$2
    local output_dir=$3
    local hostname=$(extract_hostname "$url")

    # Data structures to store metrics
    # Format: profile_metric_run (e.g., none_perf_1, none_fcp_1, etc.)
    declare -A metrics
    declare -A failure_count

    local total_runs=$((${#PROFILES[@]} * RUNS_PER_PROFILE))
    local current_run=0
    local failed_runs=0

    # Run tests
    for profile in "${PROFILES[@]}"; do
        failure_count[$profile]=0

        for run in $(seq 1 $RUNS_PER_PROFILE); do
            current_run=$((current_run + 1))

            echo ""
            log_info "Run $current_run/$total_runs: Profile=$profile, Iteration=$run"

            # Run lighthouse-throttle.sh
            if ./lighthouse-throttle.sh "$url" --throttling "$profile" --output-dir "$output_dir" > /dev/null 2>&1; then
                # Find the latest metrics.json for this profile
                local metrics_file=$(find_latest_metrics "$output_dir" "$hostname" "$profile")

                if [ -n "$metrics_file" ]; then
                    # Extract metrics
                    local perf=$(jq -r '.categories.performance' "$metrics_file")
                    local fcp=$(jq -r '.metrics.fcp' "$metrics_file")
                    local lcp=$(jq -r '.metrics.lcp' "$metrics_file")
                    local tbt=$(jq -r '.metrics.total_blocking_time' "$metrics_file")
                    local si=$(jq -r '.metrics.speed_index' "$metrics_file")
                    local cls=$(jq -r '.metrics.cls' "$metrics_file")
                    local tti=$(jq -r '.metrics.tti' "$metrics_file")

                    # Store metrics
                    metrics["${profile}_perf_${run}"]=$perf
                    metrics["${profile}_fcp_${run}"]=$fcp
                    metrics["${profile}_lcp_${run}"]=$lcp
                    metrics["${profile}_tbt_${run}"]=$tbt
                    metrics["${profile}_si_${run}"]=$si
                    metrics["${profile}_cls_${run}"]=$cls
                    metrics["${profile}_tti_${run}"]=$tti

                    # Print per-run summary
                    log_success "Completed - Perf: $perf, LCP: $(format_unit $lcp), FCP: $(format_unit $fcp)"
                else
                    log_error "Failed to find metrics file"
                    failure_count[$profile]=$((${failure_count[$profile]} + 1))
                    failed_runs=$((failed_runs + 1))
                fi
            else
                log_error "Lighthouse test failed"
                failure_count[$profile]=$((${failure_count[$profile]} + 1))
                failed_runs=$((failed_runs + 1))
            fi

            # Sleep between runs (except after the last run)
            if [ $current_run -lt $total_runs ]; then
                log_info "Waiting ${delay}s before next run..."
                sleep "$delay"
            fi
        done
    done

    echo ""
    log_success "All tests completed!"
    if [ $failed_runs -gt 0 ]; then
        log_warn "$failed_runs out of $total_runs runs failed"
    fi
    echo ""

    # Return metrics and failure counts (via stdout - will be captured by caller)
    # For now, we'll store them globally and access in aggregation
    # In bash, we can use declare -p to export associative arrays
    declare -p metrics
    declare -p failure_count
}

################################################################################
# Aggregation Logic
################################################################################

calculate_average() {
    local values=("$@")
    local sum=0
    local count=0

    for val in "${values[@]}"; do
        if [ -n "$val" ]; then
            sum=$(echo "$sum + $val" | bc -l)
            count=$((count + 1))
        fi
    done

    if [ $count -eq 0 ]; then
        echo "0"
    else
        echo "scale=2; $sum / $count" | bc -l
    fi
}

aggregate_metrics() {
    # Access the global metrics and failure_count arrays
    # Compute per-profile averages
    declare -A profile_avg_perf
    declare -A profile_avg_fcp
    declare -A profile_avg_lcp
    declare -A profile_avg_tbt
    declare -A profile_avg_si
    declare -A profile_avg_cls
    declare -A profile_avg_tti

    for profile in "${PROFILES[@]}"; do
        local perf_values=()
        local fcp_values=()
        local lcp_values=()
        local tbt_values=()
        local si_values=()
        local cls_values=()
        local tti_values=()

        for run in $(seq 1 $RUNS_PER_PROFILE); do
            local perf_key="${profile}_perf_${run}"
            local fcp_key="${profile}_fcp_${run}"
            local lcp_key="${profile}_lcp_${run}"
            local tbt_key="${profile}_tbt_${run}"
            local si_key="${profile}_si_${run}"
            local cls_key="${profile}_cls_${run}"
            local tti_key="${profile}_tti_${run}"

            if [ -n "${metrics[$perf_key]}" ]; then
                perf_values+=("${metrics[$perf_key]}")
                fcp_values+=("${metrics[$fcp_key]}")
                lcp_values+=("${metrics[$lcp_key]}")
                tbt_values+=("${metrics[$tbt_key]}")
                si_values+=("${metrics[$si_key]}")
                cls_values+=("${metrics[$cls_key]}")
                tti_values+=("${metrics[$tti_key]}")
            fi
        done

        # Calculate per-profile averages
        profile_avg_perf[$profile]=$(calculate_average "${perf_values[@]}")
        profile_avg_fcp[$profile]=$(calculate_average "${fcp_values[@]}")
        profile_avg_lcp[$profile]=$(calculate_average "${lcp_values[@]}")
        profile_avg_tbt[$profile]=$(calculate_average "${tbt_values[@]}")
        profile_avg_si[$profile]=$(calculate_average "${si_values[@]}")
        profile_avg_cls[$profile]=$(calculate_average "${cls_values[@]}")
        profile_avg_tti[$profile]=$(calculate_average "${tti_values[@]}")
    done

    # Compute overall averages (average of per-profile averages)
    local all_perf_avgs=()
    local all_fcp_avgs=()
    local all_lcp_avgs=()
    local all_tbt_avgs=()
    local all_si_avgs=()
    local all_cls_avgs=()
    local all_tti_avgs=()

    for profile in "${PROFILES[@]}"; do
        # Only include profiles with at least one successful run
        if [ "$(echo "${profile_avg_perf[$profile]} > 0" | bc -l)" -eq 1 ]; then
            all_perf_avgs+=("${profile_avg_perf[$profile]}")
            all_fcp_avgs+=("${profile_avg_fcp[$profile]}")
            all_lcp_avgs+=("${profile_avg_lcp[$profile]}")
            all_tbt_avgs+=("${profile_avg_tbt[$profile]}")
            all_si_avgs+=("${profile_avg_si[$profile]}")
            all_cls_avgs+=("${profile_avg_cls[$profile]}")
            all_tti_avgs+=("${profile_avg_tti[$profile]}")
        fi
    done

    local overall_perf=$(calculate_average "${all_perf_avgs[@]}")
    local overall_fcp=$(calculate_average "${all_fcp_avgs[@]}")
    local overall_lcp=$(calculate_average "${all_lcp_avgs[@]}")
    local overall_tbt=$(calculate_average "${all_tbt_avgs[@]}")
    local overall_si=$(calculate_average "${all_si_avgs[@]}")
    local overall_cls=$(calculate_average "${all_cls_avgs[@]}")
    local overall_tti=$(calculate_average "${all_tti_avgs[@]}")

    # Export arrays for use in formatting
    declare -p profile_avg_perf
    declare -p profile_avg_fcp
    declare -p profile_avg_lcp
    declare -p profile_avg_tbt
    declare -p profile_avg_si
    declare -p profile_avg_cls
    declare -p profile_avg_tti

    # Export overall averages
    echo "overall_perf=\"$overall_perf\""
    echo "overall_fcp=\"$overall_fcp\""
    echo "overall_lcp=\"$overall_lcp\""
    echo "overall_tbt=\"$overall_tbt\""
    echo "overall_si=\"$overall_si\""
    echo "overall_cls=\"$overall_cls\""
    echo "overall_tti=\"$overall_tti\""
}

################################################################################
# Formatting Helpers
################################################################################

generate_overall_table() {
    # Build header
    local header="| Metric |"
    local separator="|--------|"
    
    for profile in "${PROFILES[@]}"; do
        header="$header $profile |"
        separator="$separator---------|"
    done

    echo "## Overall Averages by Profile"
    echo ""
    echo "$header"
    echo "$separator"

    # Performance Score
    local row="| Performance Score |"
    for profile in "${PROFILES[@]}"; do
        local val="${profile_avg_perf[$profile]}"
        if [ -n "$val" ]; then
            row="$row $(printf "%.1f" "$val") |"
        else
            row="$row N/A |"
        fi
    done
    echo "$row"

    # FCP
    row="| First Contentful Paint (FCP) |"
    for profile in "${PROFILES[@]}"; do
        local val="${profile_avg_fcp[$profile]}"
        if [ -n "$val" ]; then
            row="$row $(format_unit "$val") |"
        else
            row="$row N/A |"
        fi
    done
    echo "$row"

    # LCP
    row="| Largest Contentful Paint (LCP) |"
    for profile in "${PROFILES[@]}"; do
        local val="${profile_avg_lcp[$profile]}"
        if [ -n "$val" ]; then
            row="$row $(format_unit "$val") |"
        else
            row="$row N/A |"
        fi
    done
    echo "$row"

    # TBT
    row="| Total Blocking Time (TBT) |"
    for profile in "${PROFILES[@]}"; do
        local val="${profile_avg_tbt[$profile]}"
        if [ -n "$val" ]; then
            row="$row $(format_unit "$val") |"
        else
            row="$row N/A |"
        fi
    done
    echo "$row"

    # SI
    row="| Speed Index (SI) |"
    for profile in "${PROFILES[@]}"; do
        local val="${profile_avg_si[$profile]}"
        if [ -n "$val" ]; then
            row="$row $(format_unit "$val") |"
        else
            row="$row N/A |"
        fi
    done
    echo "$row"

    # CLS
    row="| Cumulative Layout Shift (CLS) |"
    for profile in "${PROFILES[@]}"; do
        local val="${profile_avg_cls[$profile]}"
        if [ -n "$val" ]; then
            row="$row $(printf "%.3f" "$val") |"
        else
            row="$row N/A |"
        fi
    done
    echo "$row"

    echo ""
}

generate_profile_table() {
    local profile=$1

    # Build header
    cat << EOF
## Profile: $profile

| Metric | Run 1 | Run 2 | Run 3 | Average |
|--------|-------|-------|-------|---------|
EOF

    # Performance Score
    local run1_perf="${metrics[${profile}_perf_1]:-N/A}"
    local run2_perf="${metrics[${profile}_perf_2]:-N/A}"
    local run3_perf="${metrics[${profile}_perf_3]:-N/A}"
    local avg_perf="${profile_avg_perf[$profile]}"
    printf "| Performance Score | %s | %s | %s | %.1f |\n" "$run1_perf" "$run2_perf" "$run3_perf" "$avg_perf"

    # FCP
    local run1_fcp="${metrics[${profile}_fcp_1]}"
    local run2_fcp="${metrics[${profile}_fcp_2]}"
    local run3_fcp="${metrics[${profile}_fcp_3]}"
    local avg_fcp="${profile_avg_fcp[$profile]}"
    if [ -n "$run1_fcp" ]; then
        printf "| FCP | %s | %s | %s | %s |\n" \
            "$(format_unit "$run1_fcp")" \
            "$(format_unit "${run2_fcp:-0}")" \
            "$(format_unit "${run3_fcp:-0}")" \
            "$(format_unit "$avg_fcp")"
    else
        printf "| FCP | N/A | N/A | N/A | N/A |\n"
    fi

    # LCP
    local run1_lcp="${metrics[${profile}_lcp_1]}"
    local run2_lcp="${metrics[${profile}_lcp_2]}"
    local run3_lcp="${metrics[${profile}_lcp_3]}"
    local avg_lcp="${profile_avg_lcp[$profile]}"
    if [ -n "$run1_lcp" ]; then
        printf "| LCP | %s | %s | %s | %s |\n" \
            "$(format_unit "$run1_lcp")" \
            "$(format_unit "${run2_lcp:-0}")" \
            "$(format_unit "${run3_lcp:-0}")" \
            "$(format_unit "$avg_lcp")"
    else
        printf "| LCP | N/A | N/A | N/A | N/A |\n"
    fi

    # TBT
    local run1_tbt="${metrics[${profile}_tbt_1]}"
    local run2_tbt="${metrics[${profile}_tbt_2]}"
    local run3_tbt="${metrics[${profile}_tbt_3]}"
    local avg_tbt="${profile_avg_tbt[$profile]}"
    if [ -n "$run1_tbt" ]; then
        printf "| TBT | %s | %s | %s | %s |\n" \
            "$(format_unit "$run1_tbt")" \
            "$(format_unit "${run2_tbt:-0}")" \
            "$(format_unit "${run3_tbt:-0}")" \
            "$(format_unit "$avg_tbt")"
    else
        printf "| TBT | N/A | N/A | N/A | N/A |\n"
    fi

    # SI
    local run1_si="${metrics[${profile}_si_1]}"
    local run2_si="${metrics[${profile}_si_2]}"
    local run3_si="${metrics[${profile}_si_3]}"
    local avg_si="${profile_avg_si[$profile]}"
    if [ -n "$run1_si" ]; then
        printf "| Speed Index | %s | %s | %s | %s |\n" \
            "$(format_unit "$run1_si")" \
            "$(format_unit "${run2_si:-0}")" \
            "$(format_unit "${run3_si:-0}")" \
            "$(format_unit "$avg_si")"
    else
        printf "| Speed Index | N/A | N/A | N/A | N/A |\n"
    fi

    # CLS
    local run1_cls="${metrics[${profile}_cls_1]}"
    local run2_cls="${metrics[${profile}_cls_2]}"
    local run3_cls="${metrics[${profile}_cls_3]}"
    local avg_cls="${profile_avg_cls[$profile]}"
    if [ -n "$run1_cls" ]; then
        printf "| CLS | %.3f | %.3f | %.3f | %.3f |\n" "$run1_cls" "${run2_cls:-0}" "${run3_cls:-0}" "$avg_cls"
    else
        printf "| CLS | N/A | N/A | N/A | N/A |\n"
    fi

    # TTI
    local run1_tti="${metrics[${profile}_tti_1]}"
    local run2_tti="${metrics[${profile}_tti_2]}"
    local run3_tti="${metrics[${profile}_tti_3]}"
    local avg_tti="${profile_avg_tti[$profile]}"
    if [ -n "$run1_tti" ]; then
        printf "| TTI | %s | %s | %s | %s |\n" \
            "$(format_unit "$run1_tti")" \
            "$(format_unit "${run2_tti:-0}")" \
            "$(format_unit "${run3_tti:-0}")" \
            "$(format_unit "$avg_tti")"
    else
        printf "| TTI | N/A | N/A | N/A | N/A |\n"
    fi

    # Add failure notice if applicable
    local failures="${failure_count[$profile]}"
    if [ "$failures" -gt 0 ]; then
        echo ""
        echo "*Note: $failures out of $RUNS_PER_PROFILE runs failed for this profile*"
    fi

    echo ""
}

################################################################################
# Main
################################################################################

main() {
    local url=""
    local delay="$DEFAULT_DELAY"
    local output_dir="$DEFAULT_OUTPUT_DIR"
    local report_only=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --delay)
                delay="$2"
                shift 2
                ;;
            --output-dir)
                output_dir="$2"
                shift 2
                ;;
            --report-only)
                report_only=true
                shift
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

    # Check dependencies
    check_dependencies

    # Ensure output directory exists
    mkdir -p "$output_dir"

    # Run tests or load existing results based on mode
    if [ "$report_only" = true ]; then
        log_info "Report-only mode: Loading existing test results"
        log_info "URL: $url"
        log_info "Output directory: $output_dir"
        echo ""

        # Load existing metrics
        local test_output=$(load_existing_metrics "$url" "$output_dir")

        # Evaluate the returned associative arrays
        eval "$test_output"
    else
        log_info "Starting Lighthouse test suite"
        log_info "URL: $url"
        log_info "Profiles: ${PROFILES[*]}"
        log_info "Runs per profile: $RUNS_PER_PROFILE"
        log_info "Delay between runs: ${delay}s"
        log_info "Output directory: $output_dir"
        echo ""

        # Run all tests and capture metrics
        local test_output=$(run_all_tests "$url" "$delay" "$output_dir")

        # Evaluate the returned associative arrays
        eval "$test_output"
    fi

    # Aggregate metrics
    local agg_output=$(aggregate_metrics)
    eval "$agg_output"

    # Generate and display summary report
    echo ""
    echo "================================================================================"
    log_success "LIGHTHOUSE TEST SUMMARY"
    echo "================================================================================"
    echo ""

    # Generate overall summary table
    generate_overall_table

    # Generate per-profile tables
    for profile in "${PROFILES[@]}"; do
        generate_profile_table "$profile"
    done

    echo "================================================================================"
    log_success "Test suite completed successfully!"
    echo "================================================================================"
}

main "$@"
