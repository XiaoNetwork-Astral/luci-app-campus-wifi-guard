import * as fs from 'fs';
import { private_dir, atomic_json, read_json } from './common.uc';

export function credential_status() {
	let credentials = read_json(private_dir + '/credentials.json', {});
	return { configured: type(credentials.password) == 'string' && length(credentials.password) > 0 };
};

export function save_password(password, clear) {
	if (clear) {
		fs.unlink(private_dir + '/credentials.json');
		return { configured: false };
	}
	assert(type(password) == 'string' && length(password) > 0 && length(password) <= 1024, 'Invalid password length');
	atomic_json(private_dir + '/credentials.json', { password });
	return { configured: true };
};

export function load_password() {
	return read_json(private_dir + '/credentials.json', {}).password;
};
