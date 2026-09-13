'use strict';
'require view';
'require rpc';
'require poll';
'require ui';
'require dom';
'require uci';

var callStatus = rpc.declare({ object: 'nuitguard', method: 'status', expect: {} });
var callAction = rpc.declare({ object: 'nuitguard', method: 'action', params: ['action', 'role'], expect: {} });

function label(code) {
	var labels = {
		idle: _('Idle'), online: _('Online'), blocked: _('Paused'), cooldown: _('Cooling down'),
		connecting: _('Connecting'), checking: _('Checking internet access'), discovering: _('Finding the portal'),
		authenticating: _('Authenticating'), verifying: _('Verifying internet access'),
		stopped: _('Stopped'), not_started: _('Not started'), starting: _('Starting'), resuming: _('Resuming'),
		internet_verified: _('Internet access verified'), confirming_outage: _('Confirming an outage'),
		portal_available: _('Portal is available'), verifying_authentication: _('Checking internet access after login'),
		link_unavailable: _('The uplink has no usable IPv4 connection'),
		authenticated_but_offline: _('Login succeeded, but internet access failed'),
		authentication_rejected: _('The portal rejected authentication. Check the account before resuming.'),
		invalid_service: _('The selected service is not offered by the portal'),
		additional_authentication_required: _('The portal requires an additional authentication step'),
		unsupported_password_encoding: _('The portal RSA mode does not support these password characters'),
		unsupported_authentication: _('Unsupported portal authentication settings'),
		credentials_missing: _('Campus credentials are missing'),
		internet_check_not_configured: _('Configure an internet check URL before enabling recovery.'),
		unexpected_portal: _('The discovered portal does not match the configured origin'),
		portal_unreachable: _('Portal request failed'), portal_not_found: _('No portal redirect found'),
		portal_ambiguous: _('More than one portal context was found'), portal_unsupported: _('Unsupported portal redirect'),
		authentication_response_unavailable: _('No usable authentication response received'),
		authentication_response_unknown: _('Unknown authentication response'),
		authentication_budget_exhausted: _('Authentication attempt limit reached'),
		alternate_budget_exhausted: _('Alternate uplink attempt limit reached'),
		paused_after_logout: _('Paused after manual logout'), recovery_paused: _('Resume recovery before this action'),
		rotation_limited: _('The MAC policy, interval or rotation budget prevents this action'),
		uplink_not_configured: _('This uplink is not configured'), uplink_not_verified: _('Verify this uplink before switching'),
		accepted: _('Accepted'), queued: _('Queued'), busy: _('Another action is already queued'),
		service_not_running: _('Enable the service in Settings and apply the configuration'),
		startup_failed: _('The service could not start. Check the configuration and preflight result.'),
		network_operation_failed: _('A network operation failed. The service stopped and attempted to restore its changes.'),
		restoration_conflict: _('Some saved network settings could not be restored. Review the restoration journal.'),
		service_started: _('Service started'), keepalive_unconfirmed: _('Keepalive was not confirmed; checking internet access')
	};
	return labels[code] || code || '—';
}

function roleName(role) { return role === 'wifi' ? _('Wi-Fi') : _('Ethernet'); }

function button(action, role, title, data, secondary) {
	return E('button', {
		class: secondary ? 'cbi-button cbi-button-neutral' : 'cbi-button cbi-button-action', disabled: !data.running,
		'aria-label': title + ' · ' + roleName(role),
		click: function(event) {
			var target = event.currentTarget;
			target.disabled = true;
			return callAction(action, role).then(function(result) {
				ui.addNotification(null, E('p', {}, label(result.result || result.error)));
			}).catch(function() {
				ui.addNotification(null, E('p', {}, _('Could not submit the action.')));
			}).finally(function() { target.disabled = !data.running; });
		}
	}, title);
}

function settingsLink(title, tab) {
	return E('a', { class: 'cbi-button cbi-button-action', href: L.url('admin/services/nuitguard/settings') + (tab ? '?section=' + tab : '') }, title);
}

function statusRow(title, value) {
	return E('tr', { class: 'tr' }, [E('td', { class: 'td left', width: '33%' }, title), E('td', { class: 'td left' }, value)]);
}

function uplinkActions(role, path, cfg, active, data) {
	return E('button', {
		class: 'cbi-button cbi-button-neutral',
		'aria-label': _('More actions') + ' · ' + roleName(role),
		click: function() {
			var actions = [button('authenticate', role, _('Retry authentication'), data, true)];
			if (!active && path.phase === 'online') actions.push(button('switch', role, _('Use this uplink'), data, true));
			if (cfg.privacy_mac === '1') actions.push(button('rotate', role, _('Rotate MAC and reconnect'), data, true));
			actions.push(button('logout', role, _('Log out and pause'), data, true));
			ui.showModal(roleName(role), [
				E('p', {}, _('Reauthentication, MAC changes, switching and logout may interrupt this connection. Logout pauses automatic recovery.')),
				E('div', { class: 'cbi-section' }, actions.flatMap(function(action) { return [action, ' ']; })),
				E('div', { class: 'right' }, E('button', { class: 'btn', click: ui.hideModal }, _('Close')))
			]);
		}
	}, _('More actions'));
}

function content(data) {
	var paths = data.paths || {}, enabled = uci.get('nuitguard', 'main', 'enabled') === '1';
	var preferred = uci.get('nuitguard', 'main', 'preferred_uplink') || 'wired';
	var state = !data.running ? (enabled ? _('Service is stopped') : _('Not enabled')) : data.blocked ? _('Recovery is paused') : _('Service is running');
	var summary = [statusRow(_('State'), state), statusRow(_('Preferred uplink'), roleName(preferred))];
	if (data.reason && ['stopped', 'not_started'].indexOf(data.reason) < 0) summary.push(statusRow(_('Details'), label(data.reason)));
	if (data.running) summary.push(statusRow(_('Switches this outage'), String(data.switches || 0)));
	if (data.next_schedule && data.running) summary.push(statusRow(_('Next rotation'), new Date(data.next_schedule * 1000).toLocaleString()));
	if (data.last_action && data.running) summary.push(statusRow(_('Last action'), label(data.last_action.result)));

	var rows = ['wired', 'wifi'].map(function(role) {
		var path = paths[role] || {}, cfg = uci.get('nuitguard', role) || {};
		var configured = role === 'wifi' && cfg.mode === 'managed' ? !!(cfg.radio && cfg.ssid) : !!cfg.interface;
		var active = data.running && data.selected && data.active === role;
		var phase = !configured ? _('Not configured') : !data.running ? _('Not monitored') : label(path.phase);
		var actions = [];
		if (!configured) actions.push(settingsLink(_('Configure uplink'), 'uplinks'));
		else if (data.running && !data.blocked) actions = [
			button('check', role, _('Check now'), data), ' ', uplinkActions(role, path, cfg, active, data)
		];
		var details = [phase];
		if (data.running && configured && path.reason && path.reason !== path.phase)
			details.push(E('div', { class: 'cbi-value-description' }, label(path.reason)));
		return E('tr', { class: 'tr' }, [
			E('td', { class: 'td left' }, roleName(role) + ' (' + (active ? _('In use') : preferred === role ? _('Preferred') : _('Alternate')) + ')'),
			E('td', { class: 'td left' }, configured ? (path.interface || cfg.interface || _('Created when connected')) : '—'),
			E('td', { class: 'td left' }, details),
			E('td', { class: 'td left' }, data.running && path.private_mac || '—'),
			E('td', { class: 'td' }, data.running && configured ? String(path.cycles || 0) + ' / ' + String(path.rotations || 0) : '—'),
			E('td', { class: 'td cbi-section-actions' }, actions.length ? actions : '—')
		]);
	});
	var level = { error: _('Errors'), warn: _('Warnings'), info: _('Information'), debug: _('Debug') };
	var events = (data.events || []).slice(-20).reverse().map(function(entry) {
		return E('tr', { class: 'tr' }, [E('td', { class: 'td left' }, new Date(entry.time * 1000).toLocaleString()),
			E('td', { class: 'td' }, level[entry.level] || entry.level), E('td', { class: 'td' }, entry.role ? roleName(entry.role) : '—'),
			E('td', { class: 'td left' }, label(entry.code))]);
	});
	if (!events.length) events.push(E('tr', { class: 'tr placeholder' }, E('td', { class: 'td', colspan: 4 }, E('em', {}, _('No events yet.')))));
	return E('div', {}, [
		E('h2', {}, _('NuitGuard status')),
		E('div', { class: 'cbi-section' }, [
			E('h3', {}, _('Service status')),
			E('table', { class: 'table' }, summary),
			E('div', { class: 'cbi-page-actions' }, [
				data.running && data.blocked ? button('resume', data.active || preferred, _('Resume recovery'), data) : '', ' ',
				settingsLink(_('Settings'), 'basic')
			])
		]),
		E('div', { class: 'cbi-section' }, [
			E('h3', {}, _('Uplinks')),
			E('table', { class: 'table' }, [E('tr', { class: 'tr table-titles' }, [
				_('Uplink'), _('Interface'), _('State'), _('Private MAC'), _('Recovery attempts / rotations'), _('Actions')
			].map(function(title) { return E('th', { class: 'th' }, title); }))].concat(rows))
		]),
		E('div', { class: 'cbi-section' }, [
			E('h3', {}, _('Recent events')),
			E('table', { class: 'table' }, [E('tr', { class: 'tr table-titles' }, [
				_('Time'), _('Level'), _('Uplink'), _('Event')
			].map(function(title) { return E('th', { class: 'th' }, title); }))].concat(events))
		])
	]);
}

return view.extend({
	load: function() { return Promise.all([callStatus(), uci.load('nuitguard')]); },
	render: function(data) {
		var container = E('div', {}, content(data[0]));
		poll.add(function() {
			// Preserve focus while a status control is being used.
			if (container.contains(document.activeElement)) return Promise.resolve();
			return callStatus().then(function(next) { dom.content(container, content(next)); });
		}, 5);
		return container;
	},
	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
