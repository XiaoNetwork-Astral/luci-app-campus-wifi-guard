import * as fs from 'fs';
import { reset_status } from './reset.uc';
import { cursor } from 'uci';
import { runtime_dir, atomic_json, read_json } from './common.uc';
import { credential_status } from './credentials.uc';
import { create_identities } from './identity.uc';

export function running() {
	let lock = fs.open(runtime_dir + '/daemon.lock', 'r');
	if (!lock) return false;
	let unlocked = lock.lock('xn');
	lock.close();
	return !unlocked;
};

export function status() {
	let identities = create_identities();
	let uci = cursor('/etc/config', runtime_dir + '/uci', '');
	let enabled = uci.get('nuitguard', 'main', 'enabled') == '1';
	let active = running();
	let state = read_json(runtime_dir + '/status.json', { reason: 'stopped', paths: {} });
	if (!active && enabled && index(['stopped', 'not_started'], state.reason) >= 0)
		state.reason = 'service_not_started';
	return { ...state, enabled, reset: reset_status(),
		running: active, credentials: credential_status(),
		private_macs: { wired: identities.get('wired')?.mac, wifi: identities.get('wifi')?.mac } };
};

export function queue_action(action, role) {
	assert(index(['check', 'authenticate', 'rotate', 'switch', 'logout', 'resume'], action) >= 0, 'Unknown action');
	assert(role == 'wired' || role == 'wifi', 'Invalid uplink role');
	if (!running()) return { result: 'service_not_running' };
	let lock = fs.open(runtime_dir + '/queue.lock', 'a', 384);
	assert(lock, 'Cannot open action queue');
	if (!lock.lock('xn')) { lock.close(); return { result: 'busy' }; }
	let result = 'busy';
	try {
		if (!fs.stat(runtime_dir + '/action.json')) {
			atomic_json(runtime_dir + '/action.json', { action, role });
			result = 'queued';
		}
	}
	catch (error) { lock.close(); die('Cannot queue action'); }
	lock.close();
	return { result };
};
