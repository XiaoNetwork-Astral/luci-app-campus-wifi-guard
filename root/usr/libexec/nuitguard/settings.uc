import { cursor } from 'uci';
import { shared_pool } from './identity.uc';

export function read_settings() {
	let uci = cursor(), result = {};
	for (let section in ['main', 'wired', 'wifi', 'account', 'schedule']) {
		let values = uci.get_all('nuitguard', section);
		assert(values, 'Missing Campus WLAN Guard configuration');
		result[section] = {};
		for (let key, value in values) {
			if (substr(key, 0, 1) == '.' || section == 'main' && key == 'max_rotations_per_incident') continue;
			result[section][key] = section == 'main' && key != 'internet_expected_body' && type(value) == 'string' && match(value, /^[0-9]+$/) ? int(value) : value;
		}
	}
	result.main.auth_success_but_offline_rotation_limit ??= 1;
	result.main.auto_regenerate_pool ??= 0;
	result.main.max_pool_regenerations ??= 1;
	result.main.internet_expected_body ??= '';
	result.main.mac_pool = shared_pool(result);
	return result;
};
