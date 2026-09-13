import * as fs from 'fs';
import { read_json, atomic_json, private_dir } from './common.uc';

export function create_identities(directory, random_bytes, local_addresses) {
	let path = (directory || private_dir) + '/identities.json';
	let data = read_json(path, {});
	let random = random_bytes || function() {
		let file = fs.open('/dev/urandom', 'r');
		assert(file, 'Random source unavailable');
		let bytes = file.read(6); file.close();
		assert(length(bytes) == 6, 'Random source unavailable');
		return bytes;
	};
	let addresses = local_addresses || function() {
		return map(fs.glob('/sys/class/net/*/address'), path => trim(fs.readfile(path) || ''));
	};
	return {
		get: function(role) { return data[role]; },
		choose: function(role, rotate, history_limit) {
			assert(role == 'wired' || role == 'wifi', 'Invalid identity role');
			let current = data[role] || { history: [] };
			if (!rotate && current.mac) return current.mac;
			let avoid = [ ...(current.history || []), ...addresses() ];
			for (let key, entry in data) if (entry.mac) push(avoid, entry.mac);
			let mac;
			for (let attempt = 0; attempt < 32; attempt++) {
				let bytes = random(), octets = [];
				for (let i = 0; i < 6; i++) push(octets, sprintf('%02x', i == 0 ? ((ord(bytes, i) & 252) | 2) : ord(bytes, i)));
				mac = join(':', octets);
				if (index(avoid, mac) == -1) break;
				mac = null;
			}
			assert(mac, 'Cannot generate a distinct private MAC');
			let history = current.history || [];
			if (current.mac) unshift(history, current.mac);
			data[role] = { mac, history: slice(history, 0, history_limit), changed_at: time() };
			atomic_json(path, data);
			return mac;
		}
	};
};
