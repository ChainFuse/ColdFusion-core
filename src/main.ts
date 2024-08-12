import { info } from '@actions/core';
import { cpus, platform } from 'node:os';
import { arch } from 'node:process';
import { graphics } from 'systeminformation';
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

	private static get vramAmount() {
		return new Promise<number>((resolve, reject) => {
			graphics()
				.then((data) => resolve(data.controllers.reduce((total, controller) => total + (controller.vram || 0), 0)))
				.catch(reject);
		});
	}

	private static async pre() {
		if (platform() === 'darwin') {
			if (!this.isMetalSupported) {
				throw new Error('Metal is not supported on this system', { cause: cpus()[0]!.model });
			}
		}

		info(`VRAM Available: ${(await this.vramAmount).toString()}mb`);
	}

	public async main() {
		await MainCore.pre();
	}
}

await new MainCore().main();
