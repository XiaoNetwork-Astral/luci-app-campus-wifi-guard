import * as fs from 'fs';

export const runtime_dir = '/var/run/nuitguard';
export const private_dir = '/etc/nuitguard';

export function ensure_directory(path) {
	assert(fs.mkdir(path, 448) || fs.stat(path)?.type == 'directory', 'Cannot create private directory');
	assert(fs.chmod(path, 448), 'Cannot protect private directory');
};

export function write_private(path, value) {
	let file = fs.open(path, 'w', 384);
	assert(file, 'Cannot open private file');
	assert(fs.chmod(path, 384), 'Cannot protect private file');
	let result = file.write(value);
	file.close();
	assert(result == length(value), 'Cannot write private file');
};

export function read_json(path, fallback) {
	try { return json(fs.readfile(path)); } catch (e) { return fallback; }
};

export function atomic_json(path, value) {
	let directory = fs.dirname(path);
	ensure_directory(directory);
	let temporary = fs.mkdtemp(directory + '/.write.XXXXXX');
	assert(temporary, 'Cannot create temporary directory');
	try {
		write_private(temporary + '/data', sprintf('%J', value));
		assert(fs.rename(temporary + '/data', path), 'Cannot replace private file');
	}
	catch (error) {
		fs.unlink(temporary + '/data');
		fs.rmdir(temporary);
		die(error.message);
	}
	fs.rmdir(temporary);
};

export function remove_temporary(directory) {
	for (let name in (fs.lsdir(directory) || [])) fs.unlink(directory + '/' + name);
	fs.rmdir(directory);
};

export function monotonic_seconds() {
	return clock(true)[0];
};
