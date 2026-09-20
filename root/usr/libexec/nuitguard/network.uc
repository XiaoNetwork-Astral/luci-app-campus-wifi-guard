import { cursor } from 'uci';
import { connect } from 'ubus';
import * as fs from 'fs';
import { create_owned_config } from './owned-config.uc';
import { create_identities, validate_pool, generate_pool, shared_pool, fixed_addresses } from './identity.uc';
import { create_routes } from './routes.uc';
import { atomic_json, read_json, private_dir, runtime_dir, ensure_directory, monotonic_seconds } from './common.uc';

export function create_network(settings, dependencies) {
	let deps = dependencies || {};
	if (!deps.uci) { ensure_directory(runtime_dir); ensure_directory(runtime_dir + '/uci'); }
	let uci = deps.uci || cursor('/etc/config', runtime_dir + '/uci', '');
	let bus = deps.bus || connect();
	assert(uci && bus, 'OpenWrt network services unavailable');
	let owned = deps.owned || create_owned_config(uci);
	let identities = deps.identities || create_identities();
	let routes = deps.routes || create_routes();
	let profiles = { wired: { ...settings.wired }, wifi: { ...settings.wifi } };
	settings.main.mac_pool = shared_pool(settings);
	let fixed = fixed_addresses(settings, { wired: identities.get('wired')?.mac, wifi: identities.get('wifi')?.mac });
	let links = {}, connected = {};
	function command(object, method, failure) {
		bus.call(object, method, {});
		// netifd commands can succeed without a response body
		assert(!bus.error(), failure);
	}
	let route_cache = {};
	let wireless_created = false;
	let interface_journal = deps.interface_journal || private_dir + '/interfaces.json';
	let original_states = read_json(interface_journal, {});
	let read_mac = deps.read_mac || ((device) => trim(fs.readfile('/sys/class/net/' + device + '/address') || ''));

	function configured(role) {
		let p = profiles[role];
		return !!p && (role == 'wifi' && p.mode == 'managed' ? !!p.ssid && !!p.radio : !!p.interface);
	}

	function interfaces_in_zone(iface) {
		let result = [];
		uci.foreach('firewall', 'zone', z => {
			let networks = type(z.network) == 'array' ? z.network : split(z.network || '', /\s+/);
			if (index(networks, iface) >= 0) push(result, z);
		});
		return result;
	}

	function preflight() {
		if (!deps.uci) {
			let pending = cursor();
			for (let config in ['network', 'wireless', 'firewall'])
				assert(!length(keys(pending.changes(config) || {})), 'Apply or revert pending network configuration before starting');
		}
		let private_count = length(filter(['wired', 'wifi'], role => configured(role) && profiles[role].privacy_mac == '1'));
		let minimum = private_count + (settings.main.rotation_mode == 'fixed' ? 0 : 1);
		if (settings.main.rotation_mode == 'fixed') {
			for (let role in ['wired', 'wifi'])
				if (configured(role) && profiles[role].privacy_mac == '1')
					assert(fixed[role], 'fixed_mac_missing');
			if (private_count == 2) assert(fixed.wired != fixed.wifi, 'fixed_mac_conflict');
		}
		else if (private_count) assert(length(settings.main.mac_pool) >= minimum, 'Generate enough shared MAC addresses for the private uplinks and rotation');
		assert(configured(settings.main.preferred_uplink), 'Preferred uplink is not configured');
		for (let service in ['mwan3', 'pbr', 'vpn-policy-routing']) {
			let state = bus.call('service', 'list', { name: service });
			for (let name, instance in (state?.[service]?.instances || {}))
				assert(!instance.running, 'An existing policy routing manager is active');
		}
		for (let role, p in profiles) {
			if (!configured(role)) continue;
			if (role == 'wifi' && p.mode == 'managed') {
				assert(uci.get('wireless', p.radio) == 'wifi-device', 'Select an existing radio');
				assert(length(p.ssid) >= 1 && length(p.ssid) <= 32, 'Invalid Wi-Fi SSID');
				assert(!uci.get('wireless', 'nuitguard_sta') && !uci.get('network', 'nuitguard_wifi'), 'Managed Wi-Fi section name is already in use');
				let zone = null;
				uci.foreach('firewall', 'zone', z => { if (z.name == p.zone) zone = z; });
				assert(zone && zone.masq == '1' && zone.input != 'ACCEPT', 'Select a masquerading uplink firewall zone');
				p.zone_section = zone['.name'];
				p.interface = 'nuitguard_wifi'; p.wifi_section = 'nuitguard_sta';
			}
			else {
				assert(uci.get('network', p.interface) == 'interface' && uci.get('network', p.interface, 'proto') == 'dhcp', 'Select a DHCP uplink interface');
				let zones = interfaces_in_zone(p.interface);
				assert(length(zones) && !length(filter(zones, z => z.input == 'ACCEPT' || z.masq != '1')), 'Selected interface is not in an uplink firewall zone');
				if (role == 'wifi') {
					let sta = uci.get_all('wireless', p.wifi_section);
					assert(sta?.mode == 'sta', 'Select a wireless client configuration');
					let networks = type(sta.network) == 'array' ? sta.network : split(sta.network || '', /\s+/);
					assert(length(networks) == 1 && networks[0] == p.interface, 'Wireless client must belong only to its selected uplink');
					p.radio = sta.device;
				}
				else {
					p.device = uci.get('network', p.interface, 'device');
					assert(p.device && match(p.device, /^[A-Za-z0-9_.:@-]{1,64}$/) && !fs.stat('/sys/class/net/' + p.device + '/bridge'), 'Select a physical Ethernet uplink');
					uci.foreach('network', 'device', d => { if (d.name == p.device) p.device_section = d['.name']; });
					if (!p.device_section) assert(!uci.get('network', 'nuitguard_wired'), 'Managed device section name is already in use');
				}
			}
		}
		assert(!configured('wired') || !configured('wifi') || profiles.wired.interface != profiles.wifi.interface, 'Uplinks must use different interfaces');
		routes.preflight();
	}

	function reload() {
		command('network', 'reload', 'network_reload_failed');
	}

	function reserved_addresses(role) {
		let other = role == 'wired' ? 'wifi' : 'wired';
		return configured(other) && profiles[other].privacy_mac == '1' && identities.get(other)?.mac ? [identities.get(other).mac] : [];
	}

	function prepare(role, rotate) {
		let p = profiles[role];
		assert(configured(role), 'Uplink is not configured');
		if (original_states[p.interface] == null && !(role == 'wifi' && p.mode == 'managed')) {
			original_states[p.interface] = !!bus.call('network.interface.' + p.interface, 'status', {})?.up;
			atomic_json(interface_journal, original_states);
		}
		let fixed_mode = settings.main.rotation_mode == 'fixed';
		let other = role == 'wired' ? 'wifi' : 'wired';
		let mac = p.privacy_mac == '1' ? identities.choose(role, rotate,
			fixed_mode ? [fixed[role]] : settings.main.mac_pool,
			fixed_mode ? [fixed[other]] : reserved_addresses(role)) : null;
		p.fresh_lease = role == 'wifi' || (mac && read_mac(p.device, role) != mac);
		p.started_at = monotonic_seconds();
		if (p.fresh_lease) bus.call('network.interface.' + p.interface, 'down', {});
		if (role == 'wifi') {
			if (p.mode == 'managed' && !wireless_created) {
				owned.create('network', p.interface, 'interface', { proto: 'dhcp', defaultroute: '0', dns_metric: '100' });
				let options = { device: p.radio, mode: 'sta', network: p.interface, ssid: p.ssid, encryption: 'none', disabled: '1' };
				if (mac) options.macaddr = mac;
				if (p.bssid) options.bssid = p.bssid;
				owned.create('wireless', p.wifi_section, 'wifi-iface', options);
				let networks = uci.get('firewall', p.zone_section, 'network') || [];
				if (type(networks) != 'array') networks = split(networks, /\s+/);
				owned.set('firewall', p.zone_section, 'network', [ ...networks, p.interface ]);
				assert((deps.execute || system)(['/etc/init.d/firewall', 'reload'], 15000) == 0, 'Cannot attach managed Wi-Fi to its firewall zone');
				wireless_created = true;
			}
			if (rotate || !connected[role]) owned.set('wireless', p.wifi_section, 'disabled', '1');
			if (mac) owned.set('wireless', p.wifi_section, 'macaddr', mac);
			owned.set('network', p.interface, 'defaultroute', '0');
		}
		else if (mac) {
			if (!p.device_section) {
				p.device_section = 'nuitguard_wired';
				owned.create('network', p.device_section, 'device', { name: p.device, macaddr: mac });
			}
			else owned.set('network', p.device_section, 'macaddr', mac);
		}
		// Apply the disabled STA and its private MAC together before enabling it.
		reload();
		if (role == 'wifi') { owned.set('wireless', p.wifi_section, 'disabled', '0'); reload(); }
		command('network.interface.' + p.interface, 'up', 'uplink_start_failed');
		connected[role] = true; delete route_cache[role];
	}

	function rotation_candidates(role) {
		if (settings.main.rotation_mode == 'fixed' || !configured(role) || profiles[role].privacy_mac != '1') return 0;
		let reserved = reserved_addresses(role), current = identities.get(role)?.mac;
		return length(filter(settings.main.mac_pool, mac => mac != current && index(reserved, mac) < 0));
	}

	function can_rotate(role) { return rotation_candidates(role) > 0; }

	function regenerate_pool(role) {
		if (!can_rotate(role)) return false;
		let pool_uci = deps.pool_uci;
		if (!pool_uci) {
			ensure_directory(runtime_dir + '/pool-uci');
			pool_uci = cursor('/etc/config', runtime_dir + '/pool-uci', '');
		}
		pool_uci.unload('nuitguard');
		let current = shared_pool({
			main: { mac_pool: pool_uci.get('nuitguard', 'main', 'mac_pool') },
			wired: { mac_pool: pool_uci.get('nuitguard', 'wired', 'mac_pool') },
			wifi: { mac_pool: pool_uci.get('nuitguard', 'wifi', 'mac_pool') }
		});
		// Do not replace a pool edited by the user since the daemon started.
		if (sprintf('%J', current) != sprintf('%J', settings.main.mac_pool)) return false;
		let excluded = [...current];
		for (let name in ['wired', 'wifi']) {
			if (identities.get(name)?.mac) push(excluded, identities.get(name).mac);
		}
		let pool = (deps.generate_pool || generate_pool)(length(current), excluded);
		assert(pool_uci.set('nuitguard', 'main', 'mac_pool', pool) && pool_uci.commit('nuitguard'), 'Cannot save replacement MAC pool');
		settings.main.mac_pool = pool;
		return true;
	}


	return {
		can_rotate, rotation_candidates, regenerate_pool, profiles, identities, preflight, configured,
		pool: function() { return settings.main.mac_pool; },
		connect: function(role) { if (!connected[role]) prepare(role, false); else bus.call('network.interface.' + profiles[role].interface, 'up', {}); },
		rotate: function(role) {
			if (!can_rotate(role)) return false;
			prepare(role, true); return true;
		},
		disconnect: function(role) {
			let p = profiles[role];
			if (!configured(role) || (p.mode == 'managed' && !wireless_created)) return;
			if (original_states[p.interface] == null) {
				original_states[p.interface] = !!bus.call('network.interface.' + p.interface, 'status', {})?.up;
				atomic_json(interface_journal, original_states);
			}
			bus.call('network.interface.' + p.interface, 'down', {});
			if (role == 'wifi') { owned.set('wireless', p.wifi_section, 'disabled', '1'); reload(); }
			connected[role] = false; delete route_cache[role]; delete links[role];
		},
		link: function(role) {
			let p = profiles[role];
			if (!configured(role)) return null;
			let status = bus.call('network.interface.' + p.interface, 'status', {});
			let address = status?.['ipv4-address']?.[0]?.address;
			let gateway = filter([ ...(status?.route || []), ...(status?.inactive?.route || []) ],
				r => r.target == '0.0.0.0' && r.mask == 0 && r.nexthop)[0]?.nexthop;
			if (!status?.up || !status.l3_device || !address || !gateway) { delete links[role]; return null; }
			if (p.privacy_mac == '1' && read_mac(status.l3_device, role) != identities.get(role)?.mac) return null;
			if (p.fresh_lease && (status.pending || int(status.uptime) > monotonic_seconds() - p.started_at + 2)) return null;
			p.fresh_lease = false;
			let link = { device: status.l3_device, address, gateway, mac: read_mac(status.l3_device, role) };
			let signature = sprintf('%J', link);
			if (route_cache[role] != signature) { routes.update(role, link); route_cache[role] = signature; }
			links[role] = link;
			return link;
		},
		current_link: function(role) { return links[role]; },
		select: function(role) { routes.select(role); },
		restore: function() {
			assert(routes.restore(), 'Cannot restore owned routes');
			let result = owned.restore();
			if (index(result.changed, 'network') >= 0 || index(result.changed, 'wireless') >= 0) reload();
			if (index(result.changed, 'firewall') >= 0)
				assert((deps.execute || system)(['/etc/init.d/firewall', 'reload'], 15000) == 0, 'Cannot restore firewall zone');
			assert(!length(result.conflicts), 'restoration_conflict');
			for (let iface, up in original_states)
				if (uci.get('network', iface) && !!bus.call('network.interface.' + iface, 'status', {})?.up != up)
					command('network.interface.' + iface, up ? 'up' : 'down', 'interface_restore_failed');
			fs.unlink(interface_journal); original_states = {};
			return true;
		}
	};
};
