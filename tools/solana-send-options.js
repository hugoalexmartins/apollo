export const SAFE_SEND_OPTIONS = {
	skipPreflight: false,
	preflightCommitment: "confirmed",
	commitment: "confirmed",
	maxRetries: 2,
};

export function buildSafeSendOptions(overrides = {}) {
	return {
		...SAFE_SEND_OPTIONS,
		...overrides,
	};
}
