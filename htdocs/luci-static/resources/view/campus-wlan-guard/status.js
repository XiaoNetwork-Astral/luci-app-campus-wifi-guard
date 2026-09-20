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
		service_not_started: _('The configuration is enabled, but the service is not running; save and apply to start it'),
		configuration_invalid: _('The saved configuration is invalid; review the settings before starting'),
		waiting_network: _('Waiting for network availability'),
		internet_and_portal_unreachable: _('Internet and the login page are both unreachable; waiting to check again'),
		internet_and_portal_reachable: _('The login page is still reachable after sustained internet access; keeping the connection online'),
		portal_link_matches: _('The portal IP and MAC match the current uplink'),
		portal_link_unconfirmed: _('Could not match the portal IP and MAC to the current uplink'),
		network_address_changed: _('The uplink address changed; checking the new network path'),
		waiting_for_post_auth_network: _('Login succeeded; waiting for internet access or a new network address'),
		private_session_logged_out: _('The portal confirmed logout of the private MAC session; restoring the network'),
		private_session_logout_unconfirmed: _('Could not confirm logout of the private MAC session; network restoration continued'),
		private_session_logout_skipped: _('The connection changed; the earlier private MAC session was not logged out'),
		network_reload_failed: _('Could not apply the managed network settings'),
		uplink_start_failed: _('Could not bring up the uplink interface'),
		interface_restore_failed: _('Could not restore the original interface state'),
		fixed_mac_missing: _('Enter or generate a fixed private MAC for each private uplink'),
		fixed_mac_conflict: _('Ethernet and Wi-Fi must use different private MAC addresses'),
		operation_error: _('A configuration or network operation could not be completed'),
		restoration_failed: _('Could not finish restoring the network settings'),
		waiting_rotation: _('Waiting to retry MAC rotation'),
		waiting_for_mac_rotation: _('Waiting for the minimum MAC rotation interval'),
		mac_recovery_exhausted: _('MAC recovery limits reached'),
		mac_pool_regenerated: _('MAC pool regenerated after repeated connection failures'),
		internet_response_mismatch: _('Unexpected internet response; a redirect or replacement page may be blocking access'),
		internet_login_required: _('The internet check was redirected to the configured login portal'),
		internet_transport_failure: _('Internet request failed'),
		idle: _('Not authenticated'), online: _('Campus network connected'), blocked: _('Paused'), cooldown: _('Cooling down'),
		connecting: _('Connecting'), checking: _('Confirming internet access'), discovering: _('Finding the portal'),
		authenticating: _('Authenticating'), verifying: _('Confirming internet access'),
		stopped: _('Stopped'), starting: _('Starting'), resuming: _('Resuming'),
		internet_verified: _('Campus network connected'), confirming_outage: _('Confirming an outage'),
		portal_available: _('Portal is available'), verifying_authentication: _('Confirming internet access'),
		link_unavailable: _('The uplink has no usable IPv4 connection'),
		authenticated_but_offline: _('Login succeeded, but internet access failed'),
		authentication_rejected: _('The portal rejected authentication; check the account before resuming'),
		invalid_service: _('The selected service is not offered by the portal'),
		additional_authentication_required: _('The portal requires an additional authentication step'),
		unsupported_password_encoding: _('The portal RSA mode does not support these password characters'),
		unsupported_authentication: _('Unsupported portal authentication settings'),
		credentials_missing: _('Campus credentials are missing'),
		internet_check_not_configured: _('Configure an internet check URL before enabling recovery'),
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
		startup_failed: _('The service could not start; check the configuration and preflight result'),
		network_operation_failed: _('A network operation failed; the service stopped and attempted to restore its changes'),
		restoration_conflict: _('Some saved network settings could not be restored; review the restoration journal'),
		service_started: _('Service started'), keepalive_unconfirmed: _('Keepalive was not confirmed; checking internet access')
	};
	return labels[code] || code || '—';
}

function roleName(role) { return role === 'wifi' ? _('Wi-Fi') : _('Ethernet'); }

function button(action, role, title, data, secondary) {
	return E('button', {
		class: secondary ? 'cbi-button cbi-button-neutral' : 'cbi-button cbi-button-action', disabled: !data.running,
		'aria-label': title + ' · ' + roleName(role),
		'data-action': action, 'data-role': role,
		click: function(event) {
			var target = event.currentTarget;
			target.disabled = true;
			return callAction(action, role).then(function(result) {
				ui.addNotification(null, E('p', {}, label(result.result || result.error)));
			}).catch(function() {
				ui.addNotification(null, E('p', {}, _('Could not submit the action')));
			}).finally(function() { target.disabled = !data.running; });
		}
	}, title);
}

function settingsLink(title, tab) {
	return E('a', { class: 'cbi-button cbi-button-action', 'data-action': 'settings', 'data-role': tab || 'basic', href: L.url('admin/services/campus-wlan-guard/settings') + (tab ? '?section=' + tab : '') }, title);
}

function uplinkActions(role, path, cfg, active, data) {
	return E('button', {
		class: 'cbi-button cbi-button-neutral',
		'aria-label': _('More actions') + ' · ' + roleName(role),
		'data-action': 'more', 'data-role': role,
		click: function() {
			var actions = [button('authenticate', role, _('Retry authentication'), data, true)];
			if (!active && path.phase === 'online') actions.push(button('switch', role, _('Use this uplink'), data, true));
			if (cfg.rotation_mode !== 'fixed' && cfg.privacy_mac === '1' && (cfg.mac_pool || []).length > 1) actions.push(button('rotate', role, _('Rotate MAC and reconnect'), data, true));
			actions.push(button('logout', role, _('Log out and pause'), data, true));
			ui.showModal(roleName(role), [
				E('p', {}, _('Reauthentication, MAC changes, switching and logout may interrupt this connection; logout pauses automatic recovery')),
				E('div', { class: 'cwg-modal-actions' }, actions),
				E('div', { class: 'right' }, E('button', { class: 'btn', click: ui.hideModal }, _('Close')))
			]);
		}
	}, _('More actions'));
}

function tableRow(titles, values, actions) {
	return E('tr', { class: 'tr cbi-section-table-row' }, values.map(function(value, index) {
		return E('td', {
			class: 'td cbi-section-table-cell left' + (actions && index === values.length - 1 ? ' cbi-section-actions' : ''),
			'data-title': titles[index]
		}, value);
	}));
}

function detail(title, value) {
	return E('div', { class: 'cwg-detail' }, [E('dt', {}, title), E('dd', {}, value)]);
}

function content(data) {
	var paths = data.paths || {}, enabled = data.enabled != null ? data.enabled : uci.get('nuitguard', 'main', 'enabled') === '1';
	var preferred = uci.get('nuitguard', 'main', 'preferred_uplink') || 'wired';
	var state = !data.running ? (enabled ? _('Service is stopped') : _('Not enabled')) : data.blocked ? _('Recovery is paused') : _('Service is running');
	var summary = [detail(_('Preferred uplink'), roleName(preferred))];
	if (data.running) summary.push(detail(_('Switches this outage'), String(data.switches || 0)));
	if (data.next_schedule && data.running) summary.push(detail(_('Next rotation'), new Date(data.next_schedule * 1000).toLocaleString()));
	if (data.last_action && data.running) summary.push(detail(_('Last action'), label(data.last_action.result)));
	var service = E('section', { class: 'cwg-card cwg-service' }, [
		E('div', { class: 'cwg-card-heading' }, E('h3', {}, _('Service status'))),
		E('div', { class: 'cwg-service-summary' }, [
			E('div', {}, [
				E('div', { class: 'cwg-state' + (data.running ? data.blocked ? ' cwg-warning' : ' cwg-online' : '') }, state),
				data.reason && ['stopped', 'not_started'].indexOf(data.reason) < 0 ? E('p', { class: 'cwg-description' }, label(data.reason)) : '',
				data.failure && data.failure !== data.reason ? E('p', { class: 'cwg-description' }, label(data.failure)) : ''
			]),
			E('dl', { class: 'cwg-details' }, summary)
		]),
		data.running && data.blocked ? E('div', { class: 'cwg-actions' }, button('resume', data.active || preferred, _('Resume recovery'), data)) : ''
	]);
	var shared = uci.get('nuitguard', 'main', 'mac_pool');
	if (shared == null) shared = ['wired', 'wifi'].flatMap(function(role) { return uci.get('nuitguard', role, 'mac_pool') || []; });
	if (!Array.isArray(shared)) shared = shared ? [shared] : [];
	shared = Array.from(new Set(shared.map(function(mac) { return mac.toLowerCase(); })));
	var cards = ['wired', 'wifi'].map(function(role) {
		var path = paths[role] || {}, cfg = Object.assign({}, uci.get('nuitguard', role) || {}, { mac_pool: shared, rotation_mode: uci.get('nuitguard', 'main', 'rotation_mode') });
		var configured = role === 'wifi' && cfg.mode === 'managed' ? !!(cfg.radio && cfg.ssid) : !!cfg.interface;
		var active = data.running && data.selected && data.active === role;
		var phase = !configured ? _('Not configured') : !data.running ? _('Not monitored') : label(path.phase);
		var details = [
			detail(_('Interface'), configured ? path.interface || cfg.interface || _('Created when connected') : '—'),
			detail(cfg.rotation_mode === 'fixed' ? _('Fixed private MAC address') : _('Private MAC'),
				data.running && path.private_mac || (cfg.rotation_mode === 'fixed' ? uci.get('nuitguard', 'main', 'fixed_mac_' + role) : '') || '—')
		];
		if (data.running && configured) {
			var reachability = function(value) { return value === true ? _('Reachable') : value === false ? _('Unreachable') : _('Not checked'); };
			details.push(detail(_('Internet access'), reachability(path.internet_online)));
			details.push(detail(_('Campus login page'), reachability(path.portal_reachable)));
		}
		if (data.running && configured) details.push(detail(_('Recovery rounds / MAC changes'), String(path.cycles || 0) + ' / ' + String(path.rotations || 0)));
		if (data.running && path.pool_regenerations) details.push(detail(_('Pool regenerations'), String(path.pool_regenerations)));
		var actions = [];
		if (!configured) actions.push(settingsLink(_('Configure uplink'), 'uplinks'));
		else if (data.running && !data.blocked) actions = [button('check', role, _('Check now'), data), uplinkActions(role, path, cfg, active, data)];
		return E('article', { class: 'cwg-uplink' }, [
			E('div', { class: 'cwg-card-heading' }, [E('h4', {}, roleName(role)), E('span', { class: 'cwg-badge' }, active ? _('In use') : preferred === role ? _('Preferred') : _('Alternate'))]),
			E('div', { class: 'cwg-state' + (data.running && path.phase === 'online' ? ' cwg-online' : '') }, phase),
			data.running && configured && path.reason && path.reason !== 'not_started' && label(path.reason) !== label(path.phase) ? E('p', { class: 'cwg-description' }, label(path.reason)) : '',
			E('dl', { class: 'cwg-details' }, details),
			actions.length ? E('div', { class: 'cwg-actions' }, actions) : ''
		]);
	});
	var eventTitles = [_('Time'), _('Level'), _('Uplink'), _('Event')];
	var level = { error: _('Errors'), warn: _('Warnings'), info: _('Information'), debug: _('Debug') };
	var events = (data.events || []).filter(function(entry) { return entry.code !== 'not_started'; }).slice(-20).reverse().map(function(entry) {
		return tableRow(eventTitles, [
			new Date(entry.time * 1000).toLocaleString(), level[entry.level] || entry.level,
			entry.role ? roleName(entry.role) : '—', label(entry.code)
		]);
	});
	return E('div', { class: 'cwg-status' }, [
		E('div', { class: 'cbi-map' }, [
			E('h2', {}, _('Campus WLAN Guard')),
			E('div', { class: 'cbi-map-descr' }, _('Automatic campus authentication and connection recovery with private MAC addresses'))
		]),
		E('div', { class: 'cwg-dashboard' }, [
			service,
			E('section', { class: 'cwg-card cwg-uplinks' }, [
				E('div', { class: 'cwg-card-heading' }, E('h3', {}, _('Uplink networks'))),
				E('div', { class: 'cwg-uplink-grid' }, cards)
			])
		]),
		E('section', { class: 'cwg-card cwg-events' }, [
			E('div', { class: 'cwg-card-heading' }, [E('h3', {}, _('Recent events')), E('span', { class: 'cwg-muted' }, _('Updated every 5 seconds'))]),
			events.length ? E('table', { class: 'table' }, [E('tr', { class: 'tr table-titles' }, eventTitles.map(function(title) { return E('th', { class: 'th' }, title); }))].concat(events))
				: E('p', { class: 'cwg-empty' }, _('No events yet'))
		])
	]);
}

return view.extend({
	load: function() { return Promise.all([callStatus(), uci.load('nuitguard')]); },
	render: function(data) {
		var container = E('div', {}, content(data[0]));
		poll.add(function() {
			return callStatus().then(function(next) {
				if (container.querySelector('button:disabled')) return;
				var focused = document.activeElement;
				var action = container.contains(focused) && focused.getAttribute('data-action');
				var role = action && focused.getAttribute('data-role');
				dom.content(container, content(next));
				// Keep keyboard focus without stopping automatic status updates.
				if (action) {
					var control = container.querySelector('[data-action="' + action + '"][data-role="' + role + '"]');
					if (control) control.focus({ preventScroll: true });
				}
			});
		}, 5);
		return E('div', {}, [E('link', { rel: 'stylesheet', href: L.resource('campus-wlan-guard/style.css') }), container]);
	},
	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
