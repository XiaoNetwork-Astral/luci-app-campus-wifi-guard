import { cursor } from 'uci';

export function read_settings() {
	let uci = cursor(), result = {};
	for (let section in ['main', 'wired', 'wifi', 'account', 'schedule']) {
		let values = uci.get_all('nuitguard', section);
		assert(values, 'Missing NuitGuard configuration');
		result[section] = {};
		for (let key, value in values) {
			if (substr(key, 0, 1) == '.') continue;
			result[section][key] = section == 'main' && match(value, /^[0-9]+$/) ? int(value) : value;
		}
	}
	return result;
};
