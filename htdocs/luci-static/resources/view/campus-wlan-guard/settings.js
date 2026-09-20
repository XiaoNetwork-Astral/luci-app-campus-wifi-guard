'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require ui';

var callReset = rpc.declare({ object: 'nuitguard', method: 'reset', params: ['confirm'], expect: {} });
var callStatus = rpc.declare({ object: 'nuitguard', method: 'status', expect: {} });
var callAction = rpc.declare({ object: 'nuitguard', method: 'action', params: ['action', 'role'], expect: {} });
var callPassword = rpc.declare({ object: 'nuitguard', method: 'set_password', params: ['password', 'clear'], expect: {} });
var callGeneratePool = rpc.declare({ object: 'nuitguard', method: 'generate_pool', params: ['size'], expect: {} });
var callScan = rpc.declare({ object: 'iwinfo', method: 'scan', params: ['device'], expect: { results: [] } });

function numberOption(section, tab, key, title, minimum, maximum, description) {
	var option = (tab ? section.taboption(tab, form.Value, key, title, description) : section.option(form.Value, key, title, description));
	option.rmempty = false;
	option.datatype = 'range(' + minimum + ',' + maximum + ')';
	option.validate = function(section_id, value) {
		return /^(0|[1-9][0-9]*)$/.test(value) &&
			Number(value) >= minimum && Number(value) <= maximum
			? true : _('Enter a whole number from %s to %s').format(minimum, maximum);
	};
	return option;
}

function choiceOption(section, tab, key, title, choices, description) {
	var option = (tab ? section.taboption(tab, form.ListValue, key, title, description) : section.option(form.ListValue, key, title, description));
	option.rmempty = false;
	choices.forEach(function(choice) { option.value(choice[0], choice[1]); });
	return option;
}

function flagOption(section, tab, key, title) {
	var option = (tab ? section.taboption(tab, form.Flag, key, title) : section.option(form.Flag, key, title));
	option.rmempty = false;
	return option;
}

function nested(section, tab, name, type, title, description) {
	var option = section.taboption(tab, form.SectionValue, '_' + name, form.NamedSection, name, type, title, description);
	return option.subsection;
}

function group(section, tab, key, title) {
	return section.taboption(tab, form.SectionValue, '_' + key, form.NamedSection, 'main', 'main', title).subsection;
}

function savedPool() {
	var pool = uci.get('nuitguard', 'main', 'mac_pool');
	if (pool == null) pool = ['wired', 'wifi'].flatMap(function(role) { return uci.get('nuitguard', role, 'mac_pool') || []; });
	if (!Array.isArray(pool)) pool = pool ? [pool] : [];
	return Array.from(new Set(pool.map(function(mac) { return mac.toLowerCase(); })));
}

function when(option, conditions) {
	conditions.forEach(function(condition) { option.depends(condition); });
	option.retain = true;
	return option;
}

function urlOption(section, tab, key, title, optional) {
	var option = (tab ? section.taboption(tab, form.Value, key, title) : section.option(form.Value, key, title));
	option.rmempty = optional;
	option.validate = function(section_id, value) {
		if (optional && !value) return true;
		return value.length <= 2048 && /^https?:\/\/[^/?#@\s]+([/?][^#\s]*)?$/.test(value)
			? true : _('Enter an HTTP or HTTPS URL without credentials or a fragment');
	};
	return option;
}

return view.extend({
	load: function() {
		return Promise.all([uci.load('network'), uci.load('wireless'), uci.load('firewall'), callStatus()]);
	},

	render: function(data) {
		var status = data && data[3] || {};
		var m = new form.Map('nuitguard', _('Campus WLAN Guard'), _('Automatic campus authentication and connection recovery with private MAC addresses'));
		var s = m.section(form.NamedSection, 'main', 'main');
		var main = s;
		var o;
		s.tab('basic', _('General settings'));
		s.tab('auth', _('Authentication'));
		s.tab('uplinks', _('Uplink networks'));
		s.tab('checks', _('Connectivity checks'));
		s.tab('recovery', _('Recovery'));
		s.tab('mac', _('MAC addresses'));
		o = flagOption(s, 'basic', 'enabled', _('Enable Campus WLAN Guard'));
		o.validate = function(section_id, value) {
			if (this.formvalue(section_id) !== '1') return true;
			var field = function(key) { return m.lookupOption(key, 'main')[0].formvalue('main'); };
			var count = 0, fixed = [];
			for (var role of ['wired', 'wifi']) {
				var read = function(key) { return m.lookupOption(key, role)[0].formvalue(role); };
				var configured = role === 'wifi' && read('mode') === 'managed' ? read('radio') && read('ssid') : read('interface');
				if (configured && read('privacy_mac') === '1') {
					count++;
					if (field('rotation_mode') === 'fixed') fixed.push(field('fixed_mac_' + role));
				}
			}
			var minimum = count + (field('rotation_mode') === 'fixed' ? 0 : 1);
			if (field('rotation_mode') === 'fixed') {
				if (fixed.some(function(mac) { return !mac; })) return _('Enter or generate a fixed private MAC for each private uplink');
				if (new Set(fixed.map(function(mac) { return mac.toLowerCase(); })).size !== fixed.length)
					return _('Ethernet and Wi-Fi must use different private MAC addresses');
			}
			if (field('rotation_mode') !== 'fixed' && count && (field('mac_pool') || []).length < minimum)
				return _('The shared pool needs at least %s addresses for these uplinks and the selected MAC policy').format(minimum);
			var account = function(key) { return m.lookupOption(key, 'account')[0].formvalue('account'); };
			return account('username') && account('service_value') && (account('_password') || status.credentials && status.credentials.configured)
				? true : _('Enter the username, service and password before enabling recovery');
		};

		var initialize = s.taboption('basic', form.Button, '_initialize', _('Fully initialize'),
			_('Remove all plugin settings and saved data, then leave the service disabled'));
		initialize.inputtitle = _('Fully initialize'); initialize.inputstyle = 'reset';
		initialize.onclick = function() {
			ui.showModal(_('Fully initialize'), [
				E('p', {}, _('This removes the campus account and password, private MAC addresses, schedules, runtime records and pending plugin changes; router network settings are preserved')),
				E('div', { class: 'right' }, [
					E('button', { class: 'btn', click: ui.hideModal }, _('Cancel')), ' ',
					E('button', { class: 'btn cbi-button-negative', click: async function(event) {
						event.currentTarget.disabled = true;
						try {
							var result = await callReset(true);
							if (result.result !== 'queued') throw new Error(_('Could not start initialization; another operation may be running'));
							ui.showModal(_('Fully initialize'), [E('p', { class: 'spinning' }, _('Stopping the service and restoring network settings before clearing data'))]);
							for (var attempt = 0; attempt < 210; attempt++) {
								await new Promise(function(resolve) { window.setTimeout(resolve, 1000); });
								var current = await callStatus();
								if (current.reset && current.reset.state === 'complete') {
									window.location.href = L.url('admin/services/campus-wlan-guard/settings'); return;
								}
								if (current.reset && current.reset.state === 'failed') throw new Error(
									current.reset.error === 'restore_failed' || current.reset.error === 'stop_failed'
										? _('Could not stop the service or restore its network changes; plugin data was not cleared')
										: _('Initialization could not finish; check the router before trying again'));
							}
							throw new Error(_('Initialization is taking longer than expected; check the status before trying again'));
						}
						catch (error) { ui.hideModal(); ui.addNotification(null, E('p', {}, error.message)); }
					} }, _('Confirm initialization'))
				])
			]);
		};

		choiceOption(s, 'uplinks', 'preferred_uplink', _('Preferred uplink'), [
			['wired', _('Ethernet')], ['wifi', _('Wi-Fi')]
		]);
		choiceOption(s, 'uplinks', 'standby_mode', _('Backup connection mode'), [
			['cold', _('Connect after a failure')], ['warm', _('Keep the backup connected')]
		]);
		var retries = group(main, 'recovery', 'auth_retries', _('Authentication retries'));
		numberOption(retries, null, 'max_auth_retries_per_mac', _('Login attempts with the same MAC'), 1, 100);
		numberOption(retries, null, 'max_cycle_attempts', _('Recovery attempts before cooldown'), 1, 100,
			_('Includes repeated checks when both internet and the login page are unreachable; wait for the configured cooldown after the limit is reached'));
		numberOption(retries, null, 'retry_initial_delay', _('First recovery retry delay (seconds)'), 1, 3600);
		o = numberOption(retries, null, 'retry_max_delay', _('Longest recovery retry delay (seconds)'), 1, 86400);
		var validateDelay = o.validate;
		o.validate = function(section_id, value) {
			var valid = validateDelay.call(this, section_id, value);
			if (valid !== true) return valid;
			var initial = m.lookupOption('retry_initial_delay', 'main')[0].formvalue('main');
			return Number(value) >= Number(initial) ? true : _('Maximum delay must be at least the initial delay');
		};
		var limits = group(main, 'recovery', 'recovery_limits', _('Cooldown and limits'));
		numberOption(limits, null, 'circuit_breaker_cooldown', _('Wait after repeated recovery failures (seconds)'), 1, 604800);
		numberOption(limits, null, 'incident_reset_time', _('Continuous online time to reset retry counts (seconds)'), 1, 604800);
		var switching = group(main, 'recovery', 'switching', _('Failover and return'));
		flagOption(switching, null, 'failover_enabled', _('Automatically switch connections'));
		var failover = [{ failover_enabled: '1' }];
		when(numberOption(switching, null, 'portal_fail_count', _('Failed login-page checks before switching'), 1, 100), failover);
		when(numberOption(switching, null, 'portal_fail_interval', _('Retry interval for login-page detection (seconds)'), 1, 3600), failover);
		when(numberOption(switching, null, 'max_route_switches_per_incident', _('Connection switches per outage'), 0, 100,
			_('Includes switching back to the preferred connection; zero disables switching; counts reset after stable recovery')), failover);
		when(numberOption(switching, null, 'alternate_connect_attempts', _('Backup connection attempts'), 1, 100), failover);
		when(choiceOption(switching, null, 'failback_policy', _('When to return to the preferred connection'), [
			['stable', _('When the preferred connection is stable')], ['on_failure', _('When the current connection fails')],
			['manual', _('Manually')]
		]), failover);
		var stableReturn = [{ failover_enabled: '1', failback_policy: 'stable' }];
		when(numberOption(switching, null, 'primary_recovery_success_count', _('Consecutive successful checks before returning'), 1, 100), stableReturn);
		when(numberOption(switching, null, 'primary_recovery_interval', _('Preferred connection check interval (seconds)'), 1, 86400), stableReturn);
		when(numberOption(switching, null, 'primary_stable_time', _('Continuous online time before returning (seconds)'), 1, 604800), stableReturn);

		choiceOption(s, 'mac', 'rotation_mode', _('When to change the private MAC'), [
			['fixed', _('Fixed private MAC address')], ['offline', _('Change MAC during connection recovery')],
			['scheduled', _('Change MAC on a schedule')]
		]);
		var rotating = [{ rotation_mode: 'offline' }, { rotation_mode: 'scheduled' }];
		when(numberOption(s, 'mac', 'min_rotation_interval', _('Minimum time between MAC changes (seconds)'), 1, 604800), rotating);
		o = when(flagOption(s, 'mac', 'auto_regenerate_pool', _('Rebuild the pool after MAC retries fail')), rotating);
		o.default = '0';
		o.description = _('Generate a new pool after the retries below fail; existing campus device records are not deleted');
		o.validate = function(section_id) {
			return this.formvalue(section_id) !== '1' || Number(m.lookupOption('auth_success_but_offline_rotation_limit', 'main')[0].formvalue('main')) > 0
				? true : _('Set the MAC retry count above zero before enabling automatic pool regeneration');
		};
		var regenerating = [
			{ rotation_mode: 'offline', auto_regenerate_pool: '1' }, { rotation_mode: 'scheduled', auto_regenerate_pool: '1' }
		];
		o = when(numberOption(s, 'mac', 'auth_success_but_offline_rotation_limit', _('MAC retries before rebuilding a pool'), 0, 64,
			_('Try another address from the same pool before rebuilding it; each new pool gets the same number of retries')), regenerating);
		o.default = '1';
		o = when(numberOption(s, 'mac', 'max_pool_regenerations', _('Pool rebuilds per outage'), 1, 10,
			_('Counted separately for Ethernet and Wi-Fi; reset after sustained internet access or a manual resume, not after cooldown')), regenerating);
		o.default = '1';


		var pool = main.taboption('mac', form.DynamicList, 'mac_pool', _('Shared MAC pool'),
			_('Ethernet and Wi-Fi cycle through this list in order; skip the address used by the other connection'));
		when(pool, rotating);
		pool.cfgvalue = savedPool;
		pool.write = function(section_id, value) { uci.set('nuitguard', 'main', 'mac_pool', value && value.length ? value : ''); };
		pool.remove = function() { uci.set('nuitguard', 'main', 'mac_pool', ''); };
		pool.validate = function(section_id, value) {
			if (!value) return true;
			if (!/^[0-9a-f][26ae](:[0-9a-f]{2}){5}$/i.test(value))
				return _('Enter a locally administered unicast MAC address');
			var entries = this.formvalue(section_id) || [];
			return entries.length <= 64 && entries.filter(function(mac) { return mac.toLowerCase() === value.toLowerCase(); }).length <= 1
				? true : _('Use at most 64 distinct MAC addresses');
		};
		var size = numberOption(main, 'mac', '_pool_size', _('Number of MAC addresses to generate'), 1, 64);
		when(size, rotating);
		size.cfgvalue = function() { return String(savedPool().length || 4); };
		size.write = size.remove = function() {};
		var generate = main.taboption('mac', form.Button, '_generate_pool', _('Generate MAC pool'),
			_('Replaces the list above; save and apply to use it; existing campus device records are not removed'));
		when(generate, rotating);
		generate.inputtitle = _('Generate pool'); generate.inputstyle = 'action';
		generate.onclick = function(event) {
			var count = size.formvalue('main'), valid = size.validate('main', count), target = event.currentTarget;
			if (valid !== true) { ui.addNotification(null, E('p', {}, valid)); return; }
			target.disabled = true;
			return callGeneratePool(Number(count)).then(function(result) {
				if (!Array.isArray(result.pool) || result.pool.length !== Number(count)) throw new Error();
				pool.getUIElement('main').setValue(result.pool);
			}).catch(function() { ui.addNotification(null, E('p', {}, _('Could not generate the MAC pool'))); })
				.finally(function() { target.disabled = false; });
		};


		function fixedDefaults() {
			var result = {}, used = [], pool = savedPool();
			['wired', 'wifi'].forEach(function(role) {
				var value = uci.get('nuitguard', 'main', 'fixed_mac_' + role);
				if (value) { result[role] = value.toLowerCase(); used.push(result[role]); }
			});
			['wired', 'wifi'].forEach(function(role) {
				if (result[role]) return;
				result[role] = [status.private_macs && status.private_macs[role]].concat(pool).find(function(mac) { return mac && used.indexOf(mac) < 0; }) || '';
				if (result[role]) used.push(result[role]);
			});
			return result;
		}
		['wired', 'wifi'].forEach(function(role) {
			var dependency = { rotation_mode: 'fixed' };
			dependency['nuitguard.' + role + '.privacy_mac'] = '1';
			var address = when(main.taboption('mac', form.Value, 'fixed_mac_' + role,
				role === 'wired' ? _('Fixed private MAC for Ethernet') : _('Fixed private MAC for Wi-Fi'),
				_('Enter an address or generate one; it stays unchanged until you edit and apply it')), [dependency]);
			address.cfgvalue = function() { return fixedDefaults()[role]; };
			address.validate = function(section_id, value) {
				return !value || /^[0-9a-f][26ae](:[0-9a-f]{2}){5}$/i.test(value) ? true : _('Enter a locally administered unicast MAC address');
			};
			address.write = function(section_id, value) { uci.set('nuitguard', 'main', 'fixed_mac_' + role, value.toLowerCase()); };
			var original = address.renderWidget;
			address.renderWidget = function(section_id) {
				var node = original.apply(this, arguments);
				var button = E('button', { type: 'button', class: 'cbi-button cbi-button-action', disabled: m.readonly,
					click: function(event) {
						var target = event.currentTarget;
						target.disabled = true;
						return callGeneratePool(2).then(function(result) {
							var other = m.lookupOption('fixed_mac_' + (role === 'wired' ? 'wifi' : 'wired'), 'main')[0].formvalue('main');
							var candidate = (result.pool || []).find(function(mac) { return mac.toLowerCase() !== String(other || '').toLowerCase(); });
							if (!candidate) throw new Error();
							address.getUIElement('main').setValue(candidate);
						}).catch(function() { ui.addNotification(null, E('p', {}, _('Could not generate a private MAC address'))); })
							.finally(function() { target.disabled = m.readonly; });
					}
				}, _('Generate'));
				return E('div', { class: 'cwg-fixed-mac' }, [node, button]);
			};
		});

		numberOption(s, 'uplinks', 'reconnect_timeout', _('Wait for a network address (seconds)'), 1, 600,
			_('Also wait up to this long after login for the campus network to assign an online address'));

		['wired', 'wifi'].forEach(function(role) {
			var section = nested(main, 'uplinks', role, 'uplink', role === 'wired' ? _('Ethernet') : _('Wi-Fi'));
			if (role === 'wifi') {
				var mode = section.option(form.ListValue, 'mode', _('Wireless configuration mode'));
				mode.rmempty = false;
				mode.value('existing', _('Use an existing wireless client'));
				mode.value('managed', _('Create an open network client'));
			}
			var iface = section.option(form.ListValue, 'interface', _('Network interface'));
			if (role === 'wifi') { iface.depends('mode', 'existing'); iface.retain = true; }
			iface.value('', _('Not configured'));
			var networks = uci.sections('network', 'interface').filter(function(network) { return network['.name'] !== 'loopback'; });
			networks.forEach(function(network) { iface.value(network['.name']); });
			iface.validate = function(section_id, value) {
				if (!value) return true;
				if (!networks.some(function(network) { return network['.name'] === value; }))
					return _('Select an existing network interface');
				var other = m.lookupOption('interface', role === 'wired' ? 'wifi' : 'wired');
				return !other || value !== other[0].formvalue(role === 'wired' ? 'wifi' : 'wired')
					? true : _('Choose different interfaces for Ethernet and Wi-Fi');
			};
			var privacy = section.option(form.Flag, 'privacy_mac', _('Use a private MAC address'));
			privacy.rmempty = false;
			if (role === 'wifi') {
				var station = section.option(form.ListValue, 'wifi_section', _('Wireless client configuration'),
					_('Select an existing wireless client; Create one in Network → Wireless if needed'));
				station.value('', _('Not configured'));
				station.depends('mode', 'existing'); station.retain = true;
				uci.sections('wireless', 'wifi-iface').filter(function(entry) { return entry.mode === 'sta'; }).forEach(function(entry) {
					station.value(entry['.name'], entry.ssid || entry['.name']);
				});
				var radio = section.option(form.ListValue, 'radio', _('Wireless radio'),
					_('A radio shared with a local access point may change channel and briefly disconnect its clients when the uplink connects'));
				radio.depends('mode', 'managed'); radio.retain = true;
				radio.value('', _('Select a radio'));
				uci.sections('wireless', 'wifi-device').forEach(function(entry) { radio.value(entry['.name'], entry['.name'] + (entry.band ? ' (' + entry.band + ')' : '')); });
				var entries = {};
				var network = section.option(form.Value, '_network', _('Campus Wi-Fi network'));
				network.depends('mode', 'managed'); network.retain = true;
				network.load = function() {
					// Reload from UCI after Save, including changes which are not yet applied
					var savedSSID = uci.get('nuitguard', 'wifi', 'ssid') || '';
					var savedBSSID = uci.get('nuitguard', 'wifi', 'bssid') || '';
					entries = savedSSID ? { _saved: { ssid: savedSSID, bssid: savedBSSID } } : {};
					return uci.get('nuitguard', 'wifi', 'network_selection') === 'custom' ? '_custom' : savedSSID ? '_saved' : '';
				};
				network.validate = function(section_id, value) {
					return !value || value === '_custom' || entries[value] ? true : _('Select a network or enter a custom SSID');
				};
				network.rmempty = false;
				network.write = function(section_id, value) {
					uci.set('nuitguard', 'wifi', 'network_selection', value === '_custom' ? 'custom' : 'scan');
					if (entries[value]) { uci.set('nuitguard', 'wifi', 'ssid', entries[value].ssid); uci.set('nuitguard', 'wifi', 'bssid', entries[value].bssid); }
				};
				network.remove = function() {};
				network.renderWidget = function(section_id, option_index, cfgvalue) {
					var labels = { '': _('Select a network'), _custom: _('Custom network') };
					if (entries._saved) labels._saved = entries._saved.ssid + (entries._saved.bssid ? ' (' + entries._saved.bssid.toUpperCase() + ')' : '');
					var widget = new ui.Dropdown(cfgvalue, labels, { id: this.cbid(section_id), optional: true, sort: false, select_placeholder: _('Select a network'), validate: this.getValidator(section_id) });
					var open = widget.openDropdown, busy = false, note = E('span', { class: 'cwg-scan-note', role: 'status' });
					widget.openDropdown = function(node) {
						if (busy) return;
						var selectedRadio = radio.formvalue('wifi');
						if (!selectedRadio) { note.textContent = _('Select a radio first'); return open.call(widget, node); }
						busy = true; note.textContent = _('Scanning networks'); node.setAttribute('aria-busy', 'true');
						return callScan(selectedRadio).then(function(results) {
							if (radio.formvalue('wifi') !== selectedRadio) return;
							var choices = { '': _('Select a network'), _custom: _('Custom network') };
							var found = results.filter(function(entry) { return entry.ssid && /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(entry.bssid || '') && entry.encryption && entry.encryption.enabled === false; });
							found.sort(function(a, b) { return a.ssid.localeCompare(b.ssid) || (b.signal || -100) - (a.signal || -100); });
							var selected = widget.getValue(), next = {};
							if (entries[selected]) { next[selected] = entries[selected]; choices[selected] = entries[selected].ssid + (entries[selected].bssid ? ' (' + entries[selected].bssid.toUpperCase() + ')' : ''); }
							found.forEach(function(entry) {
								var key = entry.bssid.toLowerCase();
								next[key] = { ssid: entry.ssid, bssid: key };
								choices[key] = entry.ssid + ' (' + key.toUpperCase() + ')';
							});
							entries = next; widget.clearChoices(false); widget.addChoices(Object.keys(choices), choices);
							note.textContent = found.length ? '' : _('No open networks found; you can enter a custom network');
						}).catch(function() { note.textContent = _('Wireless scan failed; you can enter a custom network'); })
							.finally(function() { busy = false; node.removeAttribute('aria-busy'); if (node.isConnected && node.getClientRects().length && radio.formvalue('wifi') === selectedRadio) open.call(widget, node); });
					};
					return E('div', { class: 'cwg-network-select' }, [widget.render(), note]);
				};
				var ssid = section.option(form.Value, 'ssid', _('Campus Wi-Fi SSID'));
				ssid.depends({ mode: 'managed', _network: '_custom' }); ssid.retain = true; ssid.datatype = 'maxlength(32)';
				ssid.validate = function(section_id, value) {
					if (m.lookupOption('mode', 'wifi')[0].formvalue('wifi') !== 'managed') return true;
					return value && new TextEncoder().encode(value).length <= 32 ? true : _('Enter an SSID of 1 to 32 bytes');
				};
				var bssid = section.option(form.Value, 'bssid', _('Optional access point BSSID'));
				bssid.depends({ mode: 'managed', _network: '_custom' }); bssid.retain = true; bssid.datatype = 'macaddr';
				network.onchange = function(event, section_id, value) {
					if (entries[value]) { ssid.getUIElement('wifi').setValue(entries[value].ssid); bssid.getUIElement('wifi').setValue(entries[value].bssid); }
				};
				radio.onchange = function() {
					var control = network.getUIElement('wifi');
					if (control && control.getValue() !== '_custom') { control.setValue(''); ssid.getUIElement('wifi').setValue(''); bssid.getUIElement('wifi').setValue(''); }
				};
				var zone = section.option(form.ListValue, 'zone', _('Uplink firewall zone'));
				zone.depends('mode', 'managed'); zone.retain = true; zone.rmempty = false;
				uci.sections('firewall', 'zone').filter(function(entry) { return entry.masq === '1' && entry.input !== 'ACCEPT'; }).forEach(function(entry) { zone.value(entry.name); });
			}
		});

		var accounts = nested(main, 'auth', 'account', 'account', _('Campus account'));
		function accountOption(type, key, title, description) {
			var option = accounts.option(type, key, title, description);
			return option;
		}
		o = accountOption(form.Value, 'username', _('Username'));
		var renderUsername = o.renderWidget;
		o.renderWidget = function() { var node = renderUsername.apply(this, arguments); node.querySelector('input').autocomplete = 'off'; return node; };
		o = accountOption(form.Value, '_password', _('Password'), _('Leave blank to keep the saved password; enter and save a new password to replace it'));
		o.password = true;
		var renderPassword = o.renderWidget;
		o.renderWidget = function() {
			var node = renderPassword.apply(this, arguments), input = node.querySelector('input'), toggle = node.querySelector('button');
			input.autocomplete = 'new-password'; node.classList.add('cwg-password');
			var update = function() {
				if (!input.value) input.type = 'password';
				toggle.textContent = input.type === 'password' ? _('Show') : _('Hide');
				toggle.setAttribute('aria-pressed', String(input.type !== 'password'));
				toggle.setAttribute('aria-label', input.type === 'password' ? _('Show entered password') : _('Hide entered password'));
				toggle.title = toggle.getAttribute('aria-label'); toggle.disabled = !input.value || input.disabled;
			};
			input.type = 'password'; toggle.type = 'button';
			input.addEventListener('input', update); toggle.addEventListener('click', update); update();
			return node;
		};
		o.placeholder = status.credentials && status.credentials.configured ? _('Password is saved') : _('No password saved');
		o.cfgvalue = function() { return ''; };
		o.write = function(section_id, value) {
			if (!value) return Promise.resolve();
			var option = this;
			return callPassword(value, false).then(function(result) {
				if (!result.configured) throw new Error(_('Could not save the password'));
				status.credentials = { configured: true };
				option.placeholder = _('Password is saved');
			});
		};
		o.remove = function() {};
		o = accountOption(form.Value, 'service_value', _('Account type'), _('Choose Student or Staff, or enter the service identifier used by your campus'));
		o.value('default', _('Student')); o.value('Teacher', _('Staff'));
		var authenticate = accountOption(form.Button, '_authenticate', _('Authenticate now'),
			_('Uses the applied account settings on the active connection, or the preferred connection before one is active'));
		authenticate.inputtitle = _('Authenticate now'); authenticate.inputstyle = 'action';
		authenticate.onclick = function(event) {
			var target = event.currentTarget;
			var changed = ['username', 'service_value'].some(function(key) {
				return String(m.lookupOption(key, 'account')[0].formvalue('account') || '') !== String(uci.get('nuitguard', 'account', key) || '');
			}) || !!m.lookupOption('_password', 'account')[0].formvalue('account');
			if (changed) { ui.addNotification(null, E('p', {}, _('Save and apply the account settings before authenticating'))); return; }
			target.disabled = true;
			return uci.changes().then(function(changes) {
				if ((changes.nuitguard || []).length) {
					ui.addNotification(null, E('p', {}, _('Save and apply the account settings before authenticating')));
					return;
				}
				return callStatus().then(function(current) {
					if (!current.running) {
						var reasons = {
							internet_check_not_configured: _('Configure an internet check URL before enabling recovery'),
							credentials_missing: _('Campus credentials are missing'),
							configuration_invalid: _('The saved configuration is invalid; review the settings before starting')
						};
						ui.addNotification(null, E('p', {}, current.enabled
							? reasons[current.reason] || _('The service is enabled but is not running; check the status page for the startup result')
							: _('Enable the service and apply the settings before authenticating')));
						return;
					}
					if (current.blocked) {
						ui.addNotification(null, E('p', {}, _('Resume recovery on the status page before authenticating')));
						return;
					}
					return callAction('authenticate', current.active || uci.get('nuitguard', 'main', 'preferred_uplink') || 'wired').then(function(result) {
						var message = result.result === 'queued' ? _('Authentication requested; check the status page for the result') :
							result.result === 'busy' ? _('Another action is already queued') :
							result.result === 'service_not_running' ? _('Enable the service and apply the settings before authenticating') : _('Could not submit the action');
						ui.addNotification(null, E('p', {}, message));
					});
				});
			}).catch(function() { ui.addNotification(null, E('p', {}, _('Could not submit the action'))); })
				.finally(function() { target.disabled = m.readonly; });
		};
		var portal = group(main, 'auth', 'portal', _('Authentication portal'));
		urlOption(portal, null, 'portal_probe_url', _('URL used to find the login page'), false);
		o = urlOption(portal, null, 'portal_origin', _('Campus login server address'), false);
		o.description = _('Send login details only to this server; include the scheme and optional port, without a path');
		o.validate = function(section_id, value) {
			return /^https?:\/\/[^/?#@\s]+$/.test(value) ? true : _('Enter an HTTP or HTTPS origin without a path');
		};
		numberOption(portal, null, 'max_portal_discovery_retries', _('Attempts to find the campus login page'), 1, 100);

		choiceOption(s, 'basic', 'log_level', _('Log level'), [
			['error', _('Errors')], ['warn', _('Warnings')], ['info', _('Information')], ['debug', _('Debug')]
		]);

		var checks = group(main, 'checks', 'internet_check', _('Internet access check'));
		o = urlOption(checks, null, 'internet_probe_url', _('Internet check URL'), true);
		var internetPresets = [
			['http://connect.rom.miui.com/generate_204', _('Xiaomi')],
			['http://connectivitycheck.platform.hicloud.com/generate_204', _('Huawei')],
			['http://wifi.vivo.com.cn/generate_204', _('vivo')]
		];
		internetPresets.forEach(function(preset) { o.value(preset[0], preset[1] + ' (HTTP 204)'); });
		o.onchange = function(event, section_id, value) {
			if (internetPresets.some(function(preset) { return preset[0] === value; })) {
				m.lookupOption('internet_expected_status', 'main')[0].getUIElement('main').setValue('204');
				m.checkDepends();
			}
		};
		o.description = _('Choose a preset or enter a custom URL; presets use HTTP 204 with an empty response');
		var validateInternetURL = o.validate;
		o.validate = function(section_id, value) {
			if (!value && m.lookupOption('enabled', 'main')[0].formvalue('main') === '1')
				return _('Configure an internet check URL before enabling recovery');
			return validateInternetURL.call(this, section_id, value);
		};
		numberOption(checks, null, 'internet_expected_status', _('HTTP status returned when online'), 200, 299,
			_('Use the status code normally returned by the check URL; 204 must have no body, other codes must also match the text below'));
		o = checks.option(form.TextValue, 'internet_expected_body', _('Response text returned when online'),
			_('Enter the complete text normally returned by the check URL; only leading and trailing whitespace is ignored'));
		o.rows = 2; o.datatype = 'maxlength(4096)';
		o.depends({ internet_expected_status: '204', '!reverse': true }); o.retain = true;
		o.validate = function(section_id, value) {
			return m.lookupOption('enabled', 'main')[0].formvalue('main') !== '1' ||
				m.lookupOption('internet_expected_status', 'main')[0].formvalue('main') === '204' || String(value || '').trim().length > 0
				? true : _('Enter the expected response body before enabling a non-204 internet check');
		};
		numberOption(checks, null, 'probe_interval', _('Check interval while online (seconds)'), 1, 86400);
		numberOption(checks, null, 'probe_timeout', _('Timeout for each connectivity check (seconds)'), 1, 120);
		var confirmation = group(main, 'checks', 'outage_confirmation', _('Outage confirmation'));
		numberOption(confirmation, null, 'offline_confirm_count', _('Consecutive failed checks to confirm an outage'), 1, 100);
		numberOption(confirmation, null, 'offline_confirm_interval', _('Check interval while confirming an outage (seconds)'), 1, 3600);
		numberOption(confirmation, null, 'max_post_auth_verify_failures', _('Internet checks after a successful login'), 1, 100,
			_('One successful check confirms internet access; repeated failures continue the recovery process'));

		s = nested(main, 'mac', 'schedule', 'schedule', _('Scheduled MAC changes'));
		when(s.parentoption, [{ rotation_mode: 'scheduled' }]);
		o = s.option(form.Flag, 'enabled', _('Enable scheduled MAC changes'));
		o.rmempty = false;
		o = s.option(form.ListValue, 'type', _('Schedule type'));
		when(o, [{ enabled: '1' }]);
		o.rmempty = false;
		o.value('daily', _('Daily'));
		o.value('interval', _('Every N hours'));
		o.value('weekly', _('Weekly'));
		o = s.option(form.Value, 'time', _('Time (router time zone)'));
		o.depends({ enabled: '1', type: 'daily' });
		o.depends({ enabled: '1', type: 'weekly' });
		o.rmempty = false;
		o.retain = true;
		o.validate = function(section_id, value) {
			return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value) ? true : _('Enter a time in HH:MM format');
		};
		o = s.option(form.Value, 'interval_hours', _('Time between scheduled changes (hours)'));
		o.depends({ enabled: '1', type: 'interval' });
		o.rmempty = false;
		o.retain = true;
		o.datatype = 'and(uinteger,range(1,8760))';
		o.validate = function(section_id, value) {
			return /^[1-9][0-9]*$/.test(value) && Number(value) <= 8760
				? true : _('Enter a whole number from %s to %s').format(1, 8760);
		};
		o = s.option(form.ListValue, 'weekday', _('Day of the week'));
		o.depends({ enabled: '1', type: 'weekly' });
		o.rmempty = false;
		o.retain = true;
		[_('Monday'), _('Tuesday'), _('Wednesday'), _('Thursday'), _('Friday'), _('Saturday'), _('Sunday')].forEach(function(day, index) {
			o.value(String(index + 1), day);
		});
		o = s.option(form.Flag, 'logout_first', _('Log out of the campus network before a scheduled MAC change'),
			_('Try to end the current connection login, then change MAC and sign in again'));

		o.rmempty = false;
		when(o, [{ enabled: '1' }]);
		// Keep schedule values when the entire subsection is hidden by the MAC policy.
		s.children.forEach(function(option) { option.retain = true; });
		// Map.save() replaces the map contents; keep the stylesheet outside that subtree
		if (!document.getElementById('cwg-settings-style'))
			document.head.appendChild(E('link', { id: 'cwg-settings-style', rel: 'stylesheet', href: L.resource('campus-wlan-guard/style.css') }));
		return m.render().then(function(node) {
			node.classList.add('cwg-settings');
			var tab = new URLSearchParams(window.location.search).get('section');
			if (['basic', 'auth', 'uplinks', 'checks', 'recovery', 'mac'].indexOf(tab) >= 0)
				requestAnimationFrame(function() {
					var link = node.querySelector('.cbi-tabmenu [data-tab="' + tab + '"] a');
					if (link) link.click();
				});
			return node;
		});
	}
});
