# Read-only device inventory. Do not dump UCI wireless credentials or sessions.

ng_inspect() {
	local tool section interface wifi_section manager board
	. /usr/share/libubox/jshn.sh
	json_init
	json_add_string stage runtime
	json_add_boolean network_actions_available 1
	board="$(ubus call system board 2>/dev/null)"
	json_add_object device
	for tool in model board_name; do
		json_add_string "$tool" "$(printf '%s' "$board" | jsonfilter -e "@.$tool" 2>/dev/null)"
	done
	json_add_string release "$(printf '%s' "$board" | jsonfilter -e '@.release.version' 2>/dev/null)"
	json_close_object
	json_add_object tools
	for tool in curl ucode ubus ip iw openssl; do
		if command -v "$tool" >/dev/null 2>&1; then
			json_add_boolean "$tool" 1
		else
			json_add_boolean "$tool" 0
		fi
	done
	json_close_object
	json_add_array route_managers
	for manager in mwan3 pbr vpn-policy-routing; do
		[ ! -e "/etc/init.d/$manager" ] || json_add_string '' "$manager"
	done
	json_close_array
	json_add_object configured_uplinks
	for section in wired wifi; do
		config_get interface "$section" interface
		json_add_object "$section"
		json_add_string interface "$interface"
		if [ "$section" = wifi ]; then
			config_get wifi_section wifi wifi_section
			json_add_string wifi_section "$wifi_section"
		fi
		json_close_object
	done
	json_close_object
	json_dump
}
