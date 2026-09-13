import * as fs from 'fs';
import { read_settings } from './settings.uc';
import { create_network } from './network.uc';
import { create_http } from './http.uc';
import { create_auth } from './auth.uc';
import { create_machine } from './machine.uc';
import { load_password } from './credentials.uc';
import { next_schedule } from './schedule.uc';
import { runtime_dir, private_dir, ensure_directory, atomic_json, read_json, monotonic_seconds } from './common.uc';

let command = ARGV[0];
assert(index(['run', 'preflight', 'restore'], command) >= 0, 'Invalid engine command');
let settings = command == 'restore' ? { main: {}, wired: {}, wifi: {} } : read_settings();
let network = create_network(settings);

if (command == 'preflight') {
	network.preflight();
	print('Network configuration is ready for an attended test.\n');
	exit(0);
}

ensure_directory(runtime_dir);
let lock = fs.open(runtime_dir + '/daemon.lock', 'a', 384);
assert(lock && lock.lock('xn'), 'NuitGuard is already running');
if (command == 'restore') { network.restore(); fs.unlink(runtime_dir + '/checkpoint.json'); lock.close(); exit(0); }

let missing = settings.main.enabled != 1 ? 'stopped' : !settings.main.internet_probe_url ? 'internet_check_not_configured' :
	!(settings.account.username && settings.account.service_value && load_password()) ? 'credentials_missing' : null;
if (missing) {
	atomic_json(runtime_dir + '/status.json', { reason: missing, blocked: true, paths: {}, updated: time() });
	lock.close(); exit(1);
}
let stop = false;
signal('TERM', () => stop = true);
signal('INT', () => stop = true);

let machine, clients = {}, keepalive_due = {}, events = [], last_summary, last_action;
let schedule_state = read_json(private_dir + '/schedule.json', {});
let schedule_key = sprintf('%J', settings.schedule);
if (schedule_state.key != schedule_key) {
	schedule_state = { key: schedule_key, next: next_schedule(settings.schedule, time()) };
	if (settings.schedule.enabled == '1' && settings.main.rotation_mode == 'scheduled')
		atomic_json(private_dir + '/schedule.json', schedule_state);
}

function event(level, code, role) {
	let ranks = { error: 0, warn: 1, info: 2, debug: 3 };
	if (ranks[level] > ranks[settings.main.log_level]) return;
	let entry = { time: time(), level, code, role };
	push(events, entry); if (length(events) > 80) shift(events);
	system(['logger', '-t', 'nuitguard', '-p', 'daemon.' + (level == 'error' ? 'err' : level == 'warn' ? 'warning' : level),
		'--', code + (role ? ' (' + role + ')' : '')], 1000);
}

function client(role) {
	let link = network.current_link(role);
	assert(link, 'Uplink has no current IPv4 path');
	let key = sprintf('%J', link);
	if (clients[role]?.key != key) {
		if (clients[role] && machine) { machine.paths[role].session = null; machine.paths[role].context = null; }
		fs.unlink(runtime_dir + '/' + role + '.cookies');
		let http = create_http(link.device, settings.main.probe_timeout, runtime_dir + '/' + role + '.cookies',
			(args, timeout) => stop ? 28 : system(args, timeout));
		clients[role] = { key, http, auth: create_auth(http, settings.main) };
	}
	return clients[role];
}

function clear_session(role) {
	if (machine) { machine.paths[role].session = null; machine.paths[role].context = null; }
	delete clients[role]; delete keepalive_due[role];
	fs.unlink(runtime_dir + '/' + role + '.cookies');
}

let io = {
	configured: network.configured,
	connect: function(role) {
		network.connect(role);
		let changed = network.identities.get(role)?.changed_at;
		if (changed) machine.paths[role].last_rotation = monotonic_seconds() - max(0, time() - changed);
	},
	link: network.link,
	select: network.select,
	disconnect: function(role) { clear_session(role); network.disconnect(role); },
	rotate: function(role) { clear_session(role); return network.rotate(role); },
	internet: function(role) {
		let response = client(role).http(settings.main.internet_probe_url);
		return response.curl_exit == 0 && response.status == settings.main.internet_expected_status;
	},
	discover: function(role) { return client(role).auth.discover(); },
	authenticate: function(role, context) {
		let password = load_password();
		if (!password) return { state: 'credentials_missing' };
		let result = client(role).auth.login(context, { ...settings.account, password });
		password = null;
		if (result.session) result.session.path_key = clients[role].key;
		if (result.session?.keepalive_seconds) keepalive_due[role] = monotonic_seconds() + result.session.keepalive_seconds;
		return result;
	},
	logout: function(role, session) {
		if (session && network.link(role) && session.path_key == sprintf('%J', network.current_link(role))) client(role).auth.logout(session);
		clear_session(role);
	}
};

function publish() {
	let view = machine.status();
	for (let role, path in view.paths) {
		path.interface = network.profiles[role].interface;
		path.private_mac = network.identities.get(role)?.mac;
	}
	let summary = join('|', [view.active, view.reason, view.paths.wired.phase, view.paths.wired.reason,
		view.paths.wifi.phase, view.paths.wifi.reason]);
	if (summary != last_summary) {
		for (let role, path in view.paths) event(path.phase == 'blocked' ? 'error' : path.phase == 'cooldown' ? 'warn' : 'info', path.reason, role);
		last_summary = summary;
	}
	atomic_json(runtime_dir + '/status.json', { ...view, updated: time(), monotonic: monotonic_seconds(),
		next_schedule: settings.schedule.enabled == '1' ? schedule_state.next : null, last_action, events, dns_scope: 'system' });
	atomic_json(runtime_dir + '/checkpoint.json', { settings, state: machine.state, paths: machine.paths });
}

try {
	// A previous crash may have left owned configuration. Restore it before a
	// fresh preflight so route ownership and original values remain unambiguous.
	network.restore();
	network = create_network(settings);
	network.preflight();
	io.configured = network.configured; io.link = network.link; io.select = network.select;
	machine = create_machine(settings.main, io);
	let checkpoint = read_json(runtime_dir + '/checkpoint.json', null);
	if (checkpoint && sprintf('%J', checkpoint.settings) == sprintf('%J', settings)) {
		for (let key, value in checkpoint.state) machine.state[key] = value;
		machine.state.selected = false; machine.state.candidate = null;
		machine.state.manual_probe = machine.state.manual_switch = null;
		for (let role, saved in checkpoint.paths) {
			if (!machine.paths[role]) continue;
			for (let key, value in saved) machine.paths[role][key] = value;
			let path = machine.paths[role]; path.session = path.context = null;
			if (index(['blocked', 'cooldown'], path.phase) == -1) { path.phase = 'idle'; path.due = 0; }
		}
	}
	for (let role, path in machine.paths) {
		let changed = network.identities.get(role)?.changed_at;
		if (changed) path.last_rotation = monotonic_seconds() - max(0, time() - changed);
	}
	event('info', 'service_started');
	while (!stop) {
		try {
			let now = monotonic_seconds();
			if (fs.rename(runtime_dir + '/action.json', runtime_dir + '/processing.json')) {
				let action = read_json(runtime_dir + '/processing.json', {});
				last_action = { ...action, result: machine.action(action.action, action.role, now), time: time() };
				fs.unlink(runtime_dir + '/processing.json');
			}
			// Hotplug accelerates only an ordinary online check; it never clears budgets.
			if (fs.unlink(runtime_dir + '/wake'))
				for (let role, path in machine.paths) if (path.phase == 'online' || path.phase == 'connecting') path.due = min(path.due, now);
			machine.tick(now);
			for (let role, path in machine.paths) {
				if (!machine.state.blocked && path.phase == 'online' && path.session?.keepalive_seconds && now >= keepalive_due[role]) {
					let okay = client(role).auth.keepalive(path.session);
					keepalive_due[role] = now + path.session.keepalive_seconds;
					if (!okay) { event('warn', 'keepalive_unconfirmed', role); path.due = now; }
				}
			}
			if (settings.schedule.enabled == '1' && settings.main.rotation_mode == 'scheduled' && time() >= schedule_state.next) {
				if (machine.scheduled_rotation(now, settings.schedule.logout_first == '1') == 'accepted') {
					schedule_state.next = next_schedule(settings.schedule, time());
					atomic_json(private_dir + '/schedule.json', schedule_state);
				}
			}
		}
		catch (error) {
			machine.state.blocked = true; machine.state.reason = 'network_operation_failed';
			event('error', 'network_operation_failed');
			stop = true;
		}
		publish();
		sleep(1000);
	}
}
catch (error) {
	atomic_json(runtime_dir + '/status.json', { reason: 'startup_failed', blocked: true, paths: {}, updated: time() });
	event('error', 'startup_failed');
}

for (let role in ['wired', 'wifi']) clear_session(role);
try { network.restore(); }
catch (error) {
	atomic_json(runtime_dir + '/status.json', { reason: 'restoration_conflict', blocked: true, paths: {}, updated: time() });
	lock.close(); exit(1);
}
if (machine) {
	if (machine.state.reason != 'network_operation_failed') machine.state.reason = 'stopped';
	for (let role, path in machine.paths) { path.session = null; path.context = null; }
	publish();
	if (machine.state.reason == 'stopped') fs.unlink(runtime_dir + '/checkpoint.json');
}
lock.close();
