export function next_schedule(schedule, now) {
	if (schedule.type == 'interval') return now + int(schedule.interval_hours) * 3600;
	let local = localtime(now), parts = split(schedule.time, ':');
	let target = { ...local, hour: int(parts[0]), min: int(parts[1]), sec: 0, isdst: -1 };
	if (schedule.type == 'weekly') target.mday += (int(schedule.weekday) - local.wday + 7) % 7;
	let next = timelocal(target);
	if (next <= now) { target.mday += schedule.type == 'weekly' ? 7 : 1; next = timelocal(target); }
	return next;
};
