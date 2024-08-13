import { error, info } from '@actions/core';
import { exec } from '@actions/exec';
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

	private async pre() {
		if (platform() === 'darwin') {
			if (!MainCore.isMetalSupported) {
				throw new Error('Metal is not supported on this system', { cause: cpus()[0]!.model });
			}
		}

		// Setup service
	}

	public async main() {
		await this.pre();

		// https://medium.com/@chhaybunsy/unleash-your-machine-learning-models-how-to-customize-ollamas-storage-directory-c9ea1ea2961a

		info(`Downloading model ${this.model}`);
		return exec(this.ollamaPath, ['pull', this.model], { env: { ...process.env, OLLAMA_MODELS: this.modelDir } })
			.then(() => info(`Downloaded model ${this.model}`))
			.catch((e) => {
				error(`find ${e}`);
				throw e;
			});
	}
}

await new MainCore().main();
