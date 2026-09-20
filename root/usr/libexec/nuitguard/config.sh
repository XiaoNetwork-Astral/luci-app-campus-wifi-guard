# Campus WLAN Guard configuration validation. No network mutations.

ng_config_error() {
	printf '%s\n' "Invalid configuration: $1" >&2
	ng_config_errors=$((ng_config_errors + 1))
}

ng_config_uint() {
	local section="$1" key="$2" minimum="$3" maximum="$4" value
	config_get value "$section" "$key" "${5-}"
	# Canonical decimal only: avoid octal interpretation and arithmetic overflow.
	case "$value" in
		''|*[!0-9]*|0[0-9]*) ng_config_error "$section.$key"; return ;;
	esac
	if [ "${#value}" -gt 6 ] || [ "$value" -lt "$minimum" ] || [ "$value" -gt "$maximum" ]; then
		ng_config_error "$section.$key"
	fi
}

ng_config_enum() {
	local section="$1" key="$2" value choice
	shift 2
	config_get value "$section" "$key"
	for choice in "$@"; do
		[ "$value" = "$choice" ] && return 0
	done
	ng_config_error "$section.$key"
}

ng_config_name() {
	local section="$1" key="$2" optional="$3" value
	config_get value "$section" "$key"
	[ "$optional" = 1 ] && [ -z "$value" ] && return 0
	case "$value" in
		''|*[!a-zA-Z0-9_]*) ng_config_error "$section.$key"; return ;;
	esac
	[ "${#value}" -le 64 ] || ng_config_error "$section.$key"
}

ng_config_url() {
	local key="$1" optional="$2" value
	config_get value main "$key"
	[ "$optional" = 1 ] && [ -z "$value" ] && return 0
	# URLs are passed as a single curl argument later, never evaluated by a shell.
	# Reject embedded credentials, fragments, whitespace and non-HTTP schemes.
	printf '%s\n' "$value" | LC_ALL=C awk '
		BEGIN { valid = 0 }
		NR == 1 && length($0) <= 2048 &&
		/^https?:\/\/[^\/?#@[:space:]]+([\/?][^#[:space:]]*)?$/ {
			valid = 1
		}
		END { exit !(valid && NR == 1) }
	' || ng_config_error "main.$key"
}

ng_config_mac_pools() {
	local shared wired_pool wifi_pool legacy=0
	config_get shared main mac_pool '__legacy__'
	if [ "$shared" = '__legacy__' ]; then
		config_get wired_pool wired mac_pool
		config_get wifi_pool wifi mac_pool
		shared="$wired_pool $wifi_pool"
		legacy=1
	fi
	printf '%s
' "$shared" | LC_ALL=C awk -v legacy="$legacy" '
		{
			for (i = 1; i <= NF; i++) {
				mac = tolower($i)
				if (mac !~ /^[0-9a-f][26ae](:[0-9a-f]{2}){5}$/) bad = 1
				if (seen[mac]++) { if (!legacy) bad = 1 }
				else count++
			}
		}
		END { exit (bad || count > 64) }
	' || ng_config_error 'Shared MAC pool must contain distinct local unicast addresses (at most 64)'
}

ng_config_validate() {
	local section key kind wired wifi initial maximum time
	ng_config_errors=0
	for section in main wired wifi account schedule; do
		config_get kind "$section" TYPE
		case "$section:$kind" in
			main:main|wired:uplink|wifi:uplink|account:account|schedule:schedule) ;;
			*) ng_config_error "$section section" ;;
		esac
	done
	for key in enabled failover_enabled; do ng_config_enum main "$key" 0 1; done
	ng_config_enum main preferred_uplink wired wifi
	ng_config_enum main standby_mode cold warm
	ng_config_enum main failback_policy stable on_failure manual
	ng_config_enum main rotation_mode fixed offline scheduled
	ng_config_enum main log_level error warn info debug
	ng_config_uint main max_route_switches_per_incident 0 100
	ng_config_uint main alternate_connect_attempts 1 100
	ng_config_uint main primary_recovery_success_count 1 100
	ng_config_uint main primary_recovery_interval 1 86400
	ng_config_uint main primary_stable_time 1 604800
	ng_config_uint main incident_reset_time 1 604800
	ng_config_uint main probe_interval 1 86400
	ng_config_uint main portal_check_delay 1 86400 30
	ng_config_uint main probe_timeout 1 120
	ng_config_uint main offline_confirm_count 1 100
	ng_config_uint main offline_confirm_interval 1 3600
	ng_config_uint main portal_fail_count 1 100
	ng_config_uint main portal_fail_interval 1 3600
	ng_config_uint main max_portal_discovery_retries 1 100
	ng_config_uint main max_auth_retries_per_mac 1 100
	ng_config_uint main max_cycle_attempts 1 100
	ng_config_uint main max_post_auth_verify_failures 1 100
	ng_config_uint main auth_success_but_offline_rotation_limit 0 64 1
	config_get kind main auto_regenerate_pool 0
	case "$kind" in 0|1) ;; *) ng_config_error 'main.auto_regenerate_pool' ;; esac
	ng_config_uint main max_pool_regenerations 1 10 1
	ng_config_uint main retry_initial_delay 1 3600
	ng_config_uint main retry_max_delay 1 86400
	ng_config_uint main circuit_breaker_cooldown 1 604800
	ng_config_uint main reconnect_timeout 1 600
	ng_config_uint main min_rotation_interval 1 604800
	ng_config_mac_pools
	for key in fixed_mac_wired fixed_mac_wifi; do
		config_get kind main "$key"
		[ -z "$kind" ] || printf '%s\n' "$kind" | LC_ALL=C awk 'NR == 1 && /^[0-9a-fA-F][26aAeE](:[0-9a-fA-F]{2}){5}$/ { ok=1 } END { exit !(ok && NR == 1) }' || ng_config_error "main.$key"
	done
	ng_config_uint main internet_expected_status 200 299
	config_get kind main internet_expected_body
	[ "${#kind}" -le 4096 ] || ng_config_error 'main.internet_expected_body'
	config_get initial main enabled
	config_get maximum main internet_expected_status
	if [ "$initial" = 1 ] && [ "$maximum" != 204 ]; then
		printf '%s' "$kind" | LC_ALL=C awk '/[^[:space:]]/ { found=1 } END { exit !found }' ||
			ng_config_error 'main.internet_expected_body is required for non-204 checks'
	fi
	ng_config_url portal_probe_url 0
	ng_config_url portal_origin 0
	config_get kind main portal_origin
	case "$kind" in
		http://*|https://*)
			kind="${kind#*://}"
			case "$kind" in *[/?]*) ng_config_error 'main.portal_origin' ;; esac
			;;
	esac
	ng_config_url internet_probe_url 1
	for section in wired wifi; do
		ng_config_name "$section" interface 1
		ng_config_enum "$section" privacy_mac 0 1
	done
	ng_config_name wifi wifi_section 1
	ng_config_enum wifi mode existing managed
	ng_config_name wifi radio 1
	ng_config_name wifi zone 0
	config_get kind wifi bssid
	[ -z "$kind" ] || printf '%s\n' "$kind" | LC_ALL=C awk 'NR == 1 && /^[0-9a-fA-F][0-9a-fA-F](:[0-9a-fA-F][0-9a-fA-F]){5}$/ { ok=1 } END { exit !(ok && NR == 1) }' || ng_config_error 'wifi.bssid'
	config_get kind wifi mode
	if [ "$kind" = managed ]; then
		ng_config_name wifi radio 0
		config_get kind wifi ssid
		[ -n "$kind" ] && [ "${#kind}" -le 32 ] || ng_config_error 'wifi.ssid'
	fi
	config_get wired wired interface
	config_get wifi wifi interface
	[ -z "$wired" ] || [ "$wired" != "$wifi" ] || ng_config_error 'wired.interface equals wifi.interface'
	ng_config_enum schedule enabled 0 1
	ng_config_enum schedule logout_first 0 1
	ng_config_enum schedule type daily interval weekly
	ng_config_uint schedule interval_hours 1 8760
	ng_config_uint schedule weekday 1 7
	config_get time schedule time
	case "$time" in
		[01][0-9]:[0-5][0-9]|2[0-3]:[0-5][0-9]) ;;
		*) ng_config_error 'schedule.time' ;;
	esac
	# Do arithmetic comparisons only after all individual values are valid.
	if [ "$ng_config_errors" -eq 0 ]; then
		config_get initial main retry_initial_delay
		config_get maximum main retry_max_delay
		[ "$initial" -le "$maximum" ] || ng_config_error 'main.retry_max_delay < main.retry_initial_delay'
	fi
	[ "$ng_config_errors" -eq 0 ]
}
