import * as fs from 'fs';
import { read_json, atomic_json, private_dir } from './common.uc';

export function validate_pool(pool) {
	if (type(pool) == 'string') pool = [pool];
	assert(type(pool) == 'array' && length(pool) <= 64, 'Invalid MAC pool size');
	let result = [];
	for (let value in pool) {
		assert(type(value) == 'string' && match(value, /^[0-9a-fA-F][26aAeE](:[0-9a-fA-F]{2}){5}$/), 'Use local unicast MAC addresses');
		let mac = lc(value);
		assert(index(result, mac) < 0, 'Duplicate MAC address');
		push(result, mac);
	}
	return result;
};

export function shared_pool(settings) {
	if (settings.main?.mac_pool != null) return validate_pool(settings.main.mac_pool || []);
	let merged = [];
	for (let role in ['wired', 'wifi'])
		for (let mac in validate_pool(settings[role]?.mac_pool || []))
			if (index(merged, mac) < 0) push(merged, mac);
	return validate_pool(merged);
};

// Preserve earlier fixed-mode identities when upgrading from a shared pool
export function fixed_addresses(settings, current) {
	let result = {}, used = [], pool = shared_pool(settings);
	for (let role in ['wired', 'wifi']) {
		let value = settings.main['fixed_mac_' + role];
		if (value) { result[role] = validate_pool([value])[0]; push(used, result[role]); }
	}
	for (let role in ['wired', 'wifi']) {
		if (result[role]) continue;
		let candidates = [current?.[role], ...pool];
		result[role] = filter(candidates, mac => mac && index(used, mac) < 0)[0] || '';
		if (result[role]) push(used, result[role]);
	}
	return result;
};

export function generate_pool(size, excluded, random_bytes, local_addresses) {
	assert(type(size) == 'int' && size >= 1 && size <= 64, 'Invalid MAC pool size');
	let random = random_bytes || function() {
		let file = fs.open('/dev/urandom', 'r');
		assert(file, 'Random source unavailable');
		let bytes = file.read(6); file.close();
		assert(length(bytes) == 6, 'Random source unavailable');
		return bytes;
	};
	let local = local_addresses || map(fs.glob('/sys/class/net/*/address'), path => trim(fs.readfile(path) || ''));
	let avoid = map([ ...(excluded || []), ...local ], value => lc(value));
	let pool = [];
	for (let i = 0; i < size; i++) {
		let mac;
		for (let attempt = 0; attempt < 128; attempt++) {
			let bytes = random(), octets = [];
			assert(length(bytes) == 6, 'Random source unavailable');
			for (let j = 0; j < 6; j++)
				push(octets, sprintf('%02x', j == 0 ? ((ord(bytes, j) & 252) | 2) : ord(bytes, j)));
			mac = join(':', octets);
			if (index(avoid, mac) < 0) break;
			mac = null;
		}
		assert(mac, 'Cannot generate a distinct private MAC');
		push(pool, mac); push(avoid, mac);
	}
	return pool;
};

export function create_identities(directory) {
	let path = (directory || private_dir) + '/identities.json';
	let data = read_json(path, {});
	return {
		get: function(role) { return data[role]; },
		choose: function(role, rotate, pool, reserved) {
			assert(role == 'wired' || role == 'wifi', 'Invalid identity role');
			pool = validate_pool(pool);
			assert(length(pool), 'Generate a MAC pool before using a private MAC');
			let current = data[role] || {}, other = role == 'wired' ? 'wifi' : 'wired';
			reserved ??= data[other]?.mac ? [data[other].mac] : [];
			reserved = map(reserved, value => lc(value));
			if (!rotate && index(pool, current.mac) >= 0 && index(reserved, current.mac) < 0) return current.mac;
			let previous = index(pool, data.pool_last_mac || '');
			if (previous < 0 && rotate) previous = index(pool, current.mac || '');
			let mac;
			for (let i = 1; i <= length(pool); i++) {
				let candidate = pool[(previous + i) % length(pool)];
				if (index(reserved, candidate) < 0 && (!rotate || candidate != current.mac)) { mac = candidate; break; }
			}
			assert(mac, 'No unused address in the shared MAC pool');
			data.pool_last_mac = mac;
			data[role] = { mac, changed_at: time() };
			atomic_json(path, data);
			return mac;
		}
	};
};
