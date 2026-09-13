import * as fs from 'fs';
import { atomic_json, read_json, runtime_dir } from './common.uc';

const tables = { wired: 52001, wifi: 52002 };
const priorities = { wired: 5210, wifi: 5211, local: 5220, active: 5230 };

export function create_routes(execute, read_command, journal_path) {
	execute ||= system;
	read_command ||= function(command) {
		let pipe = fs.popen(command, 'r');
		assert(pipe, 'Cannot inspect routing state');
		let result = pipe.read('all'); let status = pipe.close();
		assert(status == 0, 'Cannot inspect routing state');
		return json(result);
	};
	journal_path ||= runtime_dir + '/routes.json';
	let journal = read_json(journal_path, { rules: [], tables: [] });
	function run(args) { assert(execute(['/sbin/ip', '-4', ...args], 5000) == 0, 'Routing operation failed'); }
	function remember() { atomic_json(journal_path, journal); }
	function add_rule(name, args) {
		let existing = filter(journal.rules, r => r.name == name)[0];
		if (existing) {
			if (sprintf('%J', existing.args) == sprintf('%J', args)) return;
			run(['rule', 'del', ...existing.args]);
			journal.rules = filter(journal.rules, r => r.name != name); remember();
		}
		push(journal.rules, { name, args }); remember();
		run(['rule', 'add', ...args]);
	}
	return {
		preflight: function() {
			assert(!length(journal.rules) && !length(journal.tables), 'Previous routing state needs cleanup');
			let rules = read_command('/sbin/ip -j -4 rule show');
			for (let rule in rules)
				assert(index([0, 32766, 32767], rule.priority) >= 0, 'An existing policy routing manager is active');
			let routes = read_command('/sbin/ip -j -4 route show table all');
			for (let route in routes)
				assert(index(values(tables), int(route.table)) == -1, 'Routing table is already in use');
		},
		update: function(role, link) {
			let table = tables[role];
			assert(table && link && match(link.device, /^[A-Za-z0-9_.:@-]{1,64}$/), 'Invalid route uplink');
			assert(match(link.address, /^[0-9.]+$/) && match(link.gateway, /^[0-9.]+$/), 'Missing IPv4 gateway');
			if (index(journal.tables, table) == -1) { push(journal.tables, table); remember(); }
			// A per-device rule precedes main-table connected routes. The terminal
			// unreachable route prevents a bound request falling through to another uplink.
			run(['route', 'replace', 'unreachable', 'default', 'metric', '32767', 'table', '' + table]);
			run(['route', 'replace', link.gateway + '/32', 'dev', link.device, 'scope', 'link', 'table', '' + table]);
			run(['route', 'replace', 'default', 'via', link.gateway, 'dev', link.device, 'src', link.address,
				'metric', '10', 'table', '' + table]);
			add_rule(role, ['priority', '' + priorities[role], 'oif', link.device, 'lookup', '' + table]);
		},
		select: function(role) {
			assert(index(journal.tables, tables[role]) >= 0, 'Uplink route is not prepared');
			add_rule('local', ['priority', '' + priorities.local, 'lookup', 'main', 'suppress_prefixlength', '0']);
			add_rule('active', ['priority', '' + priorities.active, 'lookup', '' + tables[role]]);
		},
		restore: function() {
			let failed = false;
			for (let rule in reverse(journal.rules)) {
				let rc = execute(['/sbin/ip', '-4', 'rule', 'del', ...rule.args], 5000);
				// Missing rules after a netifd restart are already restored.
				if (rc != 0 && rc != 2) failed = true;
			}
			for (let table in journal.tables)
				if (execute(['/sbin/ip', '-4', 'route', 'flush', 'table', '' + table], 5000) != 0) failed = true;
			if (!failed) { fs.unlink(journal_path); journal = { rules: [], tables: [] }; }
			return !failed;
		}
	};
};
