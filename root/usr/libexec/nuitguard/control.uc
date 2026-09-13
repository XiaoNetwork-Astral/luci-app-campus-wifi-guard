import * as fs from 'fs';
import { runtime_dir, atomic_json, read_json } from './common.uc';
import { credential_status } from './credentials.uc';

export function running() {
	let lock = fs.open(runtime_dir + '/daemon.lock', 'r');
	if (!lock) return false;
	let unlocked = lock.lock('xn');
	lock.close();
	return !unlocked;
};

export function status() {
	return { ...read_json(runtime_dir + '/status.json', { reason: 'stopped', paths: {} }),
		running: running(), credentials: credential_status() };
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
