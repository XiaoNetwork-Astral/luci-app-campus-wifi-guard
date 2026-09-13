'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require ui';

var callStatus = rpc.declare({ object: 'nuitguard', method: 'status', expect: {} });
var callPassword = rpc.declare({ object: 'nuitguard', method: 'set_password', params: ['password', 'clear'], expect: {} });
var callScan = rpc.declare({ object: 'iwinfo', method: 'scan', params: ['device'], expect: { results: [] } });

function numberOption(section, tab, key, title, minimum, maximum, description) {
	var option = section.taboption(tab, form.Value, key, title, description);
	option.rmempty = false;
	option.datatype = 'range(' + minimum + ',' + maximum + ')';
	option.validate = function(section_id, value) {
		return /^(0|[1-9][0-9]*)$/.test(value) &&
			Number(value) >= minimum && Number(value) <= maximum
			? true : _('Enter a whole number from %s to %s.').format(minimum, maximum);
	};
	return option;
}

function choiceOption(section, tab, key, title, choices, description) {
	var option = section.taboption(tab, form.ListValue, key, title, description);
	option.rmempty = false;
	choices.forEach(function(choice) { option.value(choice[0], choice[1]); });
	return option;
}

function flagOption(section, tab, key, title) {
	var option = section.taboption(tab, form.Flag, key, title);
	option.rmempty = false;
	return option;
}

function group(section, tab, key, title, description) {
	var option = section.taboption(tab, form.DummyValue, '_' + key);
	option.render = function() {
		return E('div', { class: 'ng-group-heading' }, [E('strong', {}, title), description ? E('p', {}, description) : '']);
	};
	return option;
}

function nested(section, tab, name, type, title, description) {
	var option = section.taboption(tab, form.SectionValue, '_' + name, form.NamedSection, name, type, title, description);
	return option.subsection;
}

function when(option, conditions) {
	conditions.forEach(function(condition) { option.depends(condition); });
	option.retain = true;
	return option;
}

function urlOption(section, tab, key, title, optional) {
	var option = section.taboption(tab, form.Value, key, title);
	option.rmempty = optional;
	option.validate = function(section_id, value) {
		if (optional && !value) return true;
		return value.length <= 2048 && /^https?:\/\/[^/?#@\s]+([/?][^#\s]*)?$/.test(value)
			? true : _('Enter an HTTP or HTTPS URL without credentials or a fragment.');
	};
	return option;
}

return view.extend({
	load: function() {
		return Promise.all([uci.load('network'), uci.load('wireless'), uci.load('firewall'), callStatus()]);
	},

	render: function(data) {
		var status = data && data[3] || {};
		var m = new form.Map('nuitguard', _('NuitGuard'),
			_('Campus sign-in and automatic connection recovery. Start with your account and uplinks; tune recovery only when needed.'));
		var s = m.section(form.NamedSection, 'main', 'main');
		var main = s;
		var o;
		s.tab('basic', _('Basic settings'));
		s.tab('uplinks', _('Uplink networks'));
		s.tab('recovery', _('Recovery'));
		s.tab('mac', _('Privacy and schedule'));
		s.tab('advanced', _('Advanced settings'));
		group(s, 'basic', 'service', _('Automatic recovery'), _('Save and apply restarts NuitGuard with your configuration.'));
		o = flagOption(s, 'basic', 'enabled', _('Enable NuitGuard'));
		o.validate = function(section_id, value) {
			if (value !== '1') return true;
			var field = function(key) { return m.lookupOption(key, 'account')[0].formvalue('account'); };
			return field('username') && field('service_value') && (field('_password') || status.credentials && status.credentials.configured)
				? true : _('Enter the username, service and password before enabling recovery.');
		};

		group(s, 'uplinks', 'selection', _('Uplink preference'), _('Choose the connection to use first, then configure Ethernet and Wi-Fi below.'));
		choiceOption(s, 'uplinks', 'preferred_uplink', _('Preferred uplink'), [
			['wired', _('Ethernet')], ['wifi', _('Wi-Fi')]
		]);
		choiceOption(s, 'uplinks', 'standby_mode', _('Standby mode'), [
			['cold', _('Connect when needed')], ['warm', _('Keep connected')]
		]);
		group(s, 'recovery', 'detect', _('1. Confirm the outage'), _('Internet checks determine whether recovery is needed. A portal timeout alone does not mean the connection is offline.'));
		numberOption(s, 'recovery', 'offline_confirm_count', _('Failed checks before recovery'), 1, 100);
		numberOption(s, 'recovery', 'offline_confirm_interval', _('Failure confirmation interval (seconds)'), 1, 3600);
		group(s, 'recovery', 'retry', _('2. Retry authentication'), _('Limit attempts and wait between retries to avoid reconnecting continuously.'));
		numberOption(s, 'recovery', 'max_auth_retries_per_mac', _('Authentication attempts per MAC'), 1, 100);
		numberOption(s, 'recovery', 'max_cycle_attempts', _('Recovery attempts per outage'), 1, 100);
		numberOption(s, 'recovery', 'retry_initial_delay', _('Initial retry delay (seconds)'), 1, 3600);
		o = numberOption(s, 'recovery', 'retry_max_delay', _('Maximum retry delay (seconds)'), 1, 86400);
		var validateDelay = o.validate;
		o.validate = function(section_id, value) {
			var valid = validateDelay.call(this, section_id, value);
			if (valid !== true) return valid;
			var initial = m.lookupOption('retry_initial_delay', 'main')[0].formvalue('main');
			return Number(value) >= Number(initial) ? true : _('Maximum delay must be at least the initial delay.');
		};
		numberOption(s, 'recovery', 'circuit_breaker_cooldown', _('Cooldown after repeated failure (seconds)'), 1, 604800);
		group(s, 'recovery', 'switching', _('3. Switch and return'), _('Failover uses the other configured uplink. Return rules control when the preferred connection takes over again.'));
		flagOption(s, 'recovery', 'failover_enabled', _('Allow failover'));
		var failover = [{ failover_enabled: '1' }];
		when(numberOption(s, 'recovery', 'max_route_switches_per_incident', _('Maximum switches per outage'), 0, 100,
			_('Zero disables automatic switching. The budget resets after a stable connection.')), failover);
		when(numberOption(s, 'recovery', 'alternate_connect_attempts', _('Connection attempts on the alternate uplink'), 1, 100), failover);
		when(choiceOption(s, 'recovery', 'failback_policy', _('Return to the preferred uplink'), [
			['stable', _('After stable recovery')], ['on_failure', _('When the alternate uplink fails')],
			['manual', _('Manually')]
		]), failover);
		var stableReturn = [{ failover_enabled: '1', failback_policy: 'stable' }];
		when(numberOption(s, 'recovery', 'primary_recovery_success_count', _('Successful checks before returning'), 1, 100), stableReturn);
		when(numberOption(s, 'recovery', 'primary_recovery_interval', _('Recovery check interval (seconds)'), 1, 86400), stableReturn);
		when(numberOption(s, 'recovery', 'primary_stable_time', _('Stable time before returning (seconds)'), 1, 604800), stableReturn);

		group(s, 'mac', 'privacy', _('Private MAC policy'), _('Enable a private MAC for each connection in Uplink networks. Choose here whether and when that address changes.'));
		choiceOption(s, 'mac', 'rotation_mode', _('MAC policy'), [
			['fixed', _('Fixed private MAC')], ['offline', _('Rotate during recovery')],
			['scheduled', _('Rotate on schedule')]
		]);
		var rotating = [{ rotation_mode: 'offline' }, { rotation_mode: 'scheduled' }];
		when(numberOption(s, 'mac', 'min_rotation_interval', _('Minimum rotation interval (seconds)'), 1, 604800), rotating);
		when(numberOption(s, 'mac', 'max_rotations_per_incident', _('Maximum rotations per outage'), 0, 100), [{ rotation_mode: 'offline' }]);
		when(numberOption(s, 'mac', 'recent_mac_history', _('Recent MAC addresses to avoid'), 1, 256), rotating);
		when(numberOption(s, 'mac', 'auth_success_but_offline_rotation_limit', _('Extra rotations after authentication succeeds but internet fails'), 0, 1), [{ rotation_mode: 'offline' }]);

		group(s, 'advanced', 'portal', _('Campus portal'), _('Keep these values unless your campus uses a different portal.'));
		urlOption(s, 'advanced', 'portal_probe_url', _('Portal discovery URL'), false);
		o = urlOption(s, 'advanced', 'portal_origin', _('Expected portal origin'), false);
		o.description = _('Authentication is sent only to this origin. Include the scheme and optional port, with no path.');
		o.validate = function(section_id, value) {
			return /^https?:\/\/[^/?#@\s]+$/.test(value) ? true : _('Enter an HTTP or HTTPS origin without a path.');
		};
		o = s.taboption('advanced', form.Value, '_service_label', _('Optional service display name'), _('Leave blank to use the account type selected in Basic settings.'));
		o.ucisection = 'account'; o.ucioption = 'service_label';
		group(s, 'advanced', 'thresholds', _('Detailed timing and limits'));
		when(numberOption(s, 'advanced', 'portal_fail_count', _('Failed portal checks before failover'), 1, 100), failover);
		when(numberOption(s, 'advanced', 'portal_fail_interval', _('Portal failure check interval (seconds)'), 1, 3600), failover);
		numberOption(s, 'advanced', 'max_portal_discovery_retries', _('Portal discovery attempts'), 1, 100);
		numberOption(s, 'advanced', 'max_post_auth_verify_failures', _('Internet checks after authentication'), 1, 100);
		numberOption(s, 'advanced', 'reconnect_timeout', _('Connection timeout (seconds)'), 1, 600);
		numberOption(s, 'advanced', 'incident_reset_time', _('Stable time to reset retry budgets (seconds)'), 1, 604800);
		choiceOption(s, 'advanced', 'log_level', _('Log level'), [
			['error', _('Errors')], ['warn', _('Warnings')], ['info', _('Information')], ['debug', _('Debug')]
		]);

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
					return _('Select an existing network interface.');
				var other = m.lookupOption('interface', role === 'wired' ? 'wifi' : 'wired');
				return !other || value !== other[0].formvalue(role === 'wired' ? 'wifi' : 'wired')
					? true : _('Choose different interfaces for Ethernet and Wi-Fi.');
			};
			var privacy = section.option(form.Flag, 'privacy_mac', _('Use a private MAC address'));
			privacy.rmempty = false;
			if (role === 'wifi') {
				var station = section.option(form.ListValue, 'wifi_section', _('Wireless client configuration'),
					_('Select an existing wireless client. Create one in Network → Wireless if needed.'));
				station.value('', _('Not configured'));
				station.depends('mode', 'existing'); station.retain = true;
				uci.sections('wireless', 'wifi-iface').filter(function(entry) { return entry.mode === 'sta'; }).forEach(function(entry) {
					station.value(entry['.name'], entry.ssid || entry['.name']);
				});
				var radio = section.option(form.ListValue, 'radio', _('Wireless radio'),
					_('A radio shared with a local access point may change channel and briefly disconnect its clients when the uplink connects.'));
				radio.depends('mode', 'managed'); radio.retain = true;
				radio.value('', _('Select a radio'));
				uci.sections('wireless', 'wifi-device').forEach(function(entry) { radio.value(entry['.name'], entry['.name'] + (entry.band ? ' (' + entry.band + ')' : '')); });
				var ssid = section.option(form.Value, 'ssid', _('Campus Wi-Fi SSID'));
				ssid.depends('mode', 'managed'); ssid.retain = true; ssid.datatype = 'maxlength(32)';
				ssid.validate = function(section_id, value) {
					if (m.lookupOption('mode', 'wifi')[0].formvalue('wifi') !== 'managed') return true;
					return value && new TextEncoder().encode(value).length <= 32 ? true : _('Enter an SSID of 1 to 32 bytes.');
				};
				var scan = section.option(form.Button, '_scan', _('Find open networks'));
				scan.depends('mode', 'managed'); scan.inputtitle = _('Scan'); scan.inputstyle = 'action';
				scan.onclick = function() {
					var selectedRadio = radio.formvalue('wifi');
					if (!selectedRadio) { ui.addNotification(null, E('p', {}, _('Select a radio first.'))); return; }
					return callScan(selectedRadio).then(function(results) {
						var names = Array.from(new Set(results.filter(function(entry) { return entry.ssid && entry.encryption && entry.encryption.enabled === false; }).map(function(entry) { return entry.ssid; }))).sort();
						if (!names.length) { ui.addNotification(null, E('p', {}, _('No open networks found. You can enter the SSID manually.'))); return; }
						var select = E('select', { class: 'cbi-input-select' }, names.map(function(name) { return E('option', { value: name }, name); }));
						ui.showModal(_('Select a campus network'), [select, E('div', { class: 'right' }, [
							E('button', { class: 'btn', click: ui.hideModal }, _('Cancel')),
							' ', E('button', { class: 'btn cbi-button-positive', click: function() { ssid.getUIElement('wifi').setValue(select.value); ui.hideModal(); } }, _('Use selected network'))
						])]);
					}).catch(function(error) { ui.addNotification(null, E('p', {}, _('Wireless scan failed.'))); });
				};
				var bssid = section.option(form.Value, 'bssid', _('Optional access point BSSID'));
				bssid.depends('mode', 'managed'); bssid.retain = true; bssid.datatype = 'macaddr';
				var zone = section.option(form.ListValue, 'zone', _('Uplink firewall zone'));
				zone.depends('mode', 'managed'); zone.retain = true; zone.rmempty = false;
				uci.sections('firewall', 'zone').filter(function(entry) { return entry.masq === '1' && entry.input !== 'ACCEPT'; }).forEach(function(entry) { zone.value(entry.name); });
			}
		});

		s = nested(main, 'basic', 'account', 'account', _('Campus account'));
		s.option(form.Value, 'username', _('Username'));
		o = s.option(form.Value, '_password', _('Password'), _('Leave blank to keep the saved password.'));
		o.password = true;
		o.placeholder = status.credentials && status.credentials.configured ? _('Password is saved') : _('No password saved');
		o.cfgvalue = function() { return ''; };
		o.write = function(section_id, value) {
			if (!value) return Promise.resolve();
			var option = this;
			return callPassword(value, false).then(function(result) {
				if (!result.configured) throw new Error(_('Could not save the password.'));
				status.credentials = { configured: true };
				option.placeholder = _('Password is saved');
			});
		};
		o.remove = function() {};
		if (status.credentials && status.credentials.configured) {
			o = s.option(form.Button, '_clear_password', _('Saved password'));
			o.inputtitle = _('Remove saved password'); o.inputstyle = 'neutral';
			o.onclick = function(event) {
				var target = event.currentTarget;
				return callPassword('', true).then(function() {
					status.credentials.configured = false;
					target.closest('.cbi-value').hidden = true;
					var field = document.getElementById('widget.cbid.nuitguard.account._password');
					if (field) field.placeholder = _('No password saved');
					ui.addNotification(null, E('p', {}, _('Saved password removed.')));
				});
			};
		}
		o = s.option(form.Value, 'service_value', _('Account type'), _('Choose a campus account type, or enter a custom service value.'));
		o.value('default', _('Student')); o.value('Teacher', _('Staff'));

		group(main, 'basic', 'internet', _('Internet access check'), _('Use a URL with a known response code. Successful internet access takes priority over portal availability.'));
		o = urlOption(main, 'basic', 'internet_probe_url', _('Internet check URL'), true);
		var validateInternetURL = o.validate;
		o.validate = function(section_id, value) {
			if (!value && m.lookupOption('enabled', 'main')[0].formvalue('main') === '1')
				return _('Configure an internet check URL before enabling recovery.');
			return validateInternetURL.call(this, section_id, value);
		};
		numberOption(main, 'basic', 'internet_expected_status', _('Expected HTTP status'), 200, 299);
		numberOption(main, 'basic', 'probe_interval', _('Check interval (seconds)'), 1, 86400);
		numberOption(main, 'basic', 'probe_timeout', _('Check timeout (seconds)'), 1, 120);

		s = nested(main, 'mac', 'schedule', 'schedule', _('Schedule'));
		when(s.parentoption, [{ rotation_mode: 'scheduled' }]);
		o = s.option(form.Flag, 'enabled', _('Enable scheduled rotation'));
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
			return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value) ? true : _('Enter a time in HH:MM format.');
		};
		o = s.option(form.Value, 'interval_hours', _('Interval (hours)'));
		o.depends({ enabled: '1', type: 'interval' });
		o.rmempty = false;
		o.retain = true;
		o.datatype = 'and(uinteger,range(1,8760))';
		o.validate = function(section_id, value) {
			return /^[1-9][0-9]*$/.test(value) && Number(value) <= 8760
				? true : _('Enter a whole number from %s to %s.').format(1, 8760);
		};
		o = s.option(form.ListValue, 'weekday', _('Day of the week'));
		o.depends({ enabled: '1', type: 'weekly' });
		o.rmempty = false;
		o.retain = true;
		[_('Monday'), _('Tuesday'), _('Wednesday'), _('Thursday'), _('Friday'), _('Saturday'), _('Sunday')].forEach(function(day, index) {
			o.value(String(index + 1), day);
		});
		o = s.option(form.Flag, 'logout_first', _('Log out before scheduled rotation'));
		o.rmempty = false;
		when(o, [{ enabled: '1' }]);
		// Keep schedule values when the entire subsection is hidden by the MAC policy.
		s.children.forEach(function(option) { option.retain = true; });
		return m.render().then(function(node) {
			var page = E('div', { class: 'ng-page ng-settings' }, [
				E('link', { rel: 'stylesheet', href: L.resource('nuitguard/nuitguard.css') }), node
			]);
			var tab = new URLSearchParams(window.location.search).get('section');
			if (['basic', 'uplinks', 'recovery', 'mac', 'advanced'].indexOf(tab) >= 0)
				requestAnimationFrame(function() {
					var link = page.querySelector('.cbi-tabmenu [data-tab="' + tab + '"] a');
					if (link) link.click();
				});
			return page;
		});
	}
});
