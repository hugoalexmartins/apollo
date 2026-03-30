export function buildIntervalCron(minutes) {
	const interval = Number(minutes);
	if (!Number.isInteger(interval) || interval < 1) {
		throw new Error(`Invalid schedule interval: ${minutes}`);
	}
	if (interval < 60) return `*/${interval} * * * *`;
	if (interval === 60) return "0 * * * *";
	if (interval < 1440 && interval % 60 === 0) return `0 */${interval / 60} * * *`;
	if (interval === 1440) return "0 0 * * *";
	throw new Error(`Unsupported schedule interval: ${minutes}`);
}
