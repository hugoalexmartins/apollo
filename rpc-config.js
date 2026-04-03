const HELIUS_RPC_ORIGIN = "https://beta.helius-rpc.com/";
const RPC_SOURCE_ENV = "env";
const RPC_SOURCE_USER_CONFIG = "user_config";
const RPC_SOURCE_HELIUS_DEFAULT = "helius_default";

function getRecordedRpcSource() {
	const source = process.env.ZENITH_RPC_URL_SOURCE;
	return source === RPC_SOURCE_ENV || source === RPC_SOURCE_USER_CONFIG || source === RPC_SOURCE_HELIUS_DEFAULT
		? source
		: null;
}

export function buildDefaultHeliusRpcUrl(apiKey = process.env.HELIUS_API_KEY) {
	const normalizedApiKey = String(apiKey || "").trim();
	if (!normalizedApiKey) return null;
	return `${HELIUS_RPC_ORIGIN}?api-key=${encodeURIComponent(normalizedApiKey)}`;
}

export function getEffectiveRpcUrl() {
	return process.env.RPC_URL || buildDefaultHeliusRpcUrl();
}

export function describeRpcHealth() {
	const derivedDefaultRpcUrl = buildDefaultHeliusRpcUrl();
	const recordedSource = getRecordedRpcSource();
	if (derivedDefaultRpcUrl && process.env.RPC_URL === derivedDefaultRpcUrl) {
		return {
			status: "configured",
			detail: "default Helius Gatekeeper beta RPC derived from HELIUS_API_KEY",
		};
	}

	if (recordedSource === RPC_SOURCE_HELIUS_DEFAULT) {
		return {
			status: "configured",
			detail: "default Helius Gatekeeper beta RPC derived from HELIUS_API_KEY",
		};
	}

	if (recordedSource === RPC_SOURCE_USER_CONFIG) {
		return {
			status: "configured",
			detail: "rpcUrl loaded from user-config.json",
		};
	}

	if (process.env.RPC_URL) {
		return {
			status: "configured",
			detail: "RPC_URL present",
		};
	}

	if (derivedDefaultRpcUrl) {
		return {
			status: "configured",
			detail: "default Helius Gatekeeper beta RPC derived from HELIUS_API_KEY",
		};
	}

	return {
		status: "missing",
		detail: "RPC_URL missing and HELIUS_API_KEY missing for default Helius Gatekeeper beta RPC",
	};
}
