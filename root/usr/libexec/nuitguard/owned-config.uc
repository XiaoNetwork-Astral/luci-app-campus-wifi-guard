import { read_json, atomic_json, private_dir } from './common.uc';
import * as fs from 'fs';

// Record only fields owned by NuitGuard. Never roll back an entire user config.
export function create_owned_config(cursor, path) {
	path ||= private_dir + '/network-state.json';
	let journal = read_json(path, { fields: [], sections: [] });
	function save() { atomic_json(path, journal); }
	function same(a, b) { return sprintf('%J', a) == sprintf('%J', b); }
	function refresh(config) { cursor.unload(config); assert(cursor.load(config), 'Cannot read managed configuration'); }
	return {
		create: function(config, section, kind, options) {
			refresh(config);
			let existing = cursor.get_all(config, section);
			assert(!existing, 'Managed section name is already in use');
			push(journal.sections, { config, section, kind, options }); save();
			assert(cursor.set(config, section, kind), 'Cannot create managed section');
			for (let key, value in options) assert(cursor.set(config, section, key, value), 'Cannot configure managed section');
			assert(cursor.commit(config), 'Cannot save managed configuration');
		},
		set: function(config, section, key, value) {
			refresh(config);
			let previous = cursor.get(config, section, key);
			if (same(previous, value)) return false;
			let created = filter(journal.sections, s => s.config == config && s.section == section)[0];
			if (created) { created.previous_options = { ...created.options }; created.options[key] = value; }
			else {
				let entry = filter(journal.fields, e => e.config == config && e.section == section && e.key == key)[0];
				if (entry) {
					assert(same(previous, entry.value), 'Managed configuration changed outside NuitGuard');
					entry.prior_value = previous;
					entry.value = value;
				}
				else push(journal.fields, { config, section, key, previous, value });
			}
			save();
			assert(cursor.set(config, section, key, value) && cursor.commit(config), 'Cannot update managed configuration');
			return true;
		},
		restore: function() {
			let conflicts = [], changed = {};
			for (let entry in journal.fields) {
				refresh(entry.config);
				let current = cursor.get(entry.config, entry.section, entry.key);
				if (same(current, entry.previous)) continue;
				if (!same(current, entry.value) && !(exists(entry, 'prior_value') && same(current, entry.prior_value))) { push(conflicts, entry.config + '.' + entry.section + '.' + entry.key); continue; }
				if (entry.previous == null) cursor.delete(entry.config, entry.section, entry.key);
				else cursor.set(entry.config, entry.section, entry.key, entry.previous);
				changed[entry.config] = true;
				assert(cursor.commit(entry.config), 'Cannot restore managed configuration');
			}
			for (let entry in reverse(journal.sections)) {
				refresh(entry.config);
				let current = cursor.get_all(entry.config, entry.section);
				if (!current) continue;
				let valid = false;
				for (let options in [entry.options, entry.previous_options]) {
					if (!options) continue;
					let matches = current['.type'] == entry.kind;
					for (let key, value in current)
						if (substr(key, 0, 1) != '.' && !same(value, options[key])) matches = false;
					for (let key, value in options) if (!same(value, current[key])) matches = false;
					valid ||= matches;
				}
				if (!valid) { push(conflicts, entry.config + '.' + entry.section); continue; }
				cursor.delete(entry.config, entry.section); changed[entry.config] = true;
				assert(cursor.commit(entry.config), 'Cannot restore managed configuration');
			}
			if (!length(conflicts)) { fs.unlink(path); journal = { fields: [], sections: [] }; }
			return { changed: keys(changed), conflicts };
		}
	};
};
