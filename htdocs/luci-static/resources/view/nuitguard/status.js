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
		class: secondary ? 'btn' : 'btn cbi-button-action', disabled: !data.running,
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
	return E('a', { class: 'btn', href: L.url('admin/services/nuitguard/settings') + (tab ? '?section=' + tab : '') }, title);
}

function pair(title, value) {
	return E('div', { class: 'ng-fact' }, [E('dt', {}, title), E('dd', {}, value)]);
}

function content(data) {
	var paths = data.paths || {}, enabled = uci.get('nuitguard', 'main', 'enabled') === '1';
	var preferred = uci.get('nuitguard', 'main', 'preferred_uplink') || 'wired';
	var state = !data.running ? (enabled ? _('Service is stopped') : _('Not enabled')) : data.blocked ? _('Recovery is paused') : _('Service is running');
	var detail = !data.running ? _('Configure your campus account and uplinks, then enable NuitGuard in Settings.') : label(data.reason);
	if (!data.running && data.reason && ['stopped', 'not_started'].indexOf(data.reason) < 0) detail = label(data.reason);
	var cards = ['wired', 'wifi'].map(function(role) {
		var path = paths[role] || {}, cfg = uci.get('nuitguard', role) || {};
		var configured = role === 'wifi' && cfg.mode === 'managed' ? !!(cfg.radio && cfg.ssid) : !!cfg.interface;
		var active = data.running && data.selected && data.active === role;
		var phase = !configured ? _('Not configured') : !data.running ? _('Not monitored') : label(path.phase);
		var facts = [pair(_('Interface'), path.interface || cfg.interface || _('Created when connected'))];
		if (role === 'wifi' && cfg.ssid && cfg.mode === 'managed') facts.push(pair(_('Network name'), cfg.ssid));
		if (path.private_mac && data.running) facts.push(pair(_('Private MAC'), path.private_mac));
		if (data.running && configured) facts.push(pair(_('Recovery attempts / rotations'), String(path.cycles || 0) + ' / ' + String(path.rotations || 0)));
		var actions = [];
		if (!configured) actions.push(settingsLink(_('Configure uplink'), 'uplinks'));
		else if (data.running && !data.blocked) {
			actions.push(button('check', role, _('Check now'), data));
			var more = [button('authenticate', role, _('Retry authentication'), data, true)];
			if (!active && path.phase === 'online') more.push(button('switch', role, _('Use this uplink'), data, true));
			if (cfg.privacy_mac === '1') more.push(button('rotate', role, _('Rotate MAC and reconnect'), data, true));
			more.push(button('logout', role, _('Log out and pause'), data, true));
			actions.push(E('details', { class: 'ng-more', 'data-role': role }, [
				E('summary', {}, _('More actions')),
				E('div', { class: 'ng-more-content' }, [
					E('p', { class: 'ng-muted' }, _('Reauthentication, MAC changes, switching and logout may interrupt this connection. Logout pauses automatic recovery.')),
					E('div', { class: 'ng-action-list' }, more)
				])
			]));
		}
		return E('section', { class: 'ng-card' + (active ? ' ng-card-active' : '') }, [
			E('div', { class: 'ng-card-heading' }, [
				E('strong', {}, roleName(role)), E('span', { class: 'ng-badge' }, active ? _('In use') : preferred === role ? _('Preferred') : _('Alternate'))
			]),
			E('div', { class: 'ng-path-state' }, phase),
			E('p', { class: 'ng-muted' }, !configured ? _('Add this uplink to make it available for recovery.') : !data.running ? _('Live checks begin when NuitGuard is enabled.') : label(path.reason)),
			configured ? E('dl', { class: 'ng-facts' }, facts) : '',
			actions.length ? E('div', { class: 'ng-actions' }, actions) : ''
		]);
	});
	var level = { error: _('Errors'), warn: _('Warnings'), info: _('Information'), debug: _('Debug') };
	var events = (data.events || []).slice(-20).reverse().map(function(entry) {
		return E('tr', { class: 'tr' }, [E('td', { class: 'td' }, new Date(entry.time * 1000).toLocaleString()),
			E('td', { class: 'td' }, level[entry.level] || entry.level), E('td', { class: 'td' }, entry.role ? roleName(entry.role) : '—'),
			E('td', { class: 'td' }, label(entry.code))]);
	});
	var summaryFacts = [pair(_('Preferred uplink'), roleName(preferred))];
	if (data.running) summaryFacts.push(pair(_('Switches this outage'), String(data.switches || 0)));
	if (data.next_schedule && data.running) summaryFacts.push(pair(_('Next rotation'), new Date(data.next_schedule * 1000).toLocaleString()));
	return E('div', {}, [
		E('h2', {}, _('NuitGuard status')),
		E('section', { class: 'ng-summary' }, [
			E('div', { class: 'ng-summary-top' }, [
				E('div', {}, [E('strong', { class: 'ng-service-state' }, state), E('p', { class: 'ng-muted' }, detail)]),
				E('div', { class: 'ng-actions' }, [
					data.running && data.blocked ? button('resume', data.active || preferred, _('Resume recovery'), data) : '',
					settingsLink(data.running ? _('Edit settings') : _('Set up NuitGuard'), 'basic')
				])
			]),
			E('dl', { class: 'ng-summary-facts' }, summaryFacts),
			data.last_action && data.running ? E('p', { class: 'ng-muted' }, _('Last action: %s').format(label(data.last_action.result))) : ''
		]),
		E('div', { class: 'ng-uplinks' }, cards),
		E('section', { class: 'ng-events' }, [
			E('div', { class: 'ng-card-heading' }, [E('strong', {}, _('Recent events')), E('span', { class: 'ng-muted' }, _('Refreshes every 5 seconds'))]),
			events.length ? E('div', { class: 'ng-table-scroll' }, E('table', { class: 'table' }, [E('tr', { class: 'tr table-titles' }, [
				_('Time'), _('Level'), _('Uplink'), _('Event')
			].map(function(title) { return E('th', { class: 'th' }, title); }))].concat(events))) :
				E('p', { class: 'ng-empty' }, _('No events yet. Connection checks and recovery activity will appear here.'))
		])
	]);
}

return view.extend({
	load: function() { return Promise.all([callStatus(), uci.load('nuitguard')]); },
	render: function(data) {
		var container = E('div', {}, content(data[0]));
		poll.add(function() {
			// Leave focused controls and open action menus in place while they are in use.
			if (container.querySelector('details[open]') || container.contains(document.activeElement)) return Promise.resolve();
			return callStatus().then(function(next) { dom.content(container, content(next)); });
		}, 5);
		return E('div', { class: 'ng-page ng-status' }, [E('link', { rel: 'stylesheet', href: L.resource('nuitguard/nuitguard.css') }), container]);
	},
	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
