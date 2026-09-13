# One bounded diagnostic per configured URL. No redirects, login or interface changes.

ng_probe_error() {
	json_init
	json_add_string error "$1"
	json_dump
}

ng_probe() (
	local role="$1" interface mode status device address timeout expected probe_dir url name code rc internet_ok=0
	. /usr/share/libubox/jshn.sh
	config_get interface "$role" interface
	if [ "$role" = wifi ]; then
		config_get mode wifi mode
		[ "$mode" != managed ] || interface=nuitguard_wifi
	fi
	if [ -z "$interface" ]; then ng_probe_error uplink_not_configured; exit 1; fi
	status="$(ubus call "network.interface.$interface" status 2>/dev/null)"
	if [ "$(printf '%s' "$status" | jsonfilter -e '@.up' 2>/dev/null)" != true ]; then
		ng_probe_error uplink_not_up; exit 1
	fi
	device="$(printf '%s' "$status" | jsonfilter -e '@.l3_device' 2>/dev/null)"
	address="$(printf '%s' "$status" | jsonfilter -e '@["ipv4-address"][0].address' 2>/dev/null)"
	case "$device" in ''|*[!a-zA-Z0-9_.:@-]*) ng_probe_error missing_or_invalid_device; exit 1 ;; esac
	if [ -z "$address" ]; then ng_probe_error missing_ipv4_address; exit 1; fi
	if ! command -v curl >/dev/null 2>&1 || ! command -v ucode >/dev/null 2>&1; then
		ng_probe_error missing_dependency; exit 1
	fi
	config_get timeout main probe_timeout
	config_get expected main internet_expected_status
	umask 077
	probe_dir="$(mktemp -d /tmp/nuitguard-check.XXXXXX)" || exit 1
	trap 'rm -rf -- "$probe_dir"' EXIT
	trap 'exit 1' HUP INT TERM
	json_init
	json_add_string uplink "$role"
	json_add_string interface "$interface"
	json_add_string device "$device"
	json_add_string address_family ipv4
	json_add_string dns_scope system
	config_get url main portal_probe_url
	json_add_string portal_probe_url "$url"
	for name in internet portal; do
		config_get url main "${name}_probe_url"
		json_add_object "$name"
		if [ -z "$url" ]; then
			json_add_boolean configured 0
		else
			json_add_boolean configured 1
			if [ "$name" = portal ] && [ "$internet_ok" -eq 1 ]; then
				json_add_string state skipped_online
				json_close_object
				continue
			fi
			# if! prevents a missing device from being interpreted as a DNS hostname.
			# -q and --noproxy prevent user curl settings or proxy env from changing the path.
			code="$(curl -q --ipv4 --noproxy '*' --interface "if!$device" \
				--connect-timeout "$timeout" --max-time "$timeout" --max-filesize 262144 \
				--proto '=http,https' --silent --output "$probe_dir/$name.body" \
				--dump-header "$probe_dir/$name.headers" --write-out '%{http_code}' --url "$url" 2>/dev/null)" && rc=0 || rc=$?
			case "$code" in [0-9][0-9][0-9]) ;; *) code=0 ;; esac
			json_add_int curl_exit "$rc"
			json_add_int http_status "$code"
			[ "$name" != internet ] || json_add_int expected_status "$expected"
			if [ "$name" = internet ] && [ "$rc" -eq 0 ] && [ "$code" = "$expected" ]; then
				internet_ok=1
			fi
		fi
		json_close_object
	done
	json_dump > "$probe_dir/metadata.json"
	ucode /usr/libexec/nuitguard/probe-result.uc "$probe_dir"
)
