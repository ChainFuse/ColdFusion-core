import { cpus, platform } from 'node:os';
import { arch } from 'node:process';
import { BaseCore } from './base.js';
import { PreCore } from './pre.js';

if (process.env['COLDFUSION_CORE_PRE_EXECUTED'] !== `${true}`) {
	await new PreCore().main();
}

export class MainCore extends BaseCore {
	private static get isMetalSupported() {
		if (cpus().length === 0) {
			return false;
		}

		return cpus()[0]!.model.includes('Apple') && arch === 'arm64';
	}

	private static async pre() {
		if (platform() === 'darwin') {
			if (!this.isMetalSupported) {
				throw new Error('Metal is not supported on this system', { cause: cpus()[0]!.model });
			}
		}
	}

	public async main() {
		await MainCore.pre();
	}
}

await new MainCore().main();
