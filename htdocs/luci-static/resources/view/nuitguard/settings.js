'use strict';
'require view';
'require form';
'require uci';

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

function urlOption(section, key, title, optional) {
	var option = section.taboption('probes', form.Value, key, title);
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
		return Promise.all([uci.load('network'), uci.load('wireless')]);
	},

	render: function() {
		var m = new form.Map('nuitguard', _('NuitGuard'),
			_('Configuration preview. Automatic recovery is not available in this development build.'));
		var s = m.section(form.NamedSection, 'main', 'main');
		var o;
		s.tab('uplinks', _('Uplinks'));
		s.tab('recovery', _('Recovery'));
		s.tab('mac', _('MAC privacy'));
		s.tab('probes', _('Connectivity checks'));

		choiceOption(s, 'uplinks', 'preferred_uplink', _('Preferred uplink'), [
			['wired', _('Ethernet')], ['wifi', _('Wi-Fi')]
		]);
		flagOption(s, 'uplinks', 'failover_enabled', _('Allow failover'));
		numberOption(s, 'uplinks', 'max_route_switches_per_incident', _('Maximum switches per outage'), 0, 100,
			_('Zero disables automatic switching. The budget resets after a stable connection.'));
		numberOption(s, 'uplinks', 'alternate_connect_attempts', _('Connection attempts on the alternate uplink'), 1, 100);
		choiceOption(s, 'uplinks', 'standby_mode', _('Standby mode'), [
			['cold', _('Connect when needed')], ['warm', _('Keep connected')]
		]);
		choiceOption(s, 'uplinks', 'failback_policy', _('Return to the preferred uplink'), [
			['stable', _('After stable recovery')], ['on_failure', _('When the alternate uplink fails')],
			['manual', _('Manually')]
		]);
		numberOption(s, 'uplinks', 'primary_recovery_success_count', _('Successful checks before returning'), 1, 100);
		numberOption(s, 'uplinks', 'primary_recovery_interval', _('Recovery check interval (seconds)'), 1, 86400);
		numberOption(s, 'uplinks', 'primary_stable_time', _('Stable time before returning (seconds)'), 1, 604800);
		numberOption(s, 'uplinks', 'reconnect_timeout', _('Connection timeout (seconds)'), 1, 600);

		numberOption(s, 'recovery', 'offline_confirm_count', _('Failed checks before recovery'), 1, 100);
		numberOption(s, 'recovery', 'offline_confirm_interval', _('Failure confirmation interval (seconds)'), 1, 3600);
		numberOption(s, 'recovery', 'portal_fail_count', _('Failed portal checks before failover'), 1, 100);
		numberOption(s, 'recovery', 'portal_fail_interval', _('Portal failure check interval (seconds)'), 1, 3600);
		numberOption(s, 'recovery', 'max_portal_discovery_retries', _('Portal discovery attempts'), 1, 100);
		numberOption(s, 'recovery', 'max_auth_retries_per_mac', _('Authentication attempts per MAC'), 1, 100);
		numberOption(s, 'recovery', 'max_cycle_attempts', _('Recovery attempts per outage'), 1, 100);
		numberOption(s, 'recovery', 'max_post_auth_verify_failures', _('Internet checks after authentication'), 1, 100);
		numberOption(s, 'recovery', 'retry_initial_delay', _('Initial retry delay (seconds)'), 1, 3600);
		o = numberOption(s, 'recovery', 'retry_max_delay', _('Maximum retry delay (seconds)'), 1, 86400);
		var validateDelay = o.validate;
		o.validate = function(section_id, value) {
			var valid = validateDelay.call(this, section_id, value);
			if (valid !== true) return valid;
			var initial = this.section.children.filter(function(child) {
				return child.option === 'retry_initial_delay';
			})[0].formvalue(section_id);
			return Number(value) >= Number(initial) ? true : _('Maximum delay must be at least the initial delay.');
		};
		numberOption(s, 'recovery', 'circuit_breaker_cooldown', _('Cooldown after repeated failure (seconds)'), 1, 604800);
		numberOption(s, 'recovery', 'incident_reset_time', _('Stable time to reset retry budgets (seconds)'), 1, 604800);
		choiceOption(s, 'recovery', 'log_level', _('Log level'), [
			['error', _('Errors')], ['warn', _('Warnings')], ['info', _('Information')], ['debug', _('Debug')]
		]);

		choiceOption(s, 'mac', 'rotation_mode', _('MAC policy'), [
			['fixed', _('Fixed private MAC')], ['offline', _('Rotate during recovery')],
			['scheduled', _('Rotate on schedule')]
		]);
		numberOption(s, 'mac', 'min_rotation_interval', _('Minimum rotation interval (seconds)'), 1, 604800);
		numberOption(s, 'mac', 'max_rotations_per_incident', _('Maximum rotations per outage'), 0, 100);
		numberOption(s, 'mac', 'recent_mac_history', _('Recent MAC addresses to avoid'), 1, 256);
		numberOption(s, 'mac', 'auth_success_but_offline_rotation_limit', _('Extra rotations after authentication succeeds but internet fails'), 0, 1);

		urlOption(s, 'portal_probe_url', _('Portal discovery URL'), false);
		urlOption(s, 'internet_probe_url', _('Internet check URL'), true);
		numberOption(s, 'probes', 'internet_expected_status', _('Expected HTTP status'), 200, 299);
		numberOption(s, 'probes', 'probe_interval', _('Check interval (seconds)'), 1, 86400);
		numberOption(s, 'probes', 'probe_timeout', _('Check timeout (seconds)'), 1, 120);

		['wired', 'wifi'].forEach(function(role) {
			var section = m.section(form.NamedSection, role, 'uplink', role === 'wired' ? _('Ethernet') : _('Wi-Fi'));
			var iface = section.option(form.ListValue, 'interface', _('Network interface'));
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
				uci.sections('wireless', 'wifi-iface').filter(function(entry) { return entry.mode === 'sta'; }).forEach(function(entry) {
					station.value(entry['.name'], entry.ssid || entry['.name']);
				});
			}
		});

		s = m.section(form.NamedSection, 'account', 'account', _('Authentication'));
		s.option(form.Value, 'username', _('Username'));
		s.option(form.Value, 'service_label', _('Service name'));
		s.option(form.Value, 'service_value', _('Service value'));

		s = m.section(form.NamedSection, 'schedule', 'schedule', _('Schedule'));
		o = s.option(form.Flag, 'enabled', _('Enable scheduled rotation'));
		o.rmempty = false;
		o = s.option(form.ListValue, 'type', _('Schedule type'));
		o.rmempty = false;
		o.value('daily', _('Daily'));
		o.value('interval', _('Every N hours'));
		o.value('weekly', _('Weekly'));
		o = s.option(form.Value, 'time', _('Time (router time zone)'));
		o.depends('type', 'daily');
		o.depends('type', 'weekly');
		o.rmempty = false;
		o.retain = true;
		o.validate = function(section_id, value) {
			return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value) ? true : _('Enter a time in HH:MM format.');
		};
		o = s.option(form.Value, 'interval_hours', _('Interval (hours)'));
		o.depends('type', 'interval');
		o.rmempty = false;
		o.retain = true;
		o.datatype = 'and(uinteger,range(1,8760))';
		o.validate = function(section_id, value) {
			return /^[1-9][0-9]*$/.test(value) && Number(value) <= 8760
				? true : _('Enter a whole number from %s to %s.').format(1, 8760);
		};
		o = s.option(form.ListValue, 'weekday', _('Day of the week'));
		o.depends('type', 'weekly');
		o.rmempty = false;
		o.retain = true;
		[_('Monday'), _('Tuesday'), _('Wednesday'), _('Thursday'), _('Friday'), _('Saturday'), _('Sunday')].forEach(function(day, index) {
			o.value(String(index + 1), day);
		});
		o = s.option(form.Flag, 'logout_first', _('Log out before scheduled rotation'));
		o.rmempty = false;
		return m.render();
	}
});
