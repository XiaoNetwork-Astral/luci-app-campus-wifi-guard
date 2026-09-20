import * as fs from 'fs';
import { cursor } from 'uci';
import { atomic_json, read_json, runtime_dir, private_dir, ensure_directory, write_private } from './common.uc';

const maintenance_dir = '/var/run/nuitguard-maintenance';
const result_file = maintenance_dir + '/result.json';
const lock_file = maintenance_dir + '/reset.lock';

export function reset_status() {
	return read_json(result_file, {});
};

export function resetting() {
	return index(['queued', 'running'], reset_status().state) >= 0;
};

export function request_reset(confirm, mode) {
	if (confirm !== true) return { result: 'confirmation_required' };
	if (mode != 'settings' && mode != 'all') return { result: 'invalid_mode' };
	ensure_directory(maintenance_dir);
	let lock = fs.open(lock_file, 'a', 384);
	if (!lock || !lock.lock('xn')) { if (lock) lock.close(); return { result: 'busy' }; }
	if (resetting()) { lock.close(); return { result: 'busy' }; }
	atomic_json(result_file, { state: 'queued', mode, updated: time() });
	lock.close();
	// Fixed internal command; no configuration or RPC input becomes executable text
	let code = system(mode == 'settings'
		? '/usr/sbin/nuitguard reset settings </dev/null >/dev/null 2>&1 &'
		: '/usr/sbin/nuitguard reset all </dev/null >/dev/null 2>&1 &');
	if (code != 0) atomic_json(result_file, { state: 'failed', error: 'reset_failed', updated: time() });
	return { result: code == 0 ? 'queued' : 'reset_failed' };
};

function remove_tree(path) {
	let info = fs.lstat(path);
	if (!info) return;
	if (info.type == 'directory') {
		for (let name in (fs.lsdir(path) || [])) remove_tree(path + '/' + name);
		assert(fs.rmdir(path), 'reset_failed');
	}
	else assert(fs.unlink(path), 'reset_failed');
};

export function execute_reset(mode) {
	if (mode != 'settings' && mode != 'all') return 1;
	ensure_directory(maintenance_dir);
	let lock = fs.open(lock_file, 'a', 384);
	// A queued worker can start before the RPC releases the request lock
	let acquired = false;
	for (let i = 0; lock && i < 50; i++) {
		if (lock.lock('xn')) { acquired = true; break; }
		sleep(100);
	}
	if (!acquired) { if (lock) lock.close(); return 1; }
	let failure = 'reset_failed', daemon;
	try {
		let defaults = fs.readfile('/usr/share/nuitguard/defaults');
		let account;
		if (mode == 'settings') {
			let config = cursor('/etc/config', runtime_dir + '/uci', '');
			account = config.get_all('nuitguard', 'account') || {};
		}
		assert(length(defaults || ''), 'reset_failed');
		assert(fs.lstat('/etc/config/nuitguard')?.type == 'file', 'reset_failed');
		for (let path in [private_dir, runtime_dir]) {
			let info = fs.lstat(path);
			assert(!info || info.type == 'directory', 'reset_failed');
		}
		atomic_json(result_file, { state: 'running', mode, updated: time() });
		failure = 'stop_failed';
		system(['/etc/init.d/nuitguard', 'stop'], 165000);
		ensure_directory(runtime_dir);
		daemon = fs.open(runtime_dir + '/daemon.lock', 'a', 384);
		let stopped = false;
		for (let i = 0; daemon && i < 160; i++) {
			if (daemon.lock('xn')) { stopped = true; break; }
			sleep(1000);
		}
		assert(stopped, 'stop_failed');
		daemon.close(); daemon = null;
		failure = 'restore_failed';
		assert(system(['/usr/sbin/nuitguard', 'restore'], 30000) == 0, 'restore_failed');
		for (let path in [private_dir + '/network-state.json', private_dir + '/interfaces.json', runtime_dir + '/routes.json'])
			assert(!fs.stat(path), 'restore_failed');
		failure = 'reset_failed';
		let stage = fs.mkdtemp('/etc/config/.nuitguard-reset.XXXXXX');
		assert(stage, 'reset_failed');
		try {
			write_private(stage + '/config', defaults);
			if (mode == 'settings') {
				ensure_directory(stage + '/delta');
				let config = cursor(stage, stage + '/delta', '');
				for (let key in ['username', 'service_value'])
					if (account[key] != null) assert(config.set('config', 'account', key, account[key]), 'reset_failed');
				assert(config.commit('config'), 'reset_failed');
			}
			assert(fs.rename(stage + '/config', '/etc/config/nuitguard'), 'reset_failed');
		}
		catch (error) { remove_tree(stage); die('reset_failed'); }
		remove_tree(stage);
		for (let path in (fs.glob('/tmp/run/rpcd/*/nuitguard') || []))
			assert(fs.unlink(path), 'reset_failed');
		if (fs.lstat('/tmp/.uci/nuitguard')) assert(fs.unlink('/tmp/.uci/nuitguard'), 'reset_failed');
		if (mode == 'all') remove_tree(private_dir);
		else for (let name in (fs.lsdir(private_dir) || []))
			if (name != 'credentials.json') remove_tree(private_dir + '/' + name);
		remove_tree(runtime_dir);
		ensure_directory(private_dir);
		ensure_directory(runtime_dir);
		atomic_json(result_file, { state: 'complete', mode, updated: time() });
		lock.close();
		return 0;
	}
	catch (error) {
		if (daemon) daemon.close();
		atomic_json(result_file, { state: 'failed', mode, error: failure, updated: time() });
		lock.close();
		return 1;
	}
};
