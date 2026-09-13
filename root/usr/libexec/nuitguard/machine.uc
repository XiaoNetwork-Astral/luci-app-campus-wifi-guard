// Deterministic recovery policy. All network effects are supplied by the driver.
const account_errors = [ 'authentication_rejected', 'invalid_service',
	'additional_authentication_required', 'unsupported_password_encoding',
	'unsupported_authentication', 'credentials_missing', 'unexpected_portal' ];

export function new_path(role) {
	return { role, phase: 'idle', reason: 'not_started', due: 0, failures: 0,
		portal_failures: 0, discoveries: 0, authentications: 0, cycles: 0,
		rotations: 0, post_auth_rotations: 0, verifications: 0,
		last_rotation: null, online_since: null, successes: 0, session: null };
};

export function public_path(path) {
	return { role: path.role, phase: path.phase, reason: path.reason, due: path.due,
		failures: path.failures, portal_failures: path.portal_failures,
		discoveries: path.discoveries, authentications: path.authentications,
		cycles: path.cycles, rotations: path.rotations, successes: path.successes,
		online_since: path.online_since, last_rotation: path.last_rotation };
};

export function create_machine(settings, io) {
	let paths = { wired: new_path('wired'), wifi: new_path('wifi') };
	let state = { active: settings.preferred_uplink, switches: 0, alternate_attempts: 0,
		blocked: false, reason: 'starting', candidate: null, stable_since: null, cooldown_until: 0, selected: false };
	let c = settings;

	function reset_budget(p) {
		p.cycles = p.rotations = p.post_auth_rotations = p.authentications = 0;
		p.failures = p.portal_failures = p.discoveries = p.verifications = 0;
	}

	function begin(p, now) {
		p.phase = 'connecting'; p.reason = 'connecting'; p.due = now;
		p.deadline = now + c.reconnect_timeout;
		io.connect(p.role);
	}

	function cooldown(p, reason, now) {
		p.phase = 'cooldown'; p.reason = reason;
		p.due = now + c.circuit_breaker_cooldown;
		p.online_since = null; p.successes = 0;
	}

	function retry(p, reason, now) {
		p.cycles++;
		p.reason = reason;
		p.online_since = null; p.successes = 0;
		if (p.cycles >= c.max_cycle_attempts) { cooldown(p, reason, now); return; }
		p.phase = 'checking'; p.discoveries = 0;
		p.due = now + min(c.retry_max_delay, c.retry_initial_delay * (2 ** min(p.cycles - 1, 20)));
	}

	function rotate(p, now, post_auth, manual) {
		if ((c.rotation_mode == 'fixed' && !manual) || p.rotations >= c.max_rotations_per_incident ||
			(p.last_rotation != null && now - p.last_rotation < c.min_rotation_interval)) return false;
		if (!io.rotate(p.role)) return false;
		p.last_rotation = now; p.rotations++;
		if (post_auth) p.post_auth_rotations++;
		p.authentications = p.discoveries = p.verifications = 0;
		p.session = null;
		begin(p, now);
		return true;
	}

	function healthy(p, now) {
		p.phase = 'online'; p.reason = 'internet_verified';
		p.online_since ??= now;
		p.successes++;
		p.failures = p.portal_failures = p.discoveries = p.verifications = 0;
		p.due = now + (p.role == state.active ? c.probe_interval : c.primary_recovery_interval);
		if (now - p.online_since >= c.incident_reset_time) reset_budget(p);
	}

	function tick_path(p, now) {
		if (now < p.due || p.phase == 'blocked') return;
		if (p.phase == 'idle') { begin(p, now); return; }
		if (p.phase == 'cooldown') { reset_budget(p); begin(p, now); return; }
		let link = io.link(p.role);
		if (!link) {
			if (p.phase != 'connecting') {
				p.session = null; p.online_since = null; p.successes = 0;
				begin(p, now);
			}
			else if (now >= p.deadline) retry(p, 'link_unavailable', now);
			else p.due = now + 1;
			return;
		}
		if (p.phase == 'connecting') p.phase = 'checking';
		if (p.phase == 'checking' || p.phase == 'online' || p.phase == 'verifying') {
			let verifying = p.phase == 'verifying';
			if (io.internet(p.role)) { healthy(p, now); return; }
			p.online_since = null; p.successes = 0;
			if (verifying) {
				p.verifications++;
				if (p.verifications < c.max_post_auth_verify_failures) {
					p.due = now + c.offline_confirm_interval; return;
				}
				if (c.auth_success_but_offline_rotation_limit > p.post_auth_rotations && rotate(p, now, true)) return;
				cooldown(p, 'authenticated_but_offline', now); return;
			}
			p.failures++;
			if (p.failures < c.offline_confirm_count) {
				p.phase = 'checking'; p.reason = 'confirming_outage';
				p.due = now + c.offline_confirm_interval; return;
			}
			p.phase = 'discovering'; p.due = now;
			return;
		}
		if (p.phase == 'discovering') {
			let found = io.discover(p.role);
			p.discoveries++;
			if (found.state == 'discovered') {
				p.context = found.context; p.portal_failures = 0;
				p.phase = 'authenticating'; p.reason = 'portal_available'; p.due = now;
				return;
			}
			if (found.state == 'unexpected_portal') {
				p.phase = 'blocked'; p.reason = found.state; state.blocked = true; state.reason = found.state; return;
			}
			p.portal_failures++; p.reason = found.state;
			if (p.discoveries >= c.max_portal_discovery_retries) retry(p, found.state, now);
			else p.due = now + c.portal_fail_interval;
			return;
		}
		if (p.phase == 'authenticating') {
			if (p.authentications >= c.max_auth_retries_per_mac) {
				if (c.rotation_mode == 'offline' && rotate(p, now, false)) return;
				cooldown(p, 'authentication_budget_exhausted', now); return;
			}
			p.authentications++;
			let result = io.authenticate(p.role, p.context);
			p.context = null;
			if (index(account_errors, result.state) >= 0) {
				p.phase = 'blocked'; p.reason = result.state;
				state.blocked = true; state.reason = result.state; return;
			}
			if (result.state == 'authenticated') {
				p.session = result.session; p.phase = 'verifying'; p.verifications = 0;
				p.reason = 'verifying_authentication'; p.due = now + c.offline_confirm_interval;
				return;
			}
			retry(p, result.state, now);
		}
	}

	function activate(role, now) {
		let previous = state.active;
		io.select(role);
		state.active = role; state.switches++; state.candidate = null;
		state.selected = true;
		state.stable_since = now; state.reason = 'internet_verified';
		// A preferred path remains available for stable failback checks.
		if (c.standby_mode == 'cold' && previous != c.preferred_uplink) {
			io.disconnect(previous); paths[previous].phase = 'idle';
		}
	}

	function eligible(p) {
		return p.phase == 'cooldown' || p.reason == 'link_unavailable' ||
			p.portal_failures >= c.portal_fail_count;
	}

	return {
		state, paths,
		tick: function(now) {
			if (state.blocked) return;
			let active = paths[state.active], alternate = paths[state.active == 'wired' ? 'wifi' : 'wired'];
			tick_path(active, now);
			if (state.blocked) return;
			if (!state.candidate && now >= state.cooldown_until) state.reason = active.reason;
			if (active.phase == 'online') {
				if (!state.selected) {
					io.select(active.role); state.selected = true;
					if (c.standby_mode == 'cold' && io.configured(alternate.role)) io.disconnect(alternate.role);
				}
				state.stable_since ??= now;
				if (now - state.stable_since >= c.incident_reset_time) {
					state.switches = state.alternate_attempts = 0;
					state.cooldown_until = 0;
				}
			}
			else state.stable_since = null;
			let failback = state.active != c.preferred_uplink && c.failback_policy == 'stable';
			let can_switch = c.failover_enabled && state.switches < c.max_route_switches_per_incident &&
				!(state.active != c.preferred_uplink && c.failback_policy == 'manual');
			if (!io.configured(alternate.role)) return;
			if (c.standby_mode == 'warm' || failback || state.candidate == alternate.role || state.manual_probe == alternate.role)
				tick_path(alternate, now);
			if (state.blocked) return;
			if (state.manual_probe == alternate.role && (alternate.phase == 'online' || alternate.phase == 'cooldown')) {
				state.manual_probe = null;
				if (alternate.phase == 'online' && state.manual_switch == alternate.role) {
					state.manual_switch = null; activate(alternate.role, now); return;
				}
				state.manual_switch = null;
			}
			if (failback && can_switch && alternate.phase == 'online' &&
				alternate.successes >= c.primary_recovery_success_count &&
				now - alternate.online_since >= c.primary_stable_time) {
				activate(alternate.role, now); return;
			}
			if (!can_switch || !eligible(active) || now < state.cooldown_until) return;
			if (!state.candidate) {
				if (state.alternate_attempts >= c.alternate_connect_attempts) {
					state.reason = 'alternate_budget_exhausted';
					state.cooldown_until = now + c.circuit_breaker_cooldown;
					state.alternate_attempts = 0; return;
				}
				state.candidate = alternate.role; state.alternate_attempts++;
				if (alternate.phase == 'cooldown') { reset_budget(alternate); begin(alternate, now); }
				else if (alternate.phase == 'idle') begin(alternate, now);
			}
			if (alternate.phase == 'online') activate(alternate.role, now);
			else if (alternate.phase == 'cooldown') {
				state.candidate = null;
				if (c.standby_mode == 'cold' && !failback) io.disconnect(alternate.role);
			}
		},

		action: function(action, role, now) {
			let p = paths[role];
			if (!p || !io.configured(role)) return 'uplink_not_configured';
			if (action == 'resume') {
				state.blocked = false; state.cooldown_until = state.switches = state.alternate_attempts = 0;
				for (let name, path in paths) { reset_budget(path); path.phase = 'idle'; path.due = now; }
				state.reason = 'resuming'; return 'accepted';
			}
			if (action == 'logout') {
				io.logout(role, p.session); p.session = null;
				state.blocked = true; state.reason = 'paused_after_logout';
				p.phase = 'blocked'; p.reason = state.reason; return 'accepted';
			}
			if (state.blocked) return 'recovery_paused';
			if (action == 'rotate') {
				let changed = rotate(p, now, false, true);
				if (changed && role != state.active) state.manual_probe = role;
				return changed ? 'accepted' : 'rotation_limited';
			}
			if (action == 'switch') {
				if (p.phase != 'online') { p.due = now; state.manual_probe = state.manual_switch = role; return 'accepted'; }
				activate(role, now); return 'accepted';
			}
			if (action == 'check') { p.due = now; if (role != state.active) state.manual_probe = role; return 'accepted'; }
			if (action == 'authenticate') {
				p.phase = 'checking'; p.failures = c.offline_confirm_count; p.due = now;
				if (role != state.active) state.manual_probe = role;
				return 'accepted';
			}
			return 'unknown_action';
		},

		scheduled_rotation: function(now, logout_first) {
			if (state.blocked || paths[state.active].phase != 'online') return 'deferred';
			let p = paths[state.active];
			if (c.rotation_mode != 'scheduled' || p.rotations >= c.max_rotations_per_incident ||
				(p.last_rotation != null && now - p.last_rotation < c.min_rotation_interval)) return 'rotation_limited';
			if (logout_first) io.logout(p.role, p.session);
			return rotate(p, now, false) ? 'accepted' : 'rotation_limited';
		},

		status: function() {
			return { ...state, paths: { wired: public_path(paths.wired), wifi: public_path(paths.wifi) } };
		}
	};
};
